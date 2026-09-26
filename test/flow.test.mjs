process.env.ESCROW_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.RESEND_API_KEY = 'x'; process.env.EMAIL_FROM = 'U <a@b.co>'; process.env.CRON_SECRET='s';
const root = new URL('../', import.meta.url).pathname;
const util = await import(root + 'lib/util.js');
const sol = await import(root + 'lib/solana.js');
const { Keypair, PublicKey, SystemProgram, Transaction, SystemInstruction } = await import(root + 'node_modules/@solana/web3.js/lib/index.cjs.js');
const nacl = (await import(root + 'node_modules/tweetnacl/nacl-fast.js')).default;

// ---- mock redis
const store = new Map(); const sets = new Map();
util.__setDb({
  async get(k) { return store.has(k) ? JSON.parse(store.get(k)) : null; },
  async set(k, v, o = {}) { if (o.nx && store.has(k)) return null; store.set(k, JSON.stringify(v)); return 'OK'; },
  async del(k) { store.delete(k); },
  async sadd(k, v) { (sets.get(k) || sets.set(k, new Set()).get(k)).add(v); },
  async srem(k, v) { sets.get(k)?.delete(v); },
  async smembers(k) { return [...(sets.get(k) || [])]; },
});
// ---- mock chain (SOL only balances + token balances by address)
const lamports = new Map(); const tokens = new Map(); const sent = [];
const bal = (pk) => lamports.get(pk.toBase58()) || 0;
sol.__setConnection({
  async getBalance(pk) { return bal(pk); },
  async getTokenAccountBalance(pk) { if (!tokens.has(pk.toBase58())) throw new Error('nf'); return { value: { amount: String(tokens.get(pk.toBase58())) } }; },
  async getMinimumBalanceForRentExemption(n) { return n === 165 ? 2039280 : 890880; },
  async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }; },
  async getAccountInfo(pk) { return (bal(pk) > 0 || tokens.has(pk.toBase58())) ? {} : null; },
  async sendRawTransaction(raw) {
    const tx = Transaction.from(raw);
    let feePayer = tx.feePayer.toBase58();
    lamports.set(feePayer, bal(tx.feePayer) - 5000 - 1600);
    for (const ix of tx.instructions) {
      if (ix.programId.equals(SystemProgram.programId)) {
        const { fromPubkey, toPubkey, lamports: l } = SystemInstruction.decodeTransfer(ix);
        lamports.set(fromPubkey.toBase58(), bal(fromPubkey) - Number(l));
        lamports.set(toPubkey.toBase58(), bal(toPubkey) + Number(l));
      } else sent.push(ix.programId.toBase58().slice(0, 6));
    }
    for (const [k, v] of lamports) if (v < 0) throw new Error('negative ' + k + ' ' + v);
    sent.push('tx'); return 'sig';
  },
  async confirmTransaction() { return { value: { err: null } }; },
  async getSignatureStatus() { return { value: { confirmationStatus: 'confirmed', err: null } }; },
  async getBlockHeight() { return 1; },
});
let lastCode = null;
globalThis.fetch = async (url, o) => { const b = JSON.parse(o.body); const m = b.subject.match(/^(\d{6})/); if (m) lastCode = m[1]; console.log('  email:', b.subject, '->', b.to[0]); return { ok: true, text: async () => '' }; };

const call = async (path, { method = 'POST', body, query = {}, headers = {} } = {}) => {
  const h = (await import(root + 'api/' + path + '.js')).default;
  let status, json;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { json = j; } };
  await h({ method, body, query, headers: { host: 'test.local', ...headers } }, res);
  return { status, json };
};

const senderKp = Keypair.generate(); const sender = senderKp.publicKey.toBase58();
lamports.set(sender, 5_000_000_000);

