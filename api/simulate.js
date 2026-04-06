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
    const path = '/keywordstool';
    const msg = `${timestamp}.GET.${path}`;
    const signature = crypto.createHmac('sha256', Buffer.from(process.env.NAVER_AD_SECRET_KEY, 'utf-8'))
      .update(Buffer.from(msg, 'utf-8')).digest('base64');

    const data = await new Promise((resolve, reject) => {
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
        hostname: 'api.naver.com', port: 443,
        path: `/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Timestamp': timestamp,
          'X-API-KEY': process.env.NAVER_AD_ACCESS_LICENSE,
          'X-Customer': CUSTOMER_ID,
          'X-Signature': signature,
        }
      });
    });

    if (!data.body || data.body.trim() === '') {
      return res.status(200).json({ errorMessage: '데이터가 없습니다.' });
    }

    const parsed = JSON.parse(data.body);
    const kwList = (parsed.keywordList || []).filter(k => k.relKeyword);
    const main = kwList.find(k => k.relKeyword === keyword) || kwList[0] || {};

    const pcCnt = parseInt(main.monthlyPcQcCnt) || 0;
    const mobCnt = parseInt(main.monthlyMobileQcCnt) || 0;
    const totalCnt = pcCnt + mobCnt;
    const pcCpc = parseInt(main.avgMonthlyPcClkCost) || 0;
    const mobCpc = parseInt(main.avgMonthlyMobileClkCost) || 0;
    const cpc = device === 'mobile' ? mobCpc : pcCpc;
    const budgetNum = parseInt(budget) || 100000;
    const estClicks = cpc > 0 ? Math.floor(budgetNum / cpc) : 0;
    const pcCtr = parseFloat(main.avgMonthlyPcCtr) || 0;
    const mobCtr = parseFloat(main.avgMonthlyMobileCtr) || 0;
    const ctr = device === 'mobile' ? mobCtr : pcCtr;
    const estImpressions = ctr > 0 ? Math.floor(estClicks / (ctr / 100)) : estClicks * 10;
    const compIdx = main.compIdx || 'mid';

    // 연관 키워드 상위 10개 CPC
    const related = kwList.slice(0, 10).map(k => ({
      keyword: k.relKeyword,
      pcQcCnt: parseInt(k.monthlyPcQcCnt) || 0,
      mobileQcCnt: parseInt(k.monthlyMobileQcCnt) || 0,
      pcCpc: parseInt(k.avgMonthlyPcClkCost) || 0,
      mobileCpc: parseInt(k.avgMonthlyMobileClkCost) || 0,
      compIdx: k.compIdx || 'mid',
    }));

    return res.status(200).json({
      keyword,
      device: device || 'pc',
      budget: budgetNum,
      pcQcCnt: pcCnt,
      mobileQcCnt: mobCnt,
      totalQcCnt: totalCnt,
      pcCpc,
      mobileCpc: mobCpc,
      cpc,
      estClicks,
      estImpressions,
      ctr: Math.round(ctr * 100) / 100,
      compIdx,
      related,
    });

  } catch(e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
