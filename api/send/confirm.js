// Step 2 for the sender: after signing, wait for the escrow to be funded, then email the recipient.
import { route, reply, readBody, HttpError, getSend } from '../../lib/util.js';
import { siteUrl } from '../../lib/config.js';
import { connection, isFunded } from '../../lib/solana.js';
import { activateIfFunded, publicView } from '../../lib/sends.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default route(['POST'], async (req, res) => {
  const { id, signedTx } = readBody(req);
  const record = await getSend(id);
  if (!record) throw new HttpError(404, 'We couldn\u2019t find that send.');

  // Wallets without signAndSendTransaction hand us the signed transaction to broadcast.
  if (signedTx && record.status === 'pending_funding') {
    try {
      await connection().sendRawTransaction(Buffer.from(String(signedTx), 'base64'), { maxRetries: 5 });
    } catch (err) {
      console.error('Funding broadcast failed', id, err);
      throw new HttpError(400, 'Solana rejected the transaction. Check your balance and try again.');
    }
  }

  if (record.status === 'pending_funding') {
    const deadline = Date.now() + 6_000;
    let funded = await isFunded(record);
    while (!funded && Date.now() < deadline) {
      await sleep(2000);
      funded = await isFunded(record);
    }
    if (!funded) return reply(res, 202, { status: 'pending_funding' });
  }

  const updated = await activateIfFunded(id, siteUrl(req));
  reply(res, 200, publicView(updated, { forSender: true }));
});
