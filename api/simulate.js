const https = require('https');
const crypto = require('crypto');
const CUSTOMER_ID = '2905718';

// 네이버 쇼핑 상품수 조회
async function getProductCount(keyword) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'openapi.naver.com',
      path: `/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=1`,
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    }, (r) => {
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => {
        try { resolve(JSON.parse(b).total || 0); }
        catch(e) { resolve(0); }
      });
    }).on('error', () => resolve(0));
  });
}

// 경쟁강도 계산 (검색량 / 상품수)
function calcCompetition(searchCnt, productCnt) {
  if (productCnt === 0) return { level: '데이터없음', color: '#9ca3af', score: 0 };
  const ratio = searchCnt / productCnt;
  if (ratio >= 0.15) return { level: '블루오션 🟢', color: '#03C75A', score: ratio };
  if (ratio >= 0.08) return { level: '관심키워드 🔵', color: '#1976D2', score: ratio };
  if (ratio >= 0.03) return { level: '경쟁보통 🟡', color: '#F59E0B', score: ratio };
  if (ratio >= 0.01) return { level: '경쟁심화 🟠', color: '#F57C00', score: ratio };
  return { level: '레드오션 🔴', color: '#D84315', score: ratio };
}

// 검색량 + 상품수 기반 CPC 추정 (모든 키워드 공통 공식)
function estimateCpc(totalSearch, productCount, device) {
  if (totalSearch === 0) return 100;

  // 경쟁밀도 = 상품수 / 검색량 (높을수록 경쟁 심함 → CPC 높음)
  const density = productCount > 0 ? productCount / totalSearch : 10;

  // 기본 CPC = 경쟁밀도 × 검색량 로그 × 디바이스 보정
  const logSearch = Math.log10(totalSearch + 1);
  const deviceMult = device === 'mobile' ? 0.85 : 1.0;
  let cpc = density * logSearch * 180 * deviceMult;

  // 상한/하한 설정
  cpc = Math.max(70, Math.min(cpc, 8000));

  return Math.round(cpc / 10) * 10; // 10원 단위 반올림
}

// 예상 노출 순위 (입찰가 / 평균CPC 비율 기반)
function inferRank(userBid, avgCpc, totalSearch) {
  if (!userBid || userBid === 0) return '입찰가 입력 시 확인 가능';
  const ratio = userBid / avgCpc;
  if (totalSearch > 100000) {
    if (ratio >= 2.0) return '1~3위 (최상단)';
    if (ratio >= 1.5) return '4~8위 (상위권)';
    if (ratio >= 1.0) return '9~15위 (중위권)';
    return '15위 이하';
  } else if (totalSearch > 30000) {
    if (ratio >= 1.5) return '1~3위 (최상단)';
    if (ratio >= 1.1) return '4~10위 (상위권)';
    if (ratio >= 0.8) return '11~20위 (중위권)';
    return '20위 이하';
  } else {
    if (ratio >= 1.2) return '1~3위 (독점)';
    if (ratio >= 0.9) return '4~10위 (안정권)';
    if (ratio >= 0.6) return '11~20위';
    return '20위 이하';
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const fullUrl = `https://${req.headers.host}${req.url}`;
  const { searchParams } = new URL(fullUrl);
  const keyword = searchParams.get('keyword');
  const budget = searchParams.get('budget') || '100000';
  const device = searchParams.get('device') || 'mobile';
  const bid = searchParams.get('bid') || '0';

  if (!keyword) return res.status(200).json({ errorMessage: '키워드를 입력해주세요.' });

  try {
    const timestamp = Date.now().toString();
    const path = '/keywordstool';
    const msg = `${timestamp}.GET.${path}`;
    const signature = crypto.createHmac('sha256', Buffer.from(process.env.NAVER_AD_SECRET_KEY, 'utf-8'))
      .update(Buffer.from(msg, 'utf-8')).digest('base64');

    // 검색량 + 메인 키워드 상품수 병렬 호출
    const [kwData, productCount] = await Promise.all([
      new Promise((resolve, reject) => {
        function doReq(opts) {
          https.request(opts, (r) => {
            if ([301,302,308].includes(r.statusCode)) {
              const u = new URL(r.headers.location);
              doReq({ ...opts, hostname: u.hostname, path: u.pathname + u.search });
              return;
            }
            let b = ''; r.on('data', c => b += c);
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
      }),
      getProductCount(keyword)
    ]);

    if (!kwData.body || kwData.body.trim() === '') {
      return res.status(200).json({ errorMessage: '네이버 API 응답이 비어있습니다.' });
    }

    const parsed = JSON.parse(kwData.body);
    const kwList = (parsed.keywordList || []).filter(k => k.relKeyword);
    if (kwList.length === 0) return res.status(200).json({ errorMessage: '검색된 키워드 데이터가 없습니다.' });

    const main = kwList.find(k => k.relKeyword === keyword) || kwList[0];
    const pcQc = parseInt(main.monthlyPcQcCnt) || 0;
    const mobQc = parseInt(main.monthlyMobileQcCnt) || 0;
    const totalQc = pcQc + mobQc;
    const budgetNum = parseInt(budget);
    const userBid = parseInt(bid);

    // 공통 공식으로 CPC 계산
    const marketAvgCpc = estimateCpc(totalQc, productCount, device);
    const finalCpc = userBid > 0 ? userBid : marketAvgCpc;

    // 경쟁강도 계산
    const comp = calcCompetition(totalQc, productCount);

    // 예상 순위 / 클릭 / 노출
    const estRank = inferRank(userBid, marketAvgCpc, totalQc);
    const estClicks = finalCpc > 0 ? Math.floor(budgetNum / finalCpc) : 0;
    const estImpressions = Math.floor(estClicks * 12);
    const recommendedMonthly = budgetNum * 30;

    // 연관 키워드 병렬로 상품수 조회
    const relatedRaw = kwList.slice(0, 10);
    const relatedProducts = await Promise.all(
      relatedRaw.map(k => getProductCount(k.relKeyword))
    );

    const related = relatedRaw.map((k, i) => {
      const kt = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
      const kProd = relatedProducts[i];
      const kComp = calcCompetition(kt, kProd);
      const kCpc = estimateCpc(kt, kProd, device);
      return {
        keyword: k.relKeyword,
        totalQcCnt: kt,
        productCount: kProd,
        cpcAvg: kCpc,
        compLevel: kComp.level,
        compColor: kComp.color,
        compScore: Math.round(kComp.score * 1000) / 1000,
        estClicks: kCpc > 0 ? Math.floor(budgetNum / kCpc) : 0,
        estRank: inferRank(userBid || kCpc, kCpc, kt),
      };
    });

    return res.status(200).json({
      keyword,
      pcQcCnt: pcQc,
      mobileQcCnt: mobQc,
      totalQcCnt: totalQc,
      productCount,
      cpc: finalCpc,
      marketAvgCpc,
      estRank,
      estClicks,
      estImpressions,
      recommendedMonthly,
      compLevel: comp.level,
      compColor: comp.color,
      compScore: Math.round(comp.score * 1000) / 1000,
      related,
    });

  } catch(e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
