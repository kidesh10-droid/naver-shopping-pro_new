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
    const compIdx = main.compIdx || 'mid';

    // 경쟁강도 기반 예상 CPC 범위
    const cpcRange = {
      high:   { pc: { min: 800,  max: 3000, avg: 1500 }, mobile: { min: 400,  max: 1500, avg: 800  } },
      mid:    { pc: { min: 300,  max: 800,  avg: 500  }, mobile: { min: 150,  max: 500,  avg: 300  } },
      low:    { pc: { min: 50,   max: 300,  avg: 150  }, mobile: { min: 30,   max: 150,  avg: 80   } },
    };
    const range = cpcRange[compIdx] || cpcRange['mid'];
    const devRange = device === 'mobile' ? range.mobile : range.pc;
    const cpc = devRange.avg;
    const budgetNum = parseInt(budget) || 100000;
    const estClicks = Math.floor(budgetNum / cpc);
    const estImpressions = Math.floor(estClicks * (100 / (devRange.avg / 100)));

    // 연관 키워드
    const related = kwList.slice(0, 10).map(k => {
      const kComp = k.compIdx || 'mid';
      const kRange = cpcRange[kComp] || cpcRange['mid'];
      const kDev = device === 'mobile' ? kRange.mobile : kRange.pc;
      return {
        keyword: k.relKeyword,
        pcQcCnt: parseInt(k.monthlyPcQcCnt) || 0,
        mobileQcCnt: parseInt(k.monthlyMobileQcCnt) || 0,
        cpcMin: kDev.min,
        cpcMax: kDev.max,
        cpcAvg: kDev.avg,
        compIdx: kComp,
        estClicks: Math.floor(budgetNum / kDev.avg),
      };
    });

    return res.status(200).json({
      keyword, device: device || 'pc', budget: budgetNum,
      pcQcCnt: pcCnt, mobileQcCnt: mobCnt, totalQcCnt: totalCnt,
      cpc, cpcMin: devRange.min, cpcMax: devRange.max,
      estClicks, estImpressions, compIdx, related,
    });

  } catch(e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
