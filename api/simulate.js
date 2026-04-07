const https = require('https');
const crypto = require('crypto');
const CUSTOMER_ID = '2905718';

// ===== 1분기 실제 광고 집행 데이터 (2026 Q1) =====
// CPC: 실제 지불 평균 CPC / RANK: 실제 평균 노출순위
const CATEGORY_DATA = {
  // 전기매트/난방
  '전기매트':    { cpc: 3115, rank: 3.1 },
  '온열매트':    { cpc: 3000, rank: 3.5 },
  '열선매트':    { cpc: 2900, rank: 3.5 },
  // 진공포장
  '진공포장기':  { cpc: 1807, rank: 3.8 },
  '진공포장':    { cpc: 1500, rank: 4.0 },
  '진공밀봉':    { cpc: 1300, rank: 4.0 },
  // 마이크
  'XLR마이크':   { cpc: 1700, rank: 4.0 },
  '콘덴서마이크':{ cpc: 1500, rank: 4.0 },
  '게이밍마이크':{ cpc: 1500, rank: 4.0 },
  '방송마이크':  { cpc: 1600, rank: 4.0 },
  '다이나믹마이크':{ cpc: 1341, rank: 4.8 },
  '마이크':      { cpc: 1341, rank: 4.8 },
  // 가습기 (무선가습기 먼저 - 무선이어폰과 혼동 방지)
  '초음파가습기':{ cpc: 1306, rank: 4.3 },
  'USB가습기':   { cpc: 1252, rank: 5.7 },
  '사무실가습기':{ cpc: 1218, rank: 5.7 },
  '미니가습기':  { cpc: 1641, rank: 4.3 },
  '휴대용가습기':{ cpc: 1130, rank: 4.6 },
  '무선가습기':  { cpc: 388,  rank: 1.0 },
  '가습기':      { cpc: 1130, rank: 4.6 },
  // 마사지기
  '마사지기':    { cpc: 1300, rank: 4.0 },
  '안마기':      { cpc: 1200, rank: 4.0 },
  '허리마사지':  { cpc: 1000, rank: 4.5 },
  // 에어건
  '디테일링에어건':{ cpc: 1435, rank: 3.6 },
  '차량용에어건':{ cpc: 1287, rank: 5.4 },
  '무선에어건':  { cpc: 908,  rank: 6.6 },
  '에어건':      { cpc: 1287, rank: 3.8 },
  '에어컴프레서':{ cpc: 1200, rank: 4.0 },
  // 전기포트
  '온도조절포트':{ cpc: 1200, rank: 4.5 },
  '분유포트':    { cpc: 1100, rank: 4.5 },
  '전기포트':    { cpc: 1258, rank: 4.5 },
  // 스팀다리미/의류
  '스팀다리미':  { cpc: 1096, rank: 4.4 },
  '의류관리기':  { cpc: 1200, rank: 4.0 },
  '다리미':      { cpc: 1000, rank: 4.5 },
  // 커피
  '에스프레소':  { cpc: 1100, rank: 4.0 },
  '커피머신':    { cpc: 925,  rank: 3.2 },
  '커피포트':    { cpc: 900,  rank: 4.0 },
  // 헤어
  '헤어드라이어':{ cpc: 1109, rank: 4.2 },
  '헤어드라이기':{ cpc: 1109, rank: 4.2 },
  '드라이기':    { cpc: 1109, rank: 4.2 },
  '고데기':      { cpc: 900,  rank: 4.5 },
  // 이어폰 (일반 경쟁 키워드 기준 - 브랜드 대비 CPC 높음)
  '노이즈캔슬링이어폰': { cpc: 2200, rank: 6.0 },
  '블루투스이어폰':{ cpc: 1800, rank: 6.0 },
  '무선이어폰':  { cpc: 1800, rank: 6.0 },
  '에어팟':      { cpc: 2000, rank: 5.0 },
  '오픈형이어폰':{ cpc: 1500, rank: 6.0 },
  '이어폰':      { cpc: 1200, rank: 6.8 },
  // 냉장고
  '차량용냉장고':{ cpc: 700,  rank: 2.5 },
  '캠핑냉장고':  { cpc: 700,  rank: 2.5 },
  '휴대용냉장고':{ cpc: 591,  rank: 2.2 },
  '냉장고':      { cpc: 591,  rank: 2.2 },
};

// 키워드 → 카테고리 데이터 매핑 (긴 키워드 우선)
function findCategoryData(keyword) {
  const sorted = Object.keys(CATEGORY_DATA).sort((a,b) => b.length - a.length);
  for (const cat of sorted) {
    if (keyword.includes(cat)) return { ...CATEGORY_DATA[cat], matched: cat };
  }
  return null;
}

// CPC 추정
function estimateCpc(keyword, totalSearch, productCount, device) {
  const catData = findCategoryData(keyword);
  if (catData) {
    return device === 'mobile' ? Math.round(catData.cpc * 0.85) : catData.cpc;
  }
  if (totalSearch === 0) return 200;
  const density = productCount > 0 ? productCount / totalSearch : 5;
  const logSearch = Math.log10(totalSearch + 1);
  const devMult = device === 'mobile' ? 0.85 : 1.0;
  let cpc = density * logSearch * 180 * devMult * 0.30;
  return Math.round(Math.max(70, Math.min(cpc, 5000)) / 10) * 10;
}

