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
          if ([301, 302, 308].includes(r.statusCode)) {
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

    // --- [MD 보정 로직 시작] ---
    
    // 1. 기본 CPC 범위 설정 (현실적인 쇼핑광고 수준으로 상향)
    const cpcRange = {
      high: { pc: { min: 800, max: 5000, avg: 1800 }, mobile: { min: 500, max: 3000, avg: 1200 } },
      mid: { pc: { min: 300, max: 1200, avg: 600 }, mobile: { min: 200, max: 800, avg: 400 } },
      low: { pc: { min: 70, max: 400, avg: 200 }, mobile: { min: 50, max: 250, avg: 120 } },
    };

    // 2. 키워드 성격에 따른 가중치 부여 함수
    const getAdjustedCpc = (kw, baseAvg, idx, total) => {
      let factor = 1.0;
      const highValueKw = ['이어폰', '가전', '노트북', '청소기', '다이어트', '영양제', '화장품', '침대'];
      
      // 고단가/고경쟁 카테고리 가중치
      if (highValueKw.some(v => kw.includes(v))) factor *= 2.2;
      
      // 검색량 폭발 키워드 가중치 (High 경쟁일 때)
      if (idx === 'high' && total > 50000) factor *= 1.8;
      else if (idx === 'high' && total > 10000) factor *= 1.4;

      return Math.floor(baseAvg * factor);
    };

    const range = cpcRange[compIdx] || cpcRange['mid'];
    const devRange = device === 'mobile' ? range.mobile : range.pc;
    
    // 최종 보정된 CPC
    const cpc = getAdjustedCpc(keyword, devRange.avg, compIdx, totalCnt);
    const budgetNum = parseInt(budget) || 100000;
    
    // 예상 클릭수 & 노출수 재계산
    const estClicks = Math.floor(budgetNum / cpc);
    // 노출수는 검색량의 일부가 광고 지면으로 전환된다는 현실적 가정 (약 5~10%)
    const estImpressions = Math.floor(totalCnt * (device === 'mobile' ? 0.08 : 0.04));

    // 경쟁강도 레이블 현실화
    const getCompLabel = (idx, total) => {
      if (idx === 'high' && total > 40000) return '레드오션(치열)';
      if (idx === 'high') return '높음';
      if (idx === 'mid') return '보통';
      return '틈새시장(낮음)';
    };

    // --- [연관 키워드 처리] ---
    const related = kwList.slice(0, 10).map(k => {
      const kComp = k.compIdx || 'mid';
      const kTotal = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
      const kRange = cpcRange[kComp] || cpcRange['mid'];
      const kDev = device === 'mobile' ? kRange.mobile : kRange.pc;
      
      // 연관 키워드에도 동일한 보정 적용
      const kCpc = getAdjustedCpc(k.relKeyword, kDev.avg, kComp, kTotal);
      
      return {
        keyword: k.relKeyword,
        pcQcCnt: parseInt(k.monthlyPcQcCnt) || 0,
        mobileQcCnt: parseInt(k.monthlyMobileQcCnt) || 0,
        cpcMin: Math.floor(kCpc * 0.7),
        cpcMax: Math.floor(kCpc * 1.5),
        cpcAvg: kCpc,
        compIdx: kComp,
        compLabel: getCompLabel(kComp, kTotal),
        estClicks: Math.floor(budgetNum / kCpc),
      };
    });

    return res.status(200).json({
      keyword,
      device: device || 'pc',
      budget: budgetNum,
      pcQcCnt: pcCnt,
      mobileQcCnt: mobCnt,
      totalQcCnt: totalCnt,
      cpc,
      cpcMin: Math.floor(cpc * 0.8),
      cpcMax: Math.floor(cpc * 1.3),
      estClicks,
      estImpressions,
      compIdx: getCompLabel(compIdx, totalCnt),
      related,
    });

  } catch (e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
