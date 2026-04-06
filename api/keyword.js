
const https = require('https');
const crypto = require('crypto');
const CUSTOMER_ID = '2905718';

function makeSign(timestamp, method, path) {
  const msg = `${timestamp}.${method}.${path}`;
  return crypto.createHmac('sha256', Buffer.from(process.env.NAVER_AD_SECRET_KEY, 'utf-8'))
    .update(Buffer.from(msg, 'utf-8')).digest('base64');
}

function adRequest(path) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const basePath = path.split('?')[0];
    function doReq(opts) {
      https.request(opts, (r) => {
        if ([301,302,308].includes(r.statusCode)) {
          const u = new URL(r.headers.location);
          doReq({ ...opts, hostname: u.hostname, path: u.pathname + u.search });
          return;
        }
        let b = ''; r.on('data', c => b += c); r.on('end', () => resolve({ status: r.statusCode, body: b }));
      }).on('error', reject).end();
    }
    doReq({
      hostname: 'api.naver.com', port: 443, path, method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Timestamp': timestamp,
        'X-API-KEY': process.env.NAVER_AD_ACCESS_LICENSE,
        'X-Customer': CUSTOMER_ID,
        'X-Signature': makeSign(timestamp, 'GET', basePath),
      }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ errorMessage: '키워드를 입력해주세요.' });
  try {
    const [kwRes, bidRes] = await Promise.all([
      adRequest(`/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`),
      adRequest(`/estimate/average/list?keywords=${encodeURIComponent(keyword)}&device=pc&target=QUERY`)
    ]);
    res.status(200).json({
      keyword: JSON.parse(kwRes.body),
      bid: bidRes.status === 200 ? JSON.parse(bidRes.body) : null
    });
  } catch(e) { res.status(500).json({ errorMessage: e.message }); }
};
