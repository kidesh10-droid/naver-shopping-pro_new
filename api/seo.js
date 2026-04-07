// v2
const https = require('https');
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
  let cleaned = removeDuplicateWords(name);
  if (cleaned.length > 60) cleaned = cleaned.slice(0, 60).trim();
  return cleaned;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // body 파싱
  let body = req.body || {};
  if (!body.keyword && req.method === 'POST') {
    try {
      const raw = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
      if (raw) body = JSON.parse(raw);
    } catch(e) {}
  }

  const { keyword, brand, kwListText } = body;
  if (!keyword) return res.status(200).json({ error: '키워드가 없습니다.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'GEMINI_API_KEY 없음' });

  // Gemini 프롬프트 생성
  const prompt = `당신은 네이버 쇼핑 SEO 전문가입니다. 아래 정보를 바탕으로 네이버 쇼핑 SEO에 최적화된 상품명을 JSON으로만 출력하세요. 마크다운 없이 JSON만.

[입력 정보]
- 메인 키워드: ${keyword}
${brand ? `- 브랜드: ${brand}` : ''}
- 연관 키워드 (검색량 순): ${kwListText || ''}

[규칙]
1. 상품명은 60자 이내 (필수)
2. 검색량 높은 연관 키워드를 자연스럽게 포함
3. 브랜드명이 있으면 앞에 배치
4. 동일한 단어 절대 중복 금지
5. 각 상품명은 서로 다른 키워드 조합으로 작성

[출력 JSON 형식]
{"names":[{"name":"상품명1","length":글자수,"keywords":["키워드1","키워드2"]},{"name":"상품명2","length":글자수,"keywords":["키워드1","키워드2"]},{"name":"상품명3","length":글자수,"keywords":["키워드1","키워드2"]}],"recommendTags":["태그1","태그2","태그3","태그4","태그5"],"tip":"팁한줄"}`;

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
  });

  try {
    const rawData = await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reqBody)
        }
      }, (r) => {
        let b = '';
        r.on('data', c => b += c);
        r.on('end', () => resolve(b));
      });
      req2.on('error', reject);
      req2.write(reqBody);
      req2.end();
    });

    if (!rawData || rawData.trim() === '') {
      return res.status(200).json({ error: 'Gemini 응답이 비어있습니다.' });
    }

    const parsed = JSON.parse(rawData);
    if (parsed.error) {
      return res.status(200).json({ error: parsed.error.message || 'Gemini API 오류' });
    }

    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(200).json({ error: 'Gemini 응답 없음' });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(200).json({ error: 'JSON 추출 실패', raw: text.slice(0, 300) });

    const result = JSON.parse(jsonMatch[0]);

    if (result.names && Array.isArray(result.names)) {
      result.names = result.names.map(n => {
        const cleaned = cleanName(n.name);
        return { ...n, name: cleaned, length: cleaned.length };
      });
    }

    res.status(200).json(result);

  } catch(e) {
    res.status(200).json({ error: e.message });
  }
};
