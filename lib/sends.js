// The life of a send: pending_funding -> funded -> releasing -> claimed | cancelled | returned
import { PublicKey } from '@solana/web3.js';
import { getSend, saveSend, markClosed, withLock, HttpError, shortKey } from './util.js';
import { isFunded, prepareRelease, broadcast, waitForRelease, checkRelease } from './solana.js';
import { sendClaimEmail } from './email.js';
import { RETURN_DAYS, explorerUrl } from './config.js';

export const FINAL = ['claimed', 'cancelled', 'returned'];

/** Safe-to-share view of a send. Never includes the escrow secret or codes. */
export function publicView(record, { forSender = false } = {}) {
  const view = {
    id: record.id,
    status: record.status === 'releasing' ? 'processing' : record.status,
    token: record.token,
    amount: record.amount,
    senderName: record.senderName || shortKey(record.sender),
    note: record.note || null,
    email: record.email,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt || null,
    closedAt: record.closedAt || null,
    releaseTx: record.releaseSig ? explorerUrl('tx', record.releaseSig) : null,
  };
  if (forSender) {
    view.sender = record.sender;
    view.escrow = record.escrow;
    view.escrowUrl = explorerUrl('address', record.escrow);
  }
  return view;
}

/** If the escrow is funded, mark the send live and email the recipient. Idempotent. */
export async function activateIfFunded(id, site) {
  return withLock(id, async () => {
    const record = await getSend(id);
    if (!record) throw new HttpError(404, 'We couldn\u2019t find that send.');
    if (record.status === 'pending_funding') {
      if (!(await isFunded(record))) return record;
      record.status = 'funded';
      record.fundedAt = Date.now();
      record.expiresAt = record.fundedAt + RETURN_DAYS * 24 * 60 * 60 * 1000;
      await saveSend(record);
    }
    if (record.status === 'funded' && !record.emailSentAt) {
      try {
        await sendClaimEmail(record, site);
        record.emailSentAt = Date.now();
        await saveSend(record);
      } catch (err) {
        // The daily job retries; the send itself is safe in escrow.
        console.error('Claim email failed', id, err);
      }
    }
    return record;
  });
}

async function finish(record) {
  record.status = record.release.finalStatus;
  record.releaseSig = record.release.signature;
  record.releasedTo = record.release.to;
  record.closedAt = Date.now();
  delete record.release.raw;
  await saveSend(record);
  await markClosed(record.id);
  return { state: 'done', record };
}

async function revert(record) {
  record.status = record.release.fromStatus;
  delete record.release;
  await saveSend(record);
}

/** Resolve a release that was broadcast earlier (timeouts, retries). Caller holds the lock. */
async function resolveInFlight(record) {
  const r = record.release;
  const state = await checkRelease(r);
  if (state === 'confirmed') return finish(record);
  if (state === 'failed') { await revert(record); return { state: 'reverted', record }; }
  // Still pending: rebroadcast the same signed transaction (safe: same signature).
  try { await broadcast(r.raw); } catch { /* already known or expired; next check decides */ }
  return { state: 'pending', record };
}

/**
 * Move a send's escrow to `targetPk`.
 * kind 'claim' -> final status 'claimed'; kind 'refund' -> finalStatus ('cancelled' | 'returned').
 * Returns { state: 'done' | 'pending', record }.
 */
export async function release(id, targetPk, kind, finalStatus) {
  return withLock(id, async () => {
    let record = await getSend(id);
    if (!record) throw new HttpError(404, 'We couldn\u2019t find that send.');

    if (record.status === 'releasing') {
      const out = await resolveInFlight(record);
      if (out.state !== 'reverted') return out;
      record = out.record;
    }
    if (FINAL.includes(record.status)) {
      throw new HttpError(409, {
        claimed: 'This mail has already been opened and claimed.',
        cancelled: 'The sender cancelled this send.',
        returned: 'This send expired and went back to the sender.',
      }[record.status]);
    }

    const target = targetPk instanceof PublicKey ? targetPk : new PublicKey(targetPk);
    const prepared = await prepareRelease(record, target, kind);
    record.release = { ...prepared, to: target.toBase58(), kind, finalStatus, fromStatus: record.status };
    record.status = 'releasing';
    await saveSend(record); // save intent before broadcasting

    try {
      await broadcast(prepared.raw);
    } catch (err) {
      console.error('Broadcast failed', id, err);
      await revert(record);
      throw new HttpError(502, 'The Solana network didn\u2019t accept the transfer. Try again in a minute.');
    }

    const state = await waitForRelease(prepared);
    if (state === 'confirmed') return finish(record);
    if (state === 'failed') {
      await revert(record);
      throw new HttpError(502, 'The transfer didn\u2019t go through on Solana. Nothing moved — try again.');
    }
    return { state: 'pending', record };
  });
}

/** Re-check an in-flight release (used by polling and the daily job). */
export async function settle(id) {
  return withLock(id, async () => {
    const record = await getSend(id);
    if (!record || record.status !== 'releasing') return { state: record && FINAL.includes(record.status) ? 'done' : 'none', record };
    return resolveInFlight(record);
  });
}
