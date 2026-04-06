
const https = require('https');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { keyword, startDate, endDate, timeUnit } = req.query;
  if (!keyword) return res.status(400).json({ errorMessage: '키워드를 입력해주세요.' });
  const body = JSON.stringify({
    startDate: startDate || (() => { const d=new Date(); d.setFullYear(d.getFullYear()-1); return d.toISOString().slice(0,10); })(),
    endDate: endDate || new Date().toISOString().slice(0,10),
    timeUnit: timeUnit || 'month',
    keywordGroups: [{ groupName: keyword, keywords: [keyword] }]
  });
  try {
    const data = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'openapi.naver.com', path: '/v1/datalab/search', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Naver-Client-Id': process.env.NAVER_DATALAB_CLIENT_ID, 'X-Naver-Client-Secret': process.env.NAVER_DATALAB_CLIENT_SECRET }
      }, (res2) => { let d=''; res2.on('data',c=>d+=c); res2.on('end',()=>resolve({status:res2.statusCode,body:d})); });
      r.on('error',reject); r.write(body); r.end();
    });
    res.status(data.status).send(data.body);
  } catch(e) { res.status(500).json({ errorMessage: e.message }); }
};
