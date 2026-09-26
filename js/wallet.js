// Shared browser helpers for U GOT MAIL.
// Requires @solana/web3.js (window.solanaWeb3) loaded before this file.
(function () {
  const UGM = (window.UGM = {});

  /* ---------- API ---------- */
  UGM.api = async function (path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    let parsed = true;
    try { data = await res.json(); } catch { parsed = false; }
    if (!res.ok && res.status !== 202) {
      let msg = data.error;
      if (!msg) {
        if (res.status === 404) msg = `The server route ${path.split('?')[0]} wasn\u2019t found (404). The api folder may be missing from the deployment.`;
        else if (res.status === 504) msg = 'The server timed out (504). Check SOLANA_RPC_URL, then try again.';
        else msg = `The server crashed (error ${res.status}${parsed ? '' : ', no details'}). Open /api/health to see what\u2019s misconfigured.`;
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data };
  };

  let configPromise;
  UGM.config = () => (configPromise ||= UGM.api('/api/config').then((r) => r.data));

  /* ---------- Wallet ---------- */
  UGM.findWallet = function () {
    const w = window;
    if (w.phantom?.solana?.isPhantom) return { name: 'Phantom', provider: w.phantom.solana };
    if (w.solflare?.isSolflare) return { name: 'Solflare', provider: w.solflare };
    if (w.backpack?.isBackpack) return { name: 'Backpack', provider: w.backpack };
    if (w.solana) return { name: 'your wallet', provider: w.solana };
    return null;
  };

  UGM.isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  UGM.phantomBrowseLink = () =>
    `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;

  UGM.connect = async function () {
    const found = UGM.findWallet();
    if (!found) {
      const err = new Error('NO_WALLET');
      err.code = 'NO_WALLET';
      throw err;
    }
    const { provider } = found;
    const out = await provider.connect();
    const pk = out?.publicKey || provider.publicKey;
    if (!pk) throw new Error('Your wallet didn\u2019t share an address. Try connecting again.');
    return { ...found, address: pk.toString() };
  };

  UGM.isUserRejection = (err) =>
    err?.code === 4001 || /reject|declin|cancel|denied/i.test(String(err?.message || err));

  /* ---------- Encoding ---------- */
  UGM.b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  UGM.bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));

  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  UGM.base58 = function (bytes) {
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let out = '';
    while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
    return out;
  };

  UGM.short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '');

  UGM.explorer = async function (kind, value) {
    const { cluster } = await UGM.config();
    return `https://explorer.solana.com/${kind}/${value}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
  };

  UGM.show = (el, on) => { if (el) el.hidden = !on; };
  UGM.text = (el, value) => { if (el) el.textContent = value; };

  /* ---------- Devnet ribbon ---------- */
  UGM.config().then((cfg) => {
    if (cfg.cluster !== 'devnet') return;
    const bar = document.createElement('div');
    bar.className = 'devnet';
    bar.textContent = 'Test mode: Solana devnet. No real money moves. Set your wallet to Devnet to try it.';
    document.body.prepend(bar);
  }).catch(() => {});
})();
