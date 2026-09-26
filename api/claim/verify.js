// Check the one-time code. Success returns a short-lived session for withdrawing.
import {
  route, reply, readBody, HttpError, getSend, saveSend, withLock, hashCode, safeEqual, randomId, db,
} from '../../lib/util.js';
import { CODE_MAX_ATTEMPTS, SESSION_TTL_SEC } from '../../lib/config.js';

export default route(['POST'], async (req, res) => {
  const { id, code } = readBody(req);
  const session = await withLock(id, async () => {
    const record = await getSend(id);
    if (!record || record.status !== 'funded') throw new HttpError(409, 'This mail can\u2019t be opened anymore.');
    const c = record.code;
    if (!c) throw new HttpError(400, 'Ask for a code first.');
    if (Date.now() > c.expiresAt) throw new HttpError(400, 'That code has expired. Ask for a new one.');
    if (c.attempts >= CODE_MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');

    if (!/^\d{6}$/.test(String(code || '')) || !safeEqual(hashCode(id, String(code)), c.hash)) {
      c.attempts += 1;
      await saveSend(record);
      const left = CODE_MAX_ATTEMPTS - c.attempts;
      throw new HttpError(400, left > 0 ? `That code isn\u2019t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
    }

    delete record.code;
    await saveSend(record);
    const token = randomId();
    await db().set(`session:${token}`, id, { ex: SESSION_TTL_SEC });
    return token;
  });
  reply(res, 200, { session });
});
