import { route, reply } from '../lib/util.js';
import { CLUSTER, TOKENS, RETURN_DAYS } from '../lib/config.js';

export default route(['GET'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    cluster: CLUSTER,
    tokens: Object.values(TOKENS).map(({ symbol, decimals }) => ({ symbol, decimals })),
    returnDays: RETURN_DAYS,
  });
});
