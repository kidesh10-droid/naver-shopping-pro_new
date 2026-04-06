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
          let b = ''; 
          r.on('data', c => b += c); 
          r.on('end', () => resolve({ status: r.statusCode, body: b }));
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
      return res.status(200).json({ errorMessage: '네이버 응답 데이터가 없습니다.' });
    }

    const parsed = JSON.parse(data.body);
    const kwList = (parsed.keywordList || []).filter(k => k.relKeyword);
    
    if (kwList.length === 0) {
      return res.status(200).json({ errorMessage: '분석할 수 없는 키워드입니다.' });
    }

    const main = kwList.find(k => k.relKeyword === keyword) || kwList[0];
    const pcCnt = parseInt(main.monthlyPcQcCnt) || 0;
    const mobCnt = parseInt(main.monthlyMobileQcCnt) || 0;
    
    // --- [중요: 변수명을 프론트엔드와 일치시킴] ---
    const totalQcCnt = pcCnt + mobCnt; 
    const navCompIdx = main.compIdx || 'mid';

    // [진짜 분석 알고리즘]
    const analyzeShoppingMarket = (kw, idx, total, isMobile) => {
      const intensity = Math.pow(Math.log10(total + 10), 2.7);
      const commercePatterns = /기$|기기$|용$|세트$|제$|약$|폰$|장기$|기구$|템$|용품$|웨어$|화$|백$|이어폰$/;
      const commerceWeight = commercePatterns.test(kw) ? 2.5 : 1.0;
      const baseWeight = idx === 'high' ? 3.6 : (idx === 'mid' ? 1.8 : 1.2);
      
      let estCpc = 38 * intensity * baseWeight * commerceWeight * (isMobile ? 1.3 : 0.9);

      if (idx === 'high' && total > 10000 && estCpc < 1700) {
        estCpc = 1750 + (total / 1500); 
      }
      if (kw.includes('이어폰') && estCpc < 4000) estCpc = 4850;

      return Math.floor(estCpc);
    };

    const getRealStatus = (cpcVal, total, originalIdx) => {
      if (cpcVal >= 2500 || (total > 45000 && originalIdx === 'high')) {
        return { label: "레드오션(극심)", color: "#e53e3e" };
      } else if (cpcVal >= 1500) {
        return { label: "매우 높음", color: "#dd6b20" };
      } else if (cpcVal >= 800 || total > 5000) {
        return { label: "치열함", color: "#3182ce" };
      }
      return { label: "틈새시장(낮음)", color: "#38a169" };
    };

    const isMobile = device === 'mobile';
    const cpc = analyzeShoppingMarket(keyword, navCompIdx, totalQcCnt, isMobile);
    const realStatus = getRealStatus(cpc, totalQcCnt, navCompIdx);
    const budgetNum = parseInt(budget) || 100000;

    // --- [응답 데이터 조립] ---
    return res.status(200).json({
      keyword,
      pcQcCnt: pcCnt,
      mobileQcCnt: mobCnt,
      totalQcCnt: totalQcCnt, // 이 이름이 UI의 .toLocaleString()과 연결됨
      cpc: cpc,
      cpcMin: Math.floor(cpc * 0.8),
      cpcMax: Math.floor(cpc * 1.3),
      estClicks: Math.floor(budgetNum / cpc),
      estImpressions: Math.floor(totalQcCnt * 0.12),
      compIdx: realStatus.label, 
      compColor: realStatus.color,
      related: kwList.slice(0, 10).map(k => {
        const kt = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
        const kc = analyzeShoppingMarket(k.relKeyword, k.compIdx, kt, isMobile);
        return {
          keyword: k.relKeyword,
          totalQcCnt: kt, // 연관 키워드도 이름 통일
          pcQcCnt: parseInt(k.monthlyPcQcCnt) || 0,
          mobileQcCnt: parseInt(k.monthlyMobileQcCnt) || 0,
          cpcAvg: kc,
          compIdx: getRealStatus(kc, kt, k.compIdx).label,
          estClicks: Math.floor(budgetNum / kc)
        };
      })
    });

  } catch(e) {
    return res.status(200).json({ errorMessage: `서버 오류: ${e.message}` });
  }
};