console.log('--- SOL send');
let r = await call('send/create', { body: { token: 'SOL', amount: '0.5', email: 'Sam@Example.com', sender, name: 'Jordan', note: 'hbd' } });
console.log(r.status, Object.keys(r.json));
const id = r.json.id; const escrow = r.json.escrow;
// simulate the sender signing & sending the funding tx
const ftx = Transaction.from(Buffer.from(r.json.transaction, 'base64'));
const t = SystemInstruction.decodeTransfer(ftx.instructions[0]);
lamports.set(escrow, Number(t.lamports)); lamports.set(sender, bal(senderKp.publicKey) - Number(t.lamports));
r = await call('send/confirm', { body: { id } }); console.log('confirm', r.status, r.json.status);
r = await call('claim/info', { method: 'GET', query: { id } }); console.log('info', r.status, r.json.amount, r.json.email, 'secret leaked?', JSON.stringify(r.json).includes('escrowSecret'));
r = await call('claim/request-code', { body: { id } }); console.log('code', r.status, r.json);
r = await call('claim/request-code', { body: { id } }); console.log('cooldown', r.status, r.json.error);
r = await call('claim/verify', { body: { id, code: '000000' === lastCode ? '111111' : '000000' } }); console.log('bad code', r.status, r.json.error);
r = await call('claim/verify', { body: { id, code: lastCode } }); console.log('verify', r.status, !!r.json.session);
const session = r.json.session;
const dest = Keypair.generate().publicKey.toBase58();
r = await call('claim/withdraw', { body: { id, session: 'nope', destination: dest } }); console.log('bad session', r.status);
r = await call('claim/withdraw', { body: { id, session, destination: dest } }); console.log('withdraw', r.status, r.json.status);
console.log('  dest got', lamports.get(dest), 'escrow left', lamports.get(escrow));
r = await call('claim/withdraw', { body: { id, session, destination: dest } }); console.log('double withdraw', r.status, r.json.error);

console.log('--- USDC send, then cancel');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const spl = await import(root + 'node_modules/@solana/spl-token/lib/cjs/index.js');
tokens.set(spl.getAssociatedTokenAddressSync(mint, senderKp.publicKey).toBase58(), 50_000_000);
r = await call('send/create', { body: { token: 'USDC', amount: '12.5', email: 'x@y.io', sender } });
console.log(r.status, r.json.error || 'ok');
const id2 = r.json.id; const esc2 = new PublicKey(r.json.escrow);
const ftx2 = Transaction.from(Buffer.from(r.json.transaction, 'base64')); console.log('  funding ixs', ftx2.instructions.length);
tokens.set(spl.getAssociatedTokenAddressSync(mint, esc2).toBase58(), 12_500_000); lamports.set(esc2.toBase58(), 2_060_000);
r = await call('send/confirm', { body: { id: id2 } }); console.log('confirm', r.status, r.json.status);
r = await call('send/cancel', { body: { id: id2, signature: Buffer.alloc(64).toString('base64') } }); console.log('bad sig', r.status);
const msg = new TextEncoder().encode(`Cancel U GOT MAIL send ${id2}`);
const sig = Buffer.from(nacl.sign.detached(msg, senderKp.secretKey)).toString('base64');
r = await call('send/cancel', { body: { id: id2, signature: sig } }); console.log('cancel', r.status, r.json.status, 'escrow left', lamports.get(esc2.toBase58()));

console.log('--- expiry via cron');
r = await call('send/create', { body: { token: 'SOL', amount: '0.01', email: 'z@y.io', sender } });
const id3 = r.json.id; lamports.set(r.json.escrow, 10_020_000);
await call('send/confirm', { body: { id: id3 } });
const rec = JSON.parse(store.get('send:' + id3)); rec.expiresAt = Date.now() - 1; store.set('send:' + id3, JSON.stringify(rec));
r = await call('cron', { method: 'GET', headers: { authorization: 'Bearer s' } }); console.log('cron', r.json);
console.log('status', JSON.parse(store.get('send:' + id3)).status, 'open set', [...(sets.get('sends:open')||[])].length);
r = await call('send/create', { body: { token: 'SOL', amount: '999', email: 'z@y.io', sender } }); console.log('insufficient', r.status, r.json.error);
