const https = require('https');
const crypto = require('crypto');
const CUSTOMER_ID = '2905718';

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (r) => {
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => {
        try {
          const d = JSON.parse(b);
          const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '분석 불가';
          resolve(text);
        } catch(e) { resolve('분석 중 오류가 발생했습니다.'); }
      });
    });
    req.on('error', () => resolve('분석 요청 실패'));
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { keyword, budget, device, bid } = req.query;
  if (!keyword) return res.status(200).json({ errorMessage: '키워드를 입력해주세요.' });

  try {
    // 네이버 광고 API 호출
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

    // 경쟁강도 기반 CPC 범위
    const cpcRange = {
      high: { pc: { min: 800, max: 3000, avg: 1500 }, mobile: { min: 400, max: 1500, avg: 800 } },
      mid:  { pc: { min: 300, max: 800,  avg: 500  }, mobile: { min: 150, max: 500,  avg: 300 } },
      low:  { pc: { min: 50,  max: 300,  avg: 150  }, mobile: { min: 30,  max: 150,  avg: 80  } },
    };
    const range = cpcRange[compIdx] || cpcRange['mid'];
    const devRange = device === 'mobile' ? range.mobile : range.pc;
    const cpc = devRange.avg;
    const budgetNum = parseInt(budget) || 100000;
    const bidNum = parseInt(bid) || cpc;

    // 예상 노출 순위 계산 (입찰가 기반)
    let estRank = '-';
    let rankComment = '';
    if (bid) {
      if (bidNum >= devRange.max) { estRank = '1~3위'; rankComment = '상위 노출 가능'; }
      else if (bidNum >= devRange.avg) { estRank = '4~7위'; rankComment = '중상위 노출'; }
      else if (bidNum >= devRange.min) { estRank = '8~15위'; rankComment = '하위 노출'; }
      else { estRank = '15위 이하'; rankComment = '노출 어려움'; }
    }

    const estClicks = Math.floor(budgetNum / bidNum);
    const estImpressions = Math.floor(estClicks * 10);
    const compText = compIdx === 'high' ? '높음' : compIdx === 'mid' ? '중간' : '낮음';
    const compColor = compIdx === 'high' ? '#D84315' : compIdx === 'mid' ? '#F59E0B' : '#03C75A';

    // 연관 키워드
    const related = kwList.slice(0, 10).map(k => {
      const kComp = k.compIdx || 'mid';
      const kRange = cpcRange[kComp] || cpcRange['mid'];
      const kDev = device === 'mobile' ? kRange.mobile : kRange.pc;
      const kTotal = (parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0);
      return {
        keyword: k.relKeyword,
        totalQcCnt: kTotal,
        cpcMin: kDev.min, cpcMax: kDev.max, cpcAvg: kDev.avg,
        compIdx: kComp === 'high' ? '높음' : kComp === 'mid' ? '중간' : '낮음',
        estClicks: Math.floor(budgetNum / kDev.avg),
      };
    });

    // Gemini AI 분석
    const prompt = `당신은 네이버 쇼핑 광고 전문가입니다. 아래 데이터를 분석해서 한국어로 3줄 실무 조언을 해주세요. 번호 없이 간결하게.

키워드: ${keyword}
월간 검색량: ${totalCnt.toLocaleString()}건 (PC ${pcCnt.toLocaleString()} / 모바일 ${mobCnt.toLocaleString()})
경쟁강도: ${compText}
예상 평균 CPC: ${cpc.toLocaleString()}원
${bid ? `설정 입찰가: ${bidNum.toLocaleString()}원 → 예상 노출순위: ${estRank} (${rankComment})` : ''}
일 예산: ${budgetNum.toLocaleString()}원
예상 일 클릭수: ${estClicks.toLocaleString()}회`;

    const aiComment = await callGemini(prompt);

    return res.status(200).json({
      keyword, device: device || 'pc', budget: budgetNum, bid: bidNum,
      pcQcCnt: pcCnt, mobileQcCnt: mobCnt, totalQcCnt: totalCnt,
      cpc, cpcMin: devRange.min, cpcMax: devRange.max,
      estClicks, estImpressions,
      estRank, rankComment,
      compIdx: compText, compColor,
      recommendedMonthly: budgetNum * 30,
      aiComment,
      related,
    });

  } catch(e) {
    return res.status(200).json({ errorMessage: e.message });
  }
};
