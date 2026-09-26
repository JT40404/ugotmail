// Email a one-time code to the address the send was addressed to.
import {
  route, reply, readBody, HttpError, getSend, saveSend, withLock, randomCode, hashCode,
} from '../../lib/util.js';
import { siteUrl, CODE_TTL_SEC, CODE_RESEND_COOLDOWN_SEC } from '../../lib/config.js';
import { sendCodeEmail } from '../../lib/email.js';

export default route(['POST'], async (req, res) => {
  const { id } = readBody(req);
  const out = await withLock(id, async () => {
    const record = await getSend(id);
    if (!record || record.status === 'pending_funding') throw new HttpError(404, 'We couldn\u2019t find this mail.');
    if (record.status !== 'funded') throw new HttpError(409, 'This mail can\u2019t be opened anymore.');

    const now = Date.now();
    const waitMs = (record.code?.sentAt || 0) + CODE_RESEND_COOLDOWN_SEC * 1000 - now;
    if (waitMs > 0) throw new HttpError(429, `We just sent a code. You can ask for another in ${Math.ceil(waitMs / 1000)} seconds.`);

    const code = randomCode();
    await sendCodeEmail(record, code, siteUrl(req));
    record.code = { hash: hashCode(id, code), expiresAt: now + CODE_TTL_SEC * 1000, attempts: 0, sentAt: now };
    await saveSend(record);
    return record;
  });
  reply(res, 200, { sentTo: out.email });
});