// 실측 기반 노출순위 추정
function inferRank(userBid, marketCpc, catRank, totalSearch) {
  if (!userBid || userBid === 0) return '입찰가 입력 시 확인 가능';

  // 실측 평균순위 기준으로 입찰가 비율 적용
  const baseRank = catRank || 5.0; // 카테고리 실측 평균순위
  const ratio = userBid / marketCpc;

  let estRank;
  if (ratio >= 2.0)      estRank = Math.max(1, baseRank * 0.3);
  else if (ratio >= 1.5) estRank = Math.max(1, baseRank * 0.5);
  else if (ratio >= 1.2) estRank = Math.max(1, baseRank * 0.7);
  else if (ratio >= 1.0) estRank = baseRank;
  else if (ratio >= 0.8) estRank = baseRank * 1.3;
  else if (ratio >= 0.6) estRank = baseRank * 1.7;
  else                   estRank = baseRank * 2.5;

  estRank = Math.round(estRank * 10) / 10;

  if (estRank <= 2)       return `약 ${estRank}위 (최상단)`;
  else if (estRank <= 5)  return `약 ${estRank}위 (상위권)`;
  else if (estRank <= 10) return `약 ${estRank}위 (중위권)`;
  else                    return `약 ${Math.round(estRank)}위 이하`;
}

// 쇼핑 데이터 조회
async function getShoppingData(keyword) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'openapi.naver.com',
      path: `/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=100&sort=sim`,
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    }, (r) => {
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => {
        try {
          const d = JSON.parse(b);
          const items = d.items || [];
          const reviews = items.map(i => parseInt(i.reviewCount || i.reviewcount || i.review_count || 0));
          const prices = items.map(i => parseInt(i.lprice)||0).filter(p=>p>0);
          resolve({
            total: d.total || 0,
            avgReview: reviews.length > 0 ? Math.round(reviews.reduce((a,b)=>a+b,0)/reviews.length) : 0,
            maxReview: reviews.length > 0 ? Math.max(...reviews) : 0,
            zeroReviewRate: reviews.length > 0 ? Math.round((reviews.filter(r=>r===0).length/reviews.length)*100) : 0,
            avgPrice: prices.length > 0 ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0,
            minPrice: prices.length > 0 ? Math.min(...prices) : 0,
          });
        } catch(e) {
          resolve({ total:0, avgReview:0, maxReview:0, zeroReviewRate:0, avgPrice:0, minPrice:0 });
        }
      });
    }).on('error', () => resolve({ total:0, avgReview:0, maxReview:0, zeroReviewRate:0, avgPrice:0, minPrice:0 }));
  });
}

// 경쟁강도
function calcCompetition(searchCnt, productCnt) {
  if (productCnt === 0) return { level: '데이터없음', color: '#9ca3af', score: 0 };
  const ratio = searchCnt / productCnt;
  if (ratio >= 0.15) return { level: '블루오션 🟢', color: '#03C75A', score: ratio };
  if (ratio >= 0.08) return { level: '관심키워드 🔵', color: '#1976D2', score: ratio };
  if (ratio >= 0.03) return { level: '경쟁보통 🟡', color: '#F59E0B', score: ratio };
  if (ratio >= 0.01) return { level: '경쟁심화 🟠', color: '#F57C00', score: ratio };
  return { level: '레드오션 🔴', color: '#D84315', score: ratio };
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

    const [kwData, shopData] = await Promise.all([
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
      getShoppingData(keyword)
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

    const catData = findCategoryData(keyword);
    const marketAvgCpc = estimateCpc(keyword, totalQc, shopData.total, device);
    const finalCpc = userBid > 0 ? userBid : marketAvgCpc;
    const comp = calcCompetition(totalQc, shopData.total);
    const estRank = inferRank(userBid, marketAvgCpc, catData?.rank, totalQc);
    const baseRankInfo = catData ? `실측 평균 ${catData.rank}위 기준` : '추정값';
    const estClicks = finalCpc > 0 ? Math.floor(budgetNum / finalCpc) : 0;
    const estImpressions = Math.floor(estClicks * 12);
    const recommendedMonthly = budgetNum * 30;

    // 연관 키워드 병렬 조회
    const relatedRaw = kwList.slice(0, 10);
    const relatedShopData = await Promise.all(relatedRaw.map(k => getShoppingData(k.relKeyword)));

    const related = relatedRaw.map((k, i) => {
      const kt = (parseInt(k.monthlyPcQcCnt)||0) + (parseInt(k.monthlyMobileQcCnt)||0);
      const kShop = relatedShopData[i];
      const kComp = calcCompetition(kt, kShop.total);
      const kCatData = findCategoryData(k.relKeyword);
      const kCpc = estimateCpc(k.relKeyword, kt, kShop.total, device);
      return {
        keyword: k.relKeyword,
        totalQcCnt: kt,
        productCount: kShop.total,
        avgReview: kShop.avgReview,
        avgPrice: kShop.avgPrice,
        cpcAvg: kCpc,
        compLevel: kComp.level,
        compColor: kComp.color,
        estClicks: kCpc > 0 ? Math.floor(budgetNum / kCpc) : 0,
        estRank: inferRank(userBid || kCpc, kCpc, kCatData?.rank, kt),
        baseRank: kCatData?.rank || null,
      };
    });

    return res.status(200).json({
      keyword, pcQcCnt: pcQc, mobileQcCnt: mobQc, totalQcCnt: totalQc,
      productCount: shopData.total,
      avgReview: shopData.avgReview, maxReview: shopData.maxReview,
      zeroReviewRate: shopData.zeroReviewRate,
      avgPrice: shopData.avgPrice, minPrice: shopData.minPrice,
      cpc: finalCpc, marketAvgCpc,
      baseRank: catData?.rank || null,
      baseRankInfo,
      estRank, estClicks, estImpressions, recommendedMonthly,
      compLevel: comp.level, compColor: comp.color,
      compScore: Math.round(comp.score * 1000) / 1000,
      related,
    });

  } catch(e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
