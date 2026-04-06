const https = require('https');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { query, start, display, sort, filter } = req.query;
  if (!query) return res.status(400).json({ errorMessage: '검색어를 입력해주세요.' });
  const params = new URLSearchParams({ query, start: start||'1', display: display||'100', sort: sort||'sim' });
  if (filter) params.append('filter', filter);
  try {
    const data = await new Promise((resolve, reject) => {
      https.get({ hostname: 'openapi.naver.com', path: `/v1/search/shop.json?${params}`,
        headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET }
      }, (r) => { let b=''; r.on('data',c=>b+=c); r.on('end',()=>resolve({status:r.statusCode,body:b})); }).on('error',reject);
    });
    res.status(data.status).send(data.body);
  } catch(e) { res.status(500).json({ errorMessage: e.message }); }
};
