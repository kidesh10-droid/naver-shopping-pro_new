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

    // --- [현실 고증 보정 로직] ---

    // 1. 기본 CPC 범위를 쇼핑광고 수준으로 대폭 상향
    const cpcRange = {
      high: { pc: { min: 1200, max: 6000, avg: 2200 }, mobile: { min: 800, max: 4500, avg: 1800 } },
      mid: { pc: { min: 500, max: 1500, avg: 900 }, mobile: { min: 300, max: 1200, avg: 700 } },
      low: { pc: { min: 100, max: 500, avg: 300 }, mobile: { min: 70, max: 400, avg: 200 } },
    };

    // 2. 키워드별 가중치 부여 (진공포장기, 이어폰 등 초경쟁 카테고리)
    const getAdjustedCpc = (kw, baseAvg, idx, total) => {
      let factor = 1.0;
      const superHighKw = ['이어폰', '포장기', '청소기', '노트북', '영양제', '다이어트', '화장품', '공기청정기'];
      const highKw = ['침구', '의자', '조명', '테이블', '텐트'];

      if (superHighKw.some(v => kw.includes(v))) {
        factor *= 4.5; // 고경쟁 가전/기기는 4.5배 뻥튀기 (현실 입찰가 반영)
      } else if (highKw.some(v => kw.includes(v))) {
        factor *= 2.8;
      } else if (idx === 'high') {
        factor *= 1.8;
      }

      let finalCpc = Math.floor(baseAvg * factor);

      // 초경쟁 키워드는 최소 방어선 구축 (1,800원 이하로 안 나오게)
      if (superHighKw.some(v => kw.includes(v)) && finalCpc < 1850) {
        finalCpc = 1980; 
      }
      return finalCpc;
    };

    const range = cpcRange[compIdx] || cpcRange['mid'];
    const devRange = device === 'mobile' ? range.mobile : range.pc;
    
    // 최종 보정 CPC 산출
    const cpc = getAdjustedCpc(keyword, devRange.avg, compIdx, totalCnt);
    const budgetNum = parseInt(budget) || 100000;
    
    // 예상 수치 재계산
    const estClicks = Math.floor(budgetNum / cpc);
    const estImpressions = Math.floor(totalCnt * (device === 'mobile' ? 0.08 : 0.04));

    // 경쟁강도 레이블 현실화 (API의 '낮음' 무시하고 직접 판단)
    const getCompLabel = (idx, total, currentCpc) => {
      if (currentCpc > 1800 || (idx === 'high' && total > 30000)) return '레드오션(극심)';
      if (currentCpc > 800 || total > 10000) return '치열함';
      if (idx === 'mid' || total > 5000) return '보통';
      return '틈새시장(낮음)';
    };

    const compLabel = getCompLabel(compIdx, totalCnt, cpc);

    // --- [연관 키워드 처리] ---
    const related = kwList.slice(0, 10).map(k => {
      const kComp = k.compIdx || 'mid';
      const kTotal = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
      const kRange = cpcRange[kComp] || cpcRange['mid'];
      const kDev = device === 'mobile' ? kRange.mobile : kRange.pc;
      const kCpc = getAdjustedCpc(k.relKeyword, kDev.avg, kComp, kTotal);
      
      return {
        keyword: k.relKeyword,
        pcQcCnt: parseInt(k.monthlyPcQcCnt) || 0,
        mobileQcCnt: parseInt(k.monthlyMobileQcCnt) || 0,
        cpcMin: Math.floor(kCpc * 0.8),
        cpcMax: Math.floor(kCpc * 1.3),
        cpcAvg: kCpc,
        compIdx: kComp,
        compLabel: getCompLabel(kComp, kTotal, kCpc),
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
      cpcMin: Math.floor(cpc * 0.85),
      cpcMax: Math.floor(cpc * 1.2),
      estClicks,
      estImpressions,
      compIdx: compLabel, // 현실적인 레이블로 교체
      related,
    });

  } catch (e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
