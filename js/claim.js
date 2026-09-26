// U GOT MAIL — claim flow: load send -> email code -> verify -> choose wallet -> claim.
(function () {
  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id');
  const panels = ['message', 'ask', 'verify', 'claim', 'done'];
  let send = null;
  let session = null;
  let dest = 'wallet';
  let newWallet = null; // { address, secret }

  function show(panel) { panels.forEach((p) => { $(p).hidden = p !== panel; }); }
  function err(elId, msg) { $(elId).textContent = msg || ''; $(elId).hidden = !msg; }
  function message(title, body, link) {
    $('message-title').textContent = title;
    $('message-body').textContent = body || '';
    $('message-link').hidden = !link;
    show('message');
  }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', String(on)); }

  function fill(s) {
    send = s;
    const amount = `${s.amount} ${s.token}`;
    document.querySelectorAll('.amount-text').forEach((el) => { el.textContent = amount; });
    document.querySelectorAll('.to-text').forEach((el) => { el.textContent = s.email; });
    $('headline').innerHTML = '';
    $('headline').append('U got mail', document.createElement('br'), `from ${s.senderName}.`);
    if (s.note) { $('note').textContent = `\u201C${s.note}\u201D`; $('note').hidden = false; }
    $('sealed').hidden = false;
    $('spl-gas-note').hidden = s.token === 'SOL';
  }

  async function finished(s) {
    $('sealed-label').textContent = 'Claimed';
    $('progress').textContent = 'Delivered';
    const to = dest === 'new' ? 'your new wallet' : 'your wallet';
    $('done-msg').textContent = `${s.amount} ${s.token} is in ${to}.`;
    if (s.releaseTx) $('done-tx').href = s.releaseTx; else $('done-tx').hidden = true;
    show('done');
    $('done').focus();
  }

  async function load() {
    if (!id) return message('This link is incomplete.', 'Open the link from your email again. If it still doesn\u2019t work, copy the full link into your browser.', true);
    try {
      const { data } = await UGM.api(`/api/claim/info?id=${encodeURIComponent(id)}`);
      fill(data);
      const closed = {
        claimed: ['Already opened.', 'This mail was claimed. Check the wallet it was sent to.'],
        cancelled: ['This send was cancelled.', 'The sender took it back before it was opened.'],
        returned: ['This mail expired.', 'It wasn\u2019t claimed in time, so it went back to the sender.'],
        processing: ['Almost there.', 'A transfer for this mail is confirming on Solana. Refresh in a minute.'],
      }[data.status];
      if (closed) { $('progress').textContent = ''; return message(closed[0], closed[1], true); }
      $('progress').textContent = 'Step 1 of 2: verify';
      show('ask');
    } catch (e) {
      $('headline').textContent = 'Mail not found.';
      message('We couldn\u2019t find this mail.', e.message, true);
    }
  }

  async function requestCode(errId) {
    const { data } = await UGM.api('/api/claim/request-code', { id });
    return data;
  }

  $('send-code').addEventListener('click', async () => {
    const btn = $('send-code');
    busy(btn, true); err('ask-error', '');
    try {
      await requestCode();
      show('verify');
      $('code').focus();
    } catch (e) {
      if (e.status === 429) { show('verify'); err('verify-error', e.message); }
      else err('ask-error', e.message);
    } finally { busy(btn, false); }
  });

  $('resend').addEventListener('click', async () => {
    err('verify-error', '');
    try {
      await requestCode();
      err('verify-error', '');
      $('code').value = '';
      $('code').focus();
      $('resend').textContent = 'New code sent';
      setTimeout(() => { $('resend').textContent = 'Send a new code'; }, 4000);
    } catch (e) { err('verify-error', e.message); }
  });

  $('code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    err('verify-error', '');
  });

  $('verify').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('code').value;
    if (code.length !== 6) { err('verify-error', 'Enter all 6 digits from the email.'); return; }
    const btn = $('verify-btn');
    busy(btn, true);
    try {
      const { data } = await UGM.api('/api/claim/verify', { id, code });
      session = data.session;
      $('progress').textContent = 'Step 2 of 2: claim';
      show('claim');
      $('claim').focus();
      if (UGM.findWallet()) $('use-connected').hidden = false;
    } catch (e2) { err('verify-error', e2.message); }
    finally { busy(btn, false); }
  });

  // Destination choice
  document.querySelectorAll('.dest').forEach((btn) => {
    btn.addEventListener('click', () => {
      dest = btn.dataset.dest;
      document.querySelectorAll('.dest').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      $('dest-wallet').hidden = dest !== 'wallet';
      $('dest-new').hidden = dest !== 'new';
      err('claim-error', '');
      if (dest === 'new' && !newWallet) {
        const kp = solanaWeb3.Keypair.generate(); // generated in this browser only
        newWallet = { address: kp.publicKey.toBase58(), secret: UGM.base58(kp.secretKey) };
        $('new-address').textContent = newWallet.address;
        $('new-secret').textContent = newWallet.secret;
      }
    });
  });

  $('use-connected').addEventListener('click', async () => {
    try {
      const w = await UGM.connect();
      $('addr').value = w.address;
      err('claim-error', '');
    } catch (e) {
      if (!UGM.isUserRejection(e)) err('claim-error', e.message === 'NO_WALLET' ? 'No wallet found in this browser.' : e.message);
    }
  });

  $('copy-secret').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(newWallet.secret);
      $('copy-secret').textContent = 'Copied';
      setTimeout(() => { $('copy-secret').textContent = 'Copy private key'; }, 3000);
    } catch { err('claim-error', 'Couldn\u2019t copy. Select the key and copy it by hand.'); }
  });

  $('download-secret').addEventListener('click', () => {
    const text = `U GOT MAIL wallet\n\nAddress: ${newWallet.address}\nPrivate key: ${newWallet.secret}\n\nKeep this file private. Anyone with the private key controls this wallet.\nImport it into Phantom or Solflare: Add account > Import private key.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `ugotmail-wallet-${newWallet.address.slice(0, 6)}.txt`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // Warn before leaving with an unsaved new key.
  window.addEventListener('beforeunload', (e) => {
    if (newWallet && dest === 'new' && $('done').hidden) { e.preventDefault(); e.returnValue = ''; }
  });

  $('claim').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('claim-error', '');
    let destination;
    if (dest === 'wallet') {
      destination = $('addr').value.trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination)) {
        err('claim-error', 'That doesn\u2019t look like a Solana address. It\u2019s 32\u201344 letters and numbers.');
        $('addr').focus();
        return;
      }
    } else {
      if (!$('saved').checked) { err('claim-error', 'Save your private key first, then tick the box.'); return; }
      destination = newWallet.address;
    }

    const btn = $('claim-btn');
    busy(btn, true);
    $('claim-progress').textContent = 'Sending it to your wallet…';
    try {
      for (let i = 0; i < 15; i++) {
        const { status, data } = await UGM.api('/api/claim/withdraw', { id, session, destination });
        if (status === 200) { $('claim-progress').textContent = ''; return finished(data); }
        $('claim-progress').textContent = 'Solana is confirming the transfer…';
      }
      $('claim-progress').textContent = '';
      err('claim-error', 'The transfer is still confirming. Refresh this page in a few minutes to check.');
    } catch (e2) {
      $('claim-progress').textContent = '';
      err('claim-error', e2.message);
      if (e2.status === 401) { session = null; show('ask'); err('ask-error', e2.message); }
    } finally { busy(btn, false); }
  });

  load();
})();
