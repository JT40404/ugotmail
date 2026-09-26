// Email via Resend (https://resend.com). Uses the REST API directly, no SDK needed.
import { escapeHtml, shortKey } from './util.js';
import { RETURN_DAYS, CLUSTER } from './config.js';

async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error('Email not configured: set RESEND_API_KEY and EMAIL_FROM (see README).');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Resend error ${r.status}: ${detail}`);
  }
}

function shell(site, inner, preheader) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>U GOT MAIL</title></head>
<body style="margin:0;padding:0;background:#F6F0E2;">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F0E2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFCF4;border:1px solid #DCD2BC;border-radius:6px;overflow:hidden;">
<tr><td style="padding:24px 24px 0;"><img src="${site}/assets/ugotmailbanner.jpg" width="552" alt="U GOT MAIL" style="display:block;width:100%;height:auto;border:0;border-radius:4px;"></td></tr>
${inner}
<tr><td style="padding:20px 40px;border-top:1px dashed #C9BEA5;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#535869;">We will never ask for your password or seed phrase.${CLUSTER === 'devnet' ? ' This is a Solana devnet test — no real money.' : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendClaimEmail(record, site) {
  const from = record.senderName || shortKey(record.sender);
  const amount = `${record.amount} ${record.token}`;
  const link = `${site}/claim?id=${record.id}`;
  const note = record.note
    ? `<tr><td style="padding:20px 40px 0;font-family:Arial,Helvetica,sans-serif;"><div style="border-left:3px solid #DB3C36;padding-left:16px;"><div style="font-size:13px;color:#535869;margin-bottom:6px;">A note from ${escapeHtml(from)}</div><div style="font-size:18px;line-height:1.5;color:#1F2438;font-style:italic;">“${escapeHtml(record.note)}”</div></div></td></tr>`
    : '';
  const inner = `
<tr><td style="padding:36px 40px 8px;font-family:Arial,Helvetica,sans-serif;color:#1F2438;">
<h1 style="margin:0 0 24px;font-size:32px;line-height:1.1;font-weight:700;">${escapeHtml(from)} sent you crypto.</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1.5px dashed #33468F;border-radius:8px;"><tr><td style="padding:20px 22px;font-family:Arial,Helvetica,sans-serif;">
<div style="font-size:13px;color:#535869;font-weight:bold;">Sealed inside</div>
<div style="font-family:'Courier New',monospace;font-size:32px;font-weight:bold;color:#33468F;">${escapeHtml(amount)}</div>
</td></tr></table></td></tr>
${note}
<tr><td style="padding:32px 40px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#33468F" style="border-radius:12px;">
<a href="${link}" style="display:block;padding:18px 24px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#FFFCF4;text-decoration:none;">Open your mail</a>
</td></tr></table></td></tr>
<tr><td style="padding:20px 40px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#535869;">
Only you can open this: we'll email a one-time code to this address to confirm it's you. You don't need a crypto wallet — you can create one when you claim.<br><br>
Not expecting this? Ignore it. If it isn't claimed within ${RETURN_DAYS} days, it goes back to the sender.
</td></tr>`;

  await sendEmail({
    to: record.email,
    subject: `U got mail: ${amount} from ${from}`,
    html: shell(site, inner, `${from} sent you ${amount}. Only you can open it.`),
    text: `${from} sent you ${amount} with U GOT MAIL.${record.note ? `\n\nTheir note: "${record.note}"` : ''}\n\nOpen your mail: ${link}\n\nWe'll email a one-time code to this address to confirm it's you. Unclaimed sends return to the sender after ${RETURN_DAYS} days.`,
  });
}

export async function sendCodeEmail(record, code, site) {
  const inner = `
<tr><td style="padding:36px 40px 32px;font-family:Arial,Helvetica,sans-serif;color:#1F2438;">
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;">Your code to open your mail</h1>
<div style="font-family:'Courier New',monospace;font-size:44px;font-weight:bold;letter-spacing:10px;color:#33468F;margin:8px 0 20px;">${code}</div>
<p style="margin:0;font-size:15px;line-height:1.6;color:#535869;">Enter it on the claim page to open ${escapeHtml(record.amount)} ${escapeHtml(record.token)}. It expires in 10 minutes. If you didn't ask for this code, ignore this email — nobody can claim without it.</p>
</td></tr>`;
  await sendEmail({
    to: record.email,
    subject: `${code} is your U GOT MAIL code`,
    html: shell(site, inner, `Your code: ${code}`),
    text: `Your U GOT MAIL code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
  });
}
