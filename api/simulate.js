const https = require('https');
const crypto = require('crypto');
const CUSTOMER_ID = '2905718';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  const { keyword, budget, device } = req.query;
  if (!keyword) return res.status(200).json({ errorMessage: '키워드를 입력해주세요.' });
  
  try {
    const timestamp = Date.now().toString();
    const path = '/estimate/average/list';
    const msg = `${timestamp}.GET.${path}`;
    const signature = crypto.createHmac('sha256', Buffer.from(process.env.NAVER_AD_SECRET_KEY, 'utf-8'))
      .update(Buffer.from(msg, 'utf-8')).digest('base64');
    const fullPath = `${path}?keywords=${encodeURIComponent(keyword)}&device=${device||'pc'}&target=QUERY`;

    const data = await new Promise((resolve, reject) => {
      function doReq(opts) {
        https.request(opts, (r) => {
          if ([301,302,308].includes(r.statusCode)) {
            const u = new URL(r.headers.location);
            doReq({ ...opts, hostname: u.hostname, path: u.pathname + u.search });
            return;
          }
          let b = '';
          r.on('data', c => b += c);
          r.on('end', () => resolve({ status: r.statusCode, body: b }));
        }).on('error', reject).end();
      }
      doReq({
        hostname: 'api.naver.com', port: 443, path: fullPath, method: 'GET',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Timestamp': timestamp,
          'X-API-KEY': process.env.NAVER_AD_ACCESS_LICENSE,
          'X-Customer': CUSTOMER_ID,
          'X-Signature': signature
        }
      });
    });

    // 빈 응답 처리
    if (!data.body || data.body.trim() === '') {
      return res.status(200).json({ errorMessage: `빈 응답 (status: ${data.status}). 광고 API 키를 확인해주세요.` });
    }

    // JSON 파싱 시도
    try {
      const parsed = JSON.parse(data.body);
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(200).json({ errorMessage: `파싱 오류: ${data.body.slice(0,200)}` });
    }

  } catch(e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
