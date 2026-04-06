const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.setHeader('Content-Type', 'application/json');
  const { action } = req.query;

  try {
    // 회원가입
    if (action === 'signup') {
      const { email, password } = req.body || {};
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return res.status(400).json({ error: error.message });

      // users 테이블에 추가
      await supabase.from('users').insert({
        id: data.user.id, email,
        usage_count: 0,
        usage_reset_at: new Date().toISOString()
      });
      return res.status(200).json({ success: true, user: data.user });
    }

    // 로그인
    if (action === 'login') {
      const { email, password } = req.body || {};
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, session: data.session, user: data.user });
    }

    // 사용 횟수 확인 및 증가
    if (action === 'check_usage') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: '인증 실패' });

      const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).single();
      if (!userData) return res.status(404).json({ error: '유저 없음' });

      // 프리미엄 체크
      if (userData.is_premium) {
        const expiry = new Date(userData.premium_expires_at);
        if (expiry > new Date()) {
          return res.status(200).json({ allowed: true, premium: true, remaining: 999 });
        } else {
          // 만료된 프리미엄 해제
          await supabase.from('users').update({ is_premium: false, premium_expires_at: null }).eq('id', user.id);
        }
      }

      // 월 초기화 확인
      const resetAt = new Date(userData.usage_reset_at);
      const now = new Date();
      if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
        await supabase.from('users').update({ usage_count: 0, usage_reset_at: now.toISOString() }).eq('id', user.id);
        userData.usage_count = 0;
      }

      const FREE_LIMIT = 3;
      const remaining = Math.max(0, FREE_LIMIT - userData.usage_count);

      if (userData.usage_count >= FREE_LIMIT) {
        return res.status(200).json({ allowed: false, premium: false, remaining: 0, usage: userData.usage_count });
      }

      // 사용 횟수 증가
      await supabase.from('users').update({ usage_count: userData.usage_count + 1 }).eq('id', user.id);
      return res.status(200).json({ allowed: true, premium: false, remaining: remaining - 1, usage: userData.usage_count + 1 });
    }

    // 유저 정보 조회
    if (action === 'me') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error) return res.status(401).json({ error: '인증 실패' });
      const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).single();
      return res.status(200).json({ user: { ...user, ...userData } });
    }

    return res.status(400).json({ error: '잘못된 요청' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
