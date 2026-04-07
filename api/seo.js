
const https = require('https');

// 상품명 중복 단어 제거
function removeDuplicateWords(name) {
  // 의미 있는 단위로 분리 (공백, 특수문자 기준)
  const words = name.split(/[\s\/\-\|]+/);
  const seen = new Set();
  const result = [];
  for (const word of words) {
    const normalized = word.trim().toLowerCase();
    if (!normalized) continue;
    // 조사/접속사 등 짧은 단어는 중복 체크 제외
    if (normalized.length <= 1) { result.push(word); continue; }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(word);
    }
  }
  return result.join(' ').trim();
}

// 상품명 유효성 검사 및 정제
function cleanName(name) {
  if (!name) return '';
  // 중복 단어 제거
  let cleaned = removeDuplicateWords(name);
  // 연속 공백 제거
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // 60자 초과 시 자르기
  if (cleaned.length > 60) cleaned = cleaned.slice(0, 60).trim();
  return cleaned;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { prompt } = req.query;
  if (!prompt) return res.status(200).json({ error: 'prompt 없음' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'GEMINI_API_KEY 없음' });

  const decodedPrompt = decodeURIComponent(prompt);

  const body = JSON.stringify({
    contents: [{ parts: [{ text: decodedPrompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
  });

  try {
    const data = await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (r) => {
        let b = ''; r.on('data', c => b += c);
        r.on('end', () => resolve(b));
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    const parsed = JSON.parse(data);
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();

    try {
      const result = JSON.parse(clean);

      // 중복 단어 제거 후처리
      if (result.names && Array.isArray(result.names)) {
        result.names = result.names.map(n => {
          const cleanedName = cleanName(n.name);
          return {
            ...n,
            name: cleanedName,
            length: cleanedName.length,
            // 중복 제거 여부 표시
            cleaned: cleanedName !== n.name
          };
        });
      }

      res.status(200).json(result);
    } catch(e) {
      res.status(200).json({ error: '파싱 오류', raw: text.slice(0, 200) });
    }
  } catch(e) {
    res.status(200).json({ error: e.message });
  }
};
