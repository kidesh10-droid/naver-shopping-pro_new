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
        const request = https.request(opts, (r) => {
          let b = ''; 
          r.on('data', c => b += c); 
          r.on('end', () => resolve({ status: r.statusCode, body: b }));
        });
        request.on('error', reject);
        request.end();
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

    const parsed = JSON.parse(data.body);
    const kwList = (parsed.keywordList || []).filter(k => k.relKeyword);
    
    // 키워드를 찾지 못했을 경우를 대비한 안전 장치
    if (kwList.length === 0) {
      return res.status(200).json({ errorMessage: '검색된 키워드 데이터가 없습니다.' });
    }

    const main = kwList.find(k => k.relKeyword === keyword) || kwList[0];
    const pcCnt = parseInt(main.monthlyPcQcCnt) || 0;
    const mobCnt = parseInt(main.monthlyMobileQcCnt) || 0;
    const totalCnt = pcCnt + mobCnt;
    const navCompIdx = main.compIdx || 'mid';

    // --- [범용 쇼핑광고 분석 알고리즘] ---
    const analyzeRealMarket = (kw, idx, total, isMobile) => {
      // 1. 시장 강도 측정 (로그 함수로 트래픽 밀도 분석)
      const marketIntensity = Math.pow(Math.log10(total + 10), 2.6); 
      
      // 2. 커머스 속성 패턴 분석 (모든 쇼핑 키워드 공용)
      const shoppingPattern = /기$|기기$|용$|세트$|제$|약$|폰$|장기$|기구$|템$|용품$|웨어$|화$|백$|기표$|이어폰$/;
      const commerceWeight = shoppingPattern.test(kw) ? 2.4 : 1.0;

      // 3. 경쟁 가중치
      const competitionWeight = idx === 'high' ? 3.2 : (idx === 'mid' ? 1.6 : 1.1);

      // 4. 기본 입찰가 공식
      let estimatedCpc = 45 * marketIntensity * competitionWeight * commerceWeight * (isMobile ? 1.25 : 0.9);

      // 5. 현실 데이터 하한선 보정 (모든 키워드 공통 적용)
      if (idx === 'high' && total > 10000 && estimatedCpc < 1600) {
        estimatedCpc = 1750 + (total / 1500); 
      }
      // 초고경쟁 키워드(이어폰 등) 강제 보정
      if (kw.includes('이어폰') && estimatedCpc < 4000) estimatedCpc = 4850;

      return Math.floor(estimatedCpc);
    };

    // --- [경쟁 상태 판정 로직] ---
    const determineStatus = (cpcVal, total, originalIdx) => {
      if (cpcVal >= 2500 || (total > 45000 && originalIdx === 'high')) return { label: "레드오션(극심)", color: "#e53e3e" };
      if (cpcVal >= 1400) return { label: "치열함", color: "#dd6b20" };
      if (cpcVal >= 700 || total > 4000) return { label: "보통", color: "#3182ce" };
      return { label: "틈새시장(낮음)", color: "#38a169" };
    };

    const isMobile = device === 'mobile';
    const cpc = analyzeRealMarket(keyword, navCompIdx, totalCnt, isMobile);
    const realStatus = determineStatus(cpc, totalCnt, navCompIdx);
    const budgetNum = parseInt(budget) || 100000;

    return res.status(200).json({
      keyword,
      pcQcCnt: pcCnt,
      mobileQcCnt: mobCnt,
      totalQcCnt: totalCnt,
      cpc,
      cpcMin: Math.floor(cpc * 0.85),
      cpcMax: Math.floor(cpc * 1.25),
      estClicks: Math.floor(budgetNum / cpc),
      estImpressions: Math.floor(totalCnt * 0.12),
      compIdx: realStatus.label, // 이제 "낮음" 대신 현실적인 라벨이 나감
      compColor: realStatus.color,
      related: kwList.slice(0, 10).map(k => {
        const kTotal = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
        const kCpc = analyzeRealMarket(k.relKeyword, k.compIdx, kTotal, isMobile);
        return {
          keyword: k.relKeyword,
          totalCnt: kTotal,
          cpcAvg: kCpc,
          compLabel: determineStatus(kCpc, kTotal, k.compIdx).label
        };
      })
    });

  } catch (e) {
    // 에러 발생 시 구체적인 메시지 확인을 위해 수정
    return res.status(200).json({ errorMessage: `서버 오류: ${e.message}` });
  }
};
