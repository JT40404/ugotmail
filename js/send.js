// U GOT MAIL — send flow: connect wallet -> create escrow -> sign -> confirm.
(function () {
  const $ = (id) => document.getElementById(id);
  const form = $('compose');
  const errorEl = $('send-error');
  const progress = $('send-progress');
  const sendBtn = $('send-btn');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  let token = 'SOL';
  let wallet = null; // { name, provider, address }
  let busy = false;

  const setError = (msg) => { errorEl.textContent = msg || ''; errorEl.hidden = !msg; };
  const setProgress = (msg) => { progress.textContent = msg || ''; };

  function renderWallet() {
    $('wallet-status').textContent = wallet ? `Connected: ${wallet.name} ${UGM.short(wallet.address)}` : 'No wallet connected';
    $('connect').textContent = wallet ? 'Switch' : 'Connect wallet';
    $('from-label').textContent = wallet ? UGM.short(wallet.address).toUpperCase() : 'YOU@SOL';
    $('send-label').textContent = wallet ? 'Seal & send' : 'Connect wallet to send';
  }

  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    sendBtn.setAttribute('aria-busy', String(on));
  }

  async function connect() {
    setError('');
    try {
      wallet = await UGM.connect();
      renderWallet();
      return true;
    } catch (err) {
      if (err.code === 'NO_WALLET') {
        if (UGM.isMobile()) {
          setError('Open this page inside your wallet app\u2019s browser to send. Tap “Open in Phantom” below.');
          progress.innerHTML = '';
          const a = document.createElement('a');
          a.href = UGM.phantomBrowseLink(); a.textContent = 'Open in Phantom'; a.className = 'btn-ghost';
          progress.append(a);
        } else {
          setError('No Solana wallet found in this browser. Install Phantom (phantom.app) or Solflare, then reload this page.');
        }
      } else if (UGM.isUserRejection(err)) {
        setError('Connection cancelled in your wallet.');
      } else {
        setError(err.message);
      }
      return false;
    }
  }

  // Coins come from the server so devnet and mainnet stay in sync.
  UGM.config().then((cfg) => {
    const wrap = $('tokens');
    wrap.innerHTML = '';
    cfg.tokens.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'token'; b.dataset.token = t.symbol; b.textContent = t.symbol;
      b.setAttribute('aria-pressed', String(i === 0));
      b.addEventListener('click', () => {
        token = t.symbol;
        wrap.querySelectorAll('.token').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        $('fee-text').textContent = token === 'SOL' ? 'about 0.00003 SOL' : 'about 0.004 SOL (half comes back)';
      });
      wrap.append(b);
    });
    $('network-tag').textContent = 'SOLANA NETWORK | ' + cfg.tokens.map((t) => t.symbol).join(' · ');
    document.querySelectorAll('.return-days').forEach((el) => { el.textContent = cfg.returnDays; });
  }).catch(() => setError('Couldn\u2019t reach the server. Refresh the page to try again.'));

  // Reconnect silently if the wallet already trusts this site.
  window.addEventListener('load', async () => {
    const found = UGM.findWallet();
    if (!found) return;
    try {
      const out = await found.provider.connect({ onlyIfTrusted: true });
      const pk = out?.publicKey || found.provider.publicKey;
      if (pk) { wallet = { ...found, address: pk.toString() }; renderWallet(); }
    } catch { /* not trusted yet */ }
  });

  $('connect').addEventListener('click', connect);

  $('amount').addEventListener('input', (e) => {
    const clean = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    if (clean !== e.target.value) e.target.value = clean;
    setError('');
  });
  $('email').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    $('to-label').textContent = v ? v.toUpperCase() : 'RECIPIENT@MAIL';
    setError('');
  });

  async function waitForFunding(id, signedTx) {
    for (let i = 0; i < 20; i++) {
      const { status, data } = await UGM.api('/api/send/confirm', i === 0 && signedTx ? { id, signedTx } : { id });
      if (status === 200) return data;
      setProgress('Still waiting on Solana… this can take up to a minute.');
    }
    throw new Error('Solana hasn\u2019t confirmed your transaction yet. Check your tracking link in a few minutes — nothing is lost.');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    const amount = $('amount').value.trim();
    const email = $('email').value.trim();
    if (!parseFloat(amount)) { setError('Add an amount to send.'); $('amount').focus(); return; }
    if (!EMAIL_RE.test(email)) { setError('That email doesn\u2019t look right. Check it and try again.'); $('email').focus(); return; }
    if (!wallet && !(await connect())) return;

    setBusy(true);
    let id;
    try {
      setProgress('Preparing your escrow…');
      const { data: created } = await UGM.api('/api/send/create', {
        token, amount, email, sender: wallet.address, name: $('name').value.trim(), note: $('note').value.trim(),
      });
      id = created.id;

      setProgress(`Approve the transfer in ${wallet.name}…`);
      const tx = solanaWeb3.Transaction.from(UGM.b64ToBytes(created.transaction));
      let signedTx = null;
      if (typeof wallet.provider.signAndSendTransaction === 'function') {
        await wallet.provider.signAndSendTransaction(tx);
      } else {
        const signed = await wallet.provider.signTransaction(tx);
        signedTx = UGM.bytesToB64(signed.serialize());
      }

      setProgress('Sealing it on Solana…');
      const result = await waitForFunding(id, signedTx);

      $('sent-amount').textContent = `${result.amount} ${result.token}`;
      $('sent-email').textContent = result.email;
      $('track-link').href = `/status?id=${encodeURIComponent(id)}`;
      try {
        const saved = JSON.parse(localStorage.getItem('ugm-sends') || '[]');
        saved.unshift({ id, amount: result.amount, token: result.token, email: result.email, at: Date.now() });
        localStorage.setItem('ugm-sends', JSON.stringify(saved.slice(0, 50)));
      } catch { /* storage unavailable */ }
      setProgress('');
      form.hidden = true;
      $('sent').hidden = false;
      $('sent').focus();
    } catch (err) {
      setProgress('');
      if (UGM.isUserRejection(err)) setError('You declined in your wallet. Nothing was sent.');
      else setError(err.message || 'Something went wrong. Try again.');
      if (id && !UGM.isUserRejection(err)) {
        progress.innerHTML = '';
        const a = document.createElement('a');
        a.href = `/status?id=${encodeURIComponent(id)}`; a.textContent = 'Check this send\u2019s status';
        progress.append(a);
      }
    } finally {
      setBusy(false);
    }
  });

  $('send-another').addEventListener('click', () => {
    form.reset();
    $('to-label').textContent = 'RECIPIENT@MAIL';
    $('sent').hidden = true;
    form.hidden = false;
    $('amount').focus();
  });

  renderWallet();
})();
