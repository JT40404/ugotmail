// Setup checker: open /api/health in a browser.
// Everything is loaded inside try/catch so this page always answers,
// even when another part of the app is broken, and says what failed.

async function check(name, fn) {
  try { const detail = await fn(); return { name, ok: true, detail: detail || 'OK' }; }
  catch (err) {
    return { name, ok: false, detail: String(err?.stack || err?.message || err).split('\n').slice(0, 4).join(' | ').slice(0, 500) };
  }
}

export default async function handler(req, res) {
  const results = [];
  results.push({ name: 'Node version', ok: true, detail: process.version });

  const mods = {};
  // Literal import() calls so Vercel bundles each file.
  const loaders = [
    ['config', 'lib/config.js', () => import('../lib/config.js')],
    ['util', 'lib/util.js', () => import('../lib/util.js')],
    ['solana', 'lib/solana.js', () => import('../lib/solana.js')],
    ['email', 'lib/email.js', () => import('../lib/email.js')],
    ['sends', 'lib/sends.js', () => import('../lib/sends.js')],
  ];
  for (const [key, label, load] of loaders) {
    results.push(await check(`Load ${label}`, async () => { mods[key] = await load(); return 'loaded'; }));
  }

  if (mods.config) {
    results.push(await check('Solana network', async () =>
      `${mods.config.CLUSTER}${process.env.SOLANA_RPC_URL ? ' (custom RPC)' : ' (public RPC — set SOLANA_RPC_URL for mainnet)'}`));
  }
  if (mods.solana && mods.config) {
    results.push(await check('Solana RPC reachable', async () => {
      const slot = await mods.solana.connection().getSlot();
      return `current slot ${slot} via ${new URL(mods.config.RPC_URL).host}`;
    }));
  }
  if (mods.util) {
    results.push(await check('Database (Upstash Redis)', async () => {
      const db = mods.util.db();
      await db.set('health:ping', Date.now(), { ex: 60 });
      await db.get('health:ping');
      return 'read/write OK';
    }));
  }
  results.push(await check('ESCROW_ENCRYPTION_KEY', async () => {
    const raw = process.env.ESCROW_ENCRYPTION_KEY;
    if (!raw) throw new Error('Missing. Generate with: openssl rand -base64 32');
    if (Buffer.from(raw.trim(), 'base64').length !== 32) throw new Error('Wrong length. It must be the output of: openssl rand -base64 32');
    return 'set, 32 bytes';
  }));
  results.push(await check('Email (Resend)', async () => {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is missing');
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is missing');
    return `key set, sending from ${process.env.EMAIL_FROM}`;
  }));
  results.push(await check('CRON_SECRET', async () => {
    if (!process.env.CRON_SECRET) throw new Error('Missing (needed for automatic returns)');
    return 'set';
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ allGood: results.every((r) => r.ok), checks: results }, null, 2));
}
