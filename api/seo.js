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

  // prompt 추출 - 여러 방식 시도
  let prompt = null;

  // 1. req.body (Vercel이 자동 파싱)
  if (req.body && req.body.prompt) {
    prompt = req.body.prompt;
  }
  // 2. query string
  else if (req.query && req.query.prompt) {
    prompt = req.query.prompt;
  }
  // 3. 수동 body 파싱
  else if (req.method === 'POST') {
    try {
      const raw = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
      if (raw) {
        const parsed = JSON.parse(raw);
        prompt = parsed.prompt;
      }
    } catch(e) {}
  }

  if (!prompt) {
    return res.status(200).json({ 
      error: 'prompt 없음',
      debug: { method: req.method, hasBody: !!req.body, bodyKeys: req.body ? Object.keys(req.body) : [] }
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'GEMINI_API_KEY 없음' });

  const body = JSON.stringify({
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
          'Content-Length': Buffer.byteLength(body)
        }
      }, (r) => {
        let b = '';
        r.on('data', c => b += c);
        r.on('end', () => resolve(b));
      });
      req2.on('error', reject);
      req2.write(body);
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
    if (!text) {
      return res.status(200).json({ error: 'Gemini 응답 텍스트 없음' });
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(200).json({ error: 'JSON 추출 실패', raw: text.slice(0, 300) });
    }

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
