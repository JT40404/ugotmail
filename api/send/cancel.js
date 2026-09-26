// Sender cancels an unopened send. Proven by signing a message with the sending wallet.
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { route, reply, readBody, HttpError, getSend, saveSend, markClosed, withLock } from '../../lib/util.js';
import { escrowHasFunds } from '../../lib/solana.js';
import { release, publicView, FINAL } from '../../lib/sends.js';

export const cancelMessage = (id) => `Cancel U GOT MAIL send ${id}`;

export default route(['POST'], async (req, res) => {
  const { id, signature } = readBody(req);
  const record = await getSend(id);
  if (!record) throw new HttpError(404, 'We couldn\u2019t find that send.');

  let sig;
  try { sig = Buffer.from(String(signature || ''), 'base64'); } catch { sig = Buffer.alloc(0); }
  const ok = sig.length === 64 && nacl.sign.detached.verify(
    new TextEncoder().encode(cancelMessage(id)),
    sig,
    new PublicKey(record.sender).toBytes(),
  );
  if (!ok) throw new HttpError(403, 'Only the wallet that sent this can cancel it. Connect that wallet and try again.');

  if (FINAL.includes(record.status)) return reply(res, 200, publicView(record, { forSender: true }));

  // Never funded: nothing to return, just close it.
  if (record.status === 'pending_funding' && !(await escrowHasFunds(record))) {
    const closed = await withLock(id, async () => {
      const r = await getSend(id);
      r.status = 'cancelled';
      r.closedAt = Date.now();
      await saveSend(r);
      await markClosed(id);
      return r;
    });
    return reply(res, 200, publicView(closed, { forSender: true }));
  }

  const out = await release(id, new PublicKey(record.sender), 'refund', 'cancelled');
  reply(res, out.state === 'done' ? 200 : 202, publicView(out.record, { forSender: true }));
});
