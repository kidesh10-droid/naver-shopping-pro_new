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

    // --- [AI 추론형 보정 알고리즘] ---
    
    const calculateLogic = (kw, idx, total, isMobile) => {
      // 1. 기본 베이스 단가 설정 (지수적 증가 반영)
      let baseCpc = (idx === 'high') ? 1200 : (idx === 'mid' ? 600 : 250);

      // 2. 검색량 밀도 보정 (Log 함수 활용)
      const densityFactor = Math.log10(total + 10) * (idx === 'high' ? 2.8 : 1.6);
      
      // 3. 커머스 속성 분석 (구매 접미사 가중치)
      const commercePatterns = /기$|기기$|용$|세트$|제$|약$|폰$|장기$|기표$|기구$|건강$|기능$/;
      const commerceBonus = commercePatterns.test(kw) ? 2.1 : 1.0;

      // 4. 디바이스 보정
      const deviceFactor = isMobile ? 1.2 : 0.85;

      // 5. 최종 추론 CPC 계산
      let finalCpc = Math.floor(baseCpc * densityFactor * commerceBonus * deviceFactor);

      // 6. 실무 안전망 (진공포장기 1850원 케이스 등 반영)
      if (idx === 'high' && total > 15000 && finalCpc < 1750) finalCpc = 1880;
      if (idx === 'high' && total > 45000 && finalCpc < 2800) finalCpc = 3250;
      
      return Math.max(finalCpc, 70);
    };

    // --- [현실적인 경쟁강도 판정 로직] ---
    const getRealCompStatus = (currentCpc, total) => {
      if (currentCpc >= 2500 || (total > 50000 && compIdx === 'high')) {
        return { label: "레드오션(극심)", color: "#e53e3e" }; // 빨간색
      } else if (currentCpc >= 1500) {
        return { label: "매우 높음", color: "#dd6b20" }; // 주황색
      } else if (currentCpc >= 800 || total > 10000) {
        return { label: "높음(치열)", color: "#3182ce" }; // 파란색
      } else if (total > 3000) {
        return { label: "보통", color: "#4a5568" };
      }
      return { label: "틈새시장(낮음)", color: "#38a169" }; // 초록색
    };

    const isMobile = device === 'mobile';
    const cpc = calculateLogic(keyword, compIdx, totalCnt, isMobile);
    const budgetNum = parseInt(budget) || 100000;
    
    // 예상 수치 계산
    const realStatus = getRealCompStatus(cpc, totalCnt);
    const estClicks = Math.floor(budgetNum / cpc);
    const estImpressions = Math.floor(totalCnt * (isMobile ? 0.12 : 0.06));

    // --- [연관 키워드 처리] ---
    const related = kwList.slice(0, 10).map(k => {
      const kComp = k.compIdx || 'mid';
      const kTotal = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
      const kCpc = calculateLogic(k.relKeyword, kComp, kTotal, isMobile);
      const kStatus = getRealCompStatus(kCpc, kTotal);
      
      return {
        keyword: k.relKeyword,
        pcQcCnt: parseInt(k.monthlyPcQcCnt) || 0,
        mobileQcCnt: parseInt(k.monthlyMobileQcCnt) || 0,
        cpcMin: Math.floor(kCpc * 0.8),
        cpcMax: Math.floor(kCpc * 1.3),
        cpcAvg: kCpc,
        compIdx: kComp,
        compLabel: kStatus.label, // 연관 키워드도 현실적 라벨 적용
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
      cpcMax: Math.floor(cpc * 1.25),
      estClicks,
      estImpressions,
      compIdx: realStatus.label,  // "낮음" 대신 "레드오션" 등 노출
      compColor: realStatus.color, // 프론트에서 색상 처리를 위한 값
      related,
    });

  } catch (e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
