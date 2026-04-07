const https = require('https');

function removeDuplicateWords(name) {
  const words = name.split(/[\s\/\-\|]+/);
  const seen = new Set();
  const result = [];
  for (const word of words) {
    const norm = word.trim().toLowerCase();
    if (!norm) continue;
    if (norm.length <= 1) { result.push(word); continue; }
    if (!seen.has(norm)) { seen.add(norm); result.push(word); }
  }
  return result.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanName(name) {
  if (!name) return '';
  let c = removeDuplicateWords(name);
  if (c.length > 60) c = c.slice(0, 60).trim();
  return c;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'GEMINI_API_KEY 없음' });

  // body 파싱
  let body = {};
  if (req.method === 'POST') {
    let raw = '';
    await new Promise(resolve => { req.on('data', c => raw += c); req.on('end', resolve); });
    try { body = JSON.parse(raw); } catch(e) {}
  }

  const { keyword, brand, kwListText } = body;
  if (!keyword) return res.status(200).json({ error: '키워드를 입력해주세요.' });

  // 서버에서 프롬프트 생성
  const prompt = `당신은 네이버 쇼핑 SEO 전문가입니다. 아래 정보를 바탕으로 네이버 쇼핑 SEO에 최적화된 상품명을 JSON으로만 출력하세요. 마크다운 없이 JSON만 출력하세요.

[입력 정보]
- 메인 키워드: ${keyword}
${brand ? `- 브랜드: ${brand}` : ''}
- 연관 키워드 (검색량 순): ${kwListText || ''}

[규칙 - 반드시 준수]
1. 상품명은 60자 이내 (필수)
2. 검색량 높은 연관 키워드를 자연스럽게 포함
3. 브랜드명이 있으면 앞에 배치
4. 동일한 단어 절대 중복 사용 금지
5. 유사 의미 단어도 중복 금지
6. 한국어로 작성
7. 각 상품명은 서로 다른 키워드 조합으로 작성

[출력 형식 - JSON만]
{
  "names": [
    {"name": "상품명1", "length": 글자수, "keywords": ["포함키워드1", "포함키워드2"]},
    {"name": "상품명2", "length": 글자수, "keywords": ["포함키워드1", "포함키워드2"]},
    {"name": "상품명3", "length": 글자수, "keywords": ["포함키워드1", "포함키워드2"]}
  ],
  "recommendTags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "tip": "상품명 작성 팁 한줄"
}`;

  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
  });

  try {
    const data = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res2) => {
        let b = ''; res2.on('data', c => b += c); res2.on('end', () => resolve(b));
      });
      r.on('error', reject);
      r.write(geminiBody);
      r.end();
    });

    const parsed = JSON.parse(data);
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();

    const result = JSON.parse(clean);
    if (result.names) {
      result.names = result.names.map(n => ({
        ...n,
        name: cleanName(n.name),
        length: cleanName(n.name).length
      }));
    }
    res.status(200).json(result);
  } catch(e) {
    res.status(200).json({ error: e.message });
  }
};
