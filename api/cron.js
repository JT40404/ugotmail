// Runs daily (see vercel.json). Activates late-funded sends, retries emails,
// settles stuck transfers, and returns expired sends to their senders.
import { PublicKey } from '@solana/web3.js';
import { reply, getSend, openIds, deleteSend } from '../lib/util.js';
import { siteUrl } from '../lib/config.js';
import { escrowHasFunds } from '../lib/solana.js';
import { activateIfFunded, release, settle } from '../lib/sends.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return reply(res, 401, { error: 'Unauthorized' });

  const started = Date.now();
  const report = { checked: 0, activated: 0, returned: 0, settled: 0, removed: 0, errors: 0 };
  const ids = await openIds();

  for (const id of ids) {
    if (Date.now() - started > 7_000) break; // stay inside the function time limit
    report.checked += 1;
    try {
      const record = await getSend(id);
      if (!record) { await deleteSend(id); continue; }

      if (record.status === 'pending_funding') {
        const r = await activateIfFunded(id, siteUrl(req));
        if (r.status === 'funded') report.activated += 1;
        else if (Date.now() - record.createdAt > 24 * 3600 * 1000 && !(await escrowHasFunds(record))) {
          await deleteSend(id); // abandoned before funding
          report.removed += 1;
        }
      } else if (record.status === 'funded') {
        if (!record.emailSentAt) await activateIfFunded(id, siteUrl(req));
        if (record.expiresAt && Date.now() > record.expiresAt) {
          await release(id, new PublicKey(record.sender), 'refund', 'returned');
          report.returned += 1;
        }
      } else if (record.status === 'releasing') {
        await settle(id);
        report.settled += 1;
      }
    } catch (err) {
      report.errors += 1;
      console.error('cron', id, err);
    }
  }
  reply(res, 200, report);
}
