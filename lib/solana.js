// Solana side: building the funding transaction, checking escrow balances,
// and releasing escrow funds (to the recipient on claim, or to the sender on cancel/return).
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import {
  RPC_URL, TOKENS, SOL_FEE_BUFFER, SPL_SOL_BUFFER,
  BASE_FEE_LAMPORTS, CU_LIMIT, CU_PRICE_MICROLAMPORTS,
} from './config.js';
import bs58 from 'bs58';
import { HttpError, decryptSecret } from './util.js';

let conn;
export function __setConnection(c) { conn = c; } // tests only
export function connection() {
  if (!conn) conn = new Connection(RPC_URL, 'confirmed');
  return conn;
}

export function parseWallet(value, label = 'wallet address') {
  let pk;
  try { pk = new PublicKey(String(value || '').trim()); } catch { throw new HttpError(400, `That ${label} isn't a valid Solana address.`); }
  if (!PublicKey.isOnCurve(pk.toBytes())) throw new HttpError(400, `That ${label} can't receive funds directly. Use a regular wallet address.`);
  return pk;
}

async function tokenBalance(ata) {
  try {
    const r = await connection().getTokenAccountBalance(ata, 'confirmed');
    return BigInt(r.value.amount);
  } catch {
    return 0n; // account doesn't exist yet
  }
}

const TOKEN_ACCOUNT_SIZE = 165;

