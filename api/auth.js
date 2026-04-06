const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { action } = req.query;

  let body = {};
  if (req.method === 'POST') {
    try {
      if (typeof req.body === 'string') body = JSON.parse(req.body);
      else body = req.body || {};
    } catch(e) { body = {}; }
  }

  try {
    if (action === 'signup') {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
      const { data, error } = await supabase.auth.signUp({ 
        email, password,
        options: { emailRedirectTo: process.env.SITE_URL }
      });
      if (error) return res.status(400).json({ error: error.message });
      if (data.user) {
        await supabase.from('users').upsert({ id: data.user.id, email, usage_count: 0, usage_reset_at: new Date().toISOString() });
      }
      return res.status(200).json({ success: true, message: '이메일 인증 후 로그인해주세요.' });
    }

    if (action === 'login') {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(400).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return res.status(200).json({ success: true, session: data.session, user: data.user });
    }

    if (action === 'forgot') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: process.env.SITE_URL
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'check_usage') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: '인증 실패' });
      let { data: userData } = await supabase.from('users').select('*').eq('id', user.id).single();
      if (!userData) {
        await supabase.from('users').insert({ id: user.id, email: user.email, usage_count: 0, usage_reset_at: new Date().toISOString() });
        return res.status(200).json({ allowed: true, premium: false, remaining: 9, usage: 1 });
      }
      if (userData.is_premium) {
        const expiry = new Date(userData.premium_expires_at);
        if (expiry > new Date()) return res.status(200).json({ allowed: true, premium: true, remaining: 999 });
        await supabase.from('users').update({ is_premium: false, premium_expires_at: null }).eq('id', user.id);
      }
      const resetAt = new Date(userData.usage_reset_at);
      const now = new Date();
      let usageCount = userData.usage_count;
      if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
        usageCount = 0;
        await supabase.from('users').update({ usage_count: 0, usage_reset_at: now.toISOString() }).eq('id', user.id);
      }
      const FREE_LIMIT = 10;
      if (usageCount >= FREE_LIMIT) return res.status(200).json({ allowed: false, premium: false, remaining: 0, usage: usageCount });
      await supabase.from('users').update({ usage_count: usageCount + 1 }).eq('id', user.id);
      return res.status(200).json({ allowed: true, premium: false, remaining: FREE_LIMIT - usageCount - 1, usage: usageCount + 1 });
    }

    if (action === 'me') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: '인증 실패' });
      const { data: userData } = await supabase.from('users').select('*').eq('id', user.id).single();
      return res.status(200).json({ user: { ...user, ...(userData||{}) } });
    }

    return res.status(400).json({ error: '잘못된 요청' });
  } catch(e) {
    console.error('Auth error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
