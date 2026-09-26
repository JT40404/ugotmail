// Central configuration. Everything that changes between devnet and mainnet lives here.

// Accepts "mainnet-beta" or "mainnet" (any case, stray quotes/spaces ignored). Anything else = devnet.
const rawCluster = String(process.env.SOLANA_CLUSTER || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
export const CLUSTER = rawCluster === 'mainnet-beta' || rawCluster === 'mainnet' ? 'mainnet-beta' : 'devnet';

export const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  (CLUSTER === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

const TOKEN_TABLE = {
  'mainnet-beta': {
    SOL: { symbol: 'SOL', decimals: 9, mint: null },
    USDC: { symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    USDT: { symbol: 'USDT', decimals: 6, mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
  },
  devnet: {
    SOL: { symbol: 'SOL', decimals: 9, mint: null },
    // Circle's official devnet USDC (get test USDC at faucet.circle.com)
    USDC: { symbol: 'USDC', decimals: 6, mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' },
  },
};

export const TOKENS = TOKEN_TABLE[CLUSTER];

// Days before an unclaimed send is automatically returned to the sender.
export const RETURN_DAYS = Math.max(1, parseInt(process.env.RETURN_DAYS || '30', 10) || 30);

// Minimums keep the recipient's new account above Solana's rent-exempt minimum.
export const MIN_SOL_LAMPORTS = 1_000_000n; // 0.001 SOL
export const MIN_SPL_UNITS = 10_000n; // 0.01 USDC / USDT

// Extra SOL the sender puts in escrow so the escrow can pay for its own release transaction.
export const SOL_FEE_BUFFER = 20_000n; // 0.00002 SOL
// For USDC/USDT: covers creating the recipient's token account (~0.00204 SOL) plus fees.
export const SPL_SOL_BUFFER = 2_060_000n; // 0.00206 SOL

// Release transaction pricing (kept exact so the escrow drains to precisely zero).
export const BASE_FEE_LAMPORTS = 5_000n;
export const CU_LIMIT = 80_000;
export const CU_PRICE_MICROLAMPORTS = 20_000;

// Verification codes.
export const CODE_TTL_SEC = 10 * 60;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_COOLDOWN_SEC = 60;
export const SESSION_TTL_SEC = 15 * 60;

export const MAX_NOTE = 280;
export const MAX_NAME = 40;

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function explorerUrl(kind, value) {
  const suffix = CLUSTER === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}
