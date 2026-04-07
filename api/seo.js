// v3
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

  const prompt = `네이버 쇼핑 SEO 전문가로서 아래 정보로 SEO 최적화 상품명을 JSON만 출력하세요.

키워드: ${keyword}
${brand ? `브랜드: ${brand}` : ''}
연관키워드(검색량순): ${kwListText || ''}

규칙: 60자이내, 중복단어금지, 각 상품명 다른조합

출력형식(JSON만):
{"names":[{"name":"상품명","length":글자수,"keywords":["키워드1"]},{"name":"상품명2","length":글자수,"keywords":["키워드1"]},{"name":"상품명3","length":글자수,"keywords":["키워드1"]}],"recommendTags":["태그1","태그2","태그3","태그4","태그5"],"tip":"팁"}`;

  const reqBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
  });

  try {
    const rawData = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reqBody)
        }
      }, (res2) => {
        let b = '';
        res2.on('data', c => b += c);
        res2.on('end', () => resolve({ status: res2.statusCode, body: b }));
      });
      r.on('error', reject);
      r.write(reqBody);
      r.end();
    });

    // 상태코드 확인
    if (rawData.status !== 200) {
      return res.status(200).json({ error: `Gemini API 오류 (${rawData.status})`, raw: rawData.body.slice(0, 200) });
    }

    if (!rawData.body || rawData.body.trim() === '') {
      return res.status(200).json({ error: 'Gemini 응답 비어있음' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawData.body);
    } catch(e) {
      return res.status(200).json({ error: 'Gemini 응답 파싱 오류', raw: rawData.body.slice(0, 200) });
    }

    if (parsed.error) {
      return res.status(200).json({ error: parsed.error.message || 'Gemini 오류' });
    }

    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(200).json({ error: 'Gemini 텍스트 없음' });

    // JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(200).json({ error: 'JSON 추출 실패', raw: text.slice(0, 300) });

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch(e) {
      return res.status(200).json({ error: 'JSON 파싱 실패', raw: jsonMatch[0].slice(0, 300) });
    }

    // 중복 단어 제거
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