/** Build the unsigned transaction the sender signs to fund a new escrow. Returns base64. */
export async function buildFundingTx(record, senderPk) {
  const c = connection();
  const token = TOKENS[record.token];
  const escrow = new PublicKey(record.escrow);
  const amount = BigInt(record.baseUnits);
  const solBalance = BigInt(await c.getBalance(senderPk, 'confirmed'));
  const tx = new Transaction();

  if (!token.mint) {
    const total = amount + SOL_FEE_BUFFER;
    if (solBalance < total + 15_000n) throw new HttpError(400, 'Your wallet doesn\u2019t have enough SOL for this send plus network fees.');
    tx.add(SystemProgram.transfer({ fromPubkey: senderPk, toPubkey: escrow, lamports: total }));
  } else {
    const mint = new PublicKey(token.mint);
    const senderAta = getAssociatedTokenAddressSync(mint, senderPk);
    const escrowAta = getAssociatedTokenAddressSync(mint, escrow);
    const have = await tokenBalance(senderAta);
    if (have < amount) throw new HttpError(400, `Your wallet doesn\u2019t have enough ${token.symbol} for this send.`);
    const rent = BigInt(await c.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
    if (solBalance < SPL_SOL_BUFFER + rent + 20_000n) {
      throw new HttpError(400, `Sending ${token.symbol} needs about 0.0045 SOL in your wallet for account setup and fees.`);
    }
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(senderPk, escrowAta, escrow, mint),
      createTransferCheckedInstruction(senderAta, mint, escrowAta, senderPk, amount, token.decimals),
      SystemProgram.transfer({ fromPubkey: senderPk, toPubkey: escrow, lamports: SPL_SOL_BUFFER }),
    );
  }

  const { blockhash } = await c.getLatestBlockhash('confirmed');
  tx.feePayer = senderPk;
  tx.recentBlockhash = blockhash;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/** Has the escrow received everything it needs? */
export async function isFunded(record) {
  const c = connection();
  const token = TOKENS[record.token];
  const escrow = new PublicKey(record.escrow);
  const lamports = BigInt(await c.getBalance(escrow, 'confirmed'));
  const amount = BigInt(record.baseUnits);
  if (!token.mint) return lamports >= amount + SOL_FEE_BUFFER;
  const ata = getAssociatedTokenAddressSync(new PublicKey(token.mint), escrow);
  return lamports >= SPL_SOL_BUFFER && (await tokenBalance(ata)) >= amount;
}

export async function escrowHasFunds(record) {
  const c = connection();
  const escrow = new PublicKey(record.escrow);
  if ((await c.getBalance(escrow, 'confirmed')) > 0) return true;
  const token = TOKENS[record.token];
  if (!token.mint) return false;
  return (await tokenBalance(getAssociatedTokenAddressSync(new PublicKey(token.mint), escrow))) > 0n;
}

/**
 * Build and sign (but don't send) a transaction that moves everything in the escrow to `target`.
 * kind: 'claim' (to the recipient) or 'refund' (back to the sender).
 * Returns { raw, signature, blockhash, lastValidBlockHeight }.
 */
export async function prepareRelease(record, targetPk, kind) {
  const c = connection();
  const token = TOKENS[record.token];
  const kp = Keypair.fromSecretKey(decryptSecret(record.escrowSecret));
  const escrow = kp.publicKey;
  if (escrow.toBase58() !== record.escrow) throw new Error('Escrow key mismatch');
  const sender = new PublicKey(record.sender);

  const fee = BASE_FEE_LAMPORTS + BigInt(Math.ceil((CU_LIMIT * CU_PRICE_MICROLAMPORTS) / 1_000_000));
  const lamports = BigInt(await c.getBalance(escrow, 'confirmed'));
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICROLAMPORTS }),
  );
  let left = lamports - fee;
  let moved = false;

  if (token.mint) {
    const mint = new PublicKey(token.mint);
    const escrowAta = getAssociatedTokenAddressSync(mint, escrow);
    const amount = await tokenBalance(escrowAta);
    if (amount > 0n) {
      const targetAta = getAssociatedTokenAddressSync(mint, targetPk);
      if (!(await c.getAccountInfo(targetAta, 'confirmed'))) {
        tx.add(createAssociatedTokenAccountIdempotentInstruction(escrow, targetAta, targetPk, mint));
        left -= BigInt(await c.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
      }
      tx.add(createTransferCheckedInstruction(escrowAta, mint, targetAta, escrow, amount, token.decimals));
      moved = true;
    }
    if (await c.getAccountInfo(escrowAta, 'confirmed')) {
      // The escrow's token-account deposit goes back to the sender who paid it.
      tx.add(createCloseAccountInstruction(escrowAta, sender, escrow));
      moved = true;
    }
  }

  if (left < 0n) throw new Error('Escrow is short on SOL for fees');
  if (left > 0n) {
    let sweepTo = targetPk;
    if (token.mint && kind === 'claim' && !(await c.getAccountInfo(targetPk, 'confirmed'))) {
      // Leftover SOL is gas money for the recipient, unless it's too small to open
      // a brand-new account; then it goes back to the sender.
      const minimum = BigInt(await c.getMinimumBalanceForRentExemption(0));
      if (left < minimum) sweepTo = sender;
    }
    tx.add(SystemProgram.transfer({ fromPubkey: escrow, toPubkey: sweepTo, lamports: left }));
    moved = true;
  }
  if (!moved) throw new HttpError(409, 'This escrow is already empty.');

  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');
  tx.feePayer = escrow;
  tx.recentBlockhash = blockhash;
  tx.sign(kp);
  return {
    raw: tx.serialize().toString('base64'),
    signature: bs58.encode(tx.signature),
    blockhash,
    lastValidBlockHeight,
  };
}

export async function broadcast(raw) {
  await connection().sendRawTransaction(Buffer.from(raw, 'base64'), { maxRetries: 5 });
}

/** Wait for a broadcast release. Returns 'confirmed' | 'failed' | 'pending'. */
export async function waitForRelease({ signature, blockhash, lastValidBlockHeight }, timeoutMs = 6_000) {
  const c = connection();
  try {
    const result = await Promise.race([
      c.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed'),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!result) return 'pending';
    return result.value.err ? 'failed' : 'confirmed';
  } catch (err) {
    // Block height exceeded = the transaction expired without landing.
    if (/expired|block height exceeded/i.test(String(err?.message))) return 'failed';
    return 'pending';
  }
}

/** Re-check a release we broadcast earlier. Returns 'confirmed' | 'failed' | 'pending'. */
export async function checkRelease({ signature, lastValidBlockHeight }) {
  const c = connection();
  const { value } = await c.getSignatureStatus(signature, { searchTransactionHistory: true });
  if (value) {
    if (value.err) return 'failed';
    if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') return 'confirmed';
    return 'pending';
  }
  const height = await c.getBlockHeight('confirmed');
  return height > lastValidBlockHeight ? 'failed' : 'pending';
}
