import { route, reply, HttpError, getSend } from '../../lib/util.js';
import { publicView } from '../../lib/sends.js';

export default route(['GET'], async (req, res) => {
  const record = await getSend(req.query.id);
  if (!record || record.status === 'pending_funding') {
    throw new HttpError(404, 'We couldn\u2019t find this mail. Open the link from your email again.');
  }
  reply(res, 200, publicView(record));
});
