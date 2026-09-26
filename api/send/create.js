// Step 1 for the sender: register a send and get the funding transaction to sign.
import { Keypair } from '@solana/web3.js';
import {
  route, reply, readBody, HttpError, EMAIL_RE, cleanText, toBaseUnits,
  fromBaseUnits, randomId, encryptSecret, saveSend, markOpen,
} from '../../lib/util.js';
import { TOKENS, MIN_SOL_LAMPORTS, MIN_SPL_UNITS, MAX_NAME, MAX_NOTE } from '../../lib/config.js';
import { parseWallet, buildFundingTx } from '../../lib/solana.js';

export default route(['POST'], async (req, res) => {
  const body = readBody(req);

  const token = TOKENS[String(body.token || '').toUpperCase()];
  if (!token) throw new HttpError(400, 'Pick a coin to send.');

  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'That email doesn\u2019t look right. Check it and try again.');

  const baseUnits = toBaseUnits(body.amount, token.decimals);
  if (!token.mint && baseUnits < MIN_SOL_LAMPORTS) throw new HttpError(400, 'Send at least 0.001 SOL.');
  if (token.mint && baseUnits < MIN_SPL_UNITS) throw new HttpError(400, `Send at least 0.01 ${token.symbol}.`);

  const sender = parseWallet(body.sender, 'sender wallet');
  const escrow = Keypair.generate();

  const record = {
    id: randomId(),
    status: 'pending_funding',
    token: token.symbol,
    amount: fromBaseUnits(baseUnits, token.decimals),
    baseUnits: baseUnits.toString(),
    email,
    senderName: cleanText(body.name, MAX_NAME),
    note: cleanText(body.note, MAX_NOTE),
    sender: sender.toBase58(),
    escrow: escrow.publicKey.toBase58(),
    escrowSecret: encryptSecret(escrow.secretKey),
    createdAt: Date.now(),
  };

  // Build first: balance problems are reported before anything is stored.
  const transaction = await buildFundingTx(record, sender);
  await saveSend(record);
  await markOpen(record.id);

  reply(res, 200, { id: record.id, escrow: record.escrow, transaction });
});
