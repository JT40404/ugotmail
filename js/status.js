// U GOT MAIL — track a send and let the sender cancel it.
(function () {
  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id');
  const fmt = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const LABELS = {
    pending_funding: ['Waiting for Solana', 'We haven\u2019t seen your transfer land yet. If you approved it, give it a minute and refresh.'],
    funded: ['Waiting to be opened', 'The recipient has their claim email. You can cancel until they claim it.'],
    processing: ['Transfer confirming', 'Funds are moving on Solana right now. Refresh in a minute.'],
    claimed: ['Claimed', 'The recipient opened it and the funds are in their wallet.'],
    cancelled: ['Cancelled', 'You cancelled this send. Anything in escrow went back to your wallet.'],
    returned: ['Returned', 'It wasn\u2019t claimed in time, so it went back to your wallet.'],
  };

  function render(s) {
    $('s-amount').textContent = `${s.amount} ${s.token}`;
    $('s-badge').textContent = (LABELS[s.status] || [s.status])[0];
    $('s-badge').dataset.state = s.status;
    $('s-email').textContent = s.email;
    $('s-from').textContent = `${s.senderName} (${UGM.short(s.sender)})`;
    $('s-created').textContent = fmt(s.createdAt);
    $('s-expires-row').hidden = !(s.expiresAt && s.status === 'funded');
    if (s.expiresAt) $('s-expires').textContent = `${fmt(s.expiresAt)} if unclaimed`;
    $('s-escrow').textContent = UGM.short(s.escrow);
    $('s-escrow').href = s.escrowUrl;
    $('s-tx-row').hidden = !s.releaseTx;
    if (s.releaseTx) $('s-tx').href = s.releaseTx;
    $('s-explain').textContent = (LABELS[s.status] || ['', ''])[1];
    $('cancel').hidden = !['funded', 'pending_funding'].includes(s.status);
  }

  async function loadOne() {
    $('one').hidden = false;
    try {
      const { data } = await UGM.api(`/api/send/status?id=${encodeURIComponent(id)}`);
      render(data);
      return data;
    } catch (e) {
      $('s-amount').textContent = 'Not found';
      $('s-explain').textContent = e.message;
    }
  }

  function loadList() {
    $('list').hidden = false;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('ugm-sends') || '[]'); } catch { /* ignore */ }
    if (!saved.length) { $('empty').hidden = false; return; }
    saved.forEach((s) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/status?id=${encodeURIComponent(s.id)}`;
      const amt = document.createElement('strong'); amt.textContent = `${s.amount} ${s.token}`;
      const to = document.createElement('span'); to.textContent = `to ${s.email}`;
      const when = document.createElement('span'); when.className = 'when'; when.textContent = fmt(s.at);
      a.append(amt, to, when);
      li.append(a);
      $('send-list').append(li);
    });
  }

  $('cancel').addEventListener('click', async () => {
    const btn = $('cancel');
    $('s-error').hidden = true;
    btn.disabled = true;
    try {
      const w = await UGM.connect();
      const { data: current } = await UGM.api(`/api/send/status?id=${encodeURIComponent(id)}`);
      if (w.address !== current.sender) throw new Error(`Connect the wallet that sent this (${UGM.short(current.sender)}). You're connected as ${UGM.short(w.address)}.`);
      $('s-progress').textContent = 'Sign the cancel message in your wallet…';
      const msg = new TextEncoder().encode(`Cancel U GOT MAIL send ${id}`);
      const out = await w.provider.signMessage(msg, 'utf8');
      const sig = out?.signature || out;
      $('s-progress').textContent = 'Returning funds to your wallet…';
      let res = await UGM.api('/api/send/cancel', { id, signature: UGM.bytesToB64(new Uint8Array(sig)) });
      for (let i = 0; i < 15 && res.status === 202; i++) {
        res = await UGM.api('/api/send/cancel', { id, signature: UGM.bytesToB64(new Uint8Array(sig)) });
      }
      render(res.data);
      $('s-progress').textContent = res.status === 202 ? 'Still confirming on Solana. Refresh in a minute.' : '';
    } catch (e) {
      $('s-progress').textContent = '';
      $('s-error').textContent = e.code === 'NO_WALLET'
        ? 'Open this page in the browser where your sending wallet is installed.'
        : UGM.isUserRejection(e) ? 'Cancel stopped in your wallet. The send is unchanged.' : e.message;
      $('s-error').hidden = false;
    } finally { btn.disabled = false; }
  });

  if (id) loadOne(); else loadList();
})();
