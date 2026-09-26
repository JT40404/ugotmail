// Release the escrow to the recipient's wallet. Requires a verified session.
import { route, reply, readBody, HttpError, getSend, db } from '../../lib/util.js';
import { parseWallet } from '../../lib/solana.js';
import { release, publicView } from '../../lib/sends.js';

export default route(['POST'], async (req, res) => {
  const { id, session, destination } = readBody(req);
  const owner = session ? await db().get(`session:${String(session)}`) : null;
  if (!owner || owner !== id) throw new HttpError(401, 'Your verification expired. Ask for a new code to continue.');

  const record = await getSend(id);
  if (!record) throw new HttpError(404, 'We couldn\u2019t find this mail.');

  // A retry while a claim is confirming: keep waiting on that same transfer.
  if (record.status === 'releasing' && record.release?.kind === 'claim') {
    const out = await release(id, record.release.to, 'claim', 'claimed');
    if (out.state === 'done') await db().del(`session:${session}`);
    return reply(res, out.state === 'done' ? 200 : 202, publicView(out.record));
  }

  const dest = parseWallet(destination);
  if (dest.toBase58() === record.escrow) throw new HttpError(400, 'Use your own wallet address.');

  const out = await release(id, dest, 'claim', 'claimed');
  if (out.state === 'done') await db().del(`session:${session}`);
  reply(res, out.state === 'done' ? 200 : 202, publicView(out.record));
});
