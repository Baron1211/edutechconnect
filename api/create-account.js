// /api/create-account.js
// Runs on Vercel's server, never in the browser. Creates a Supabase Auth
// account that's pre-confirmed (skips Supabase's email-confirmation step
// entirely, which is what was causing "email rate limit exceeded" and
// "Email not confirmed" errors during self-registration).
//
// Requires these Environment Variables set in your Vercel project:
//   SUPABASE_URL              — same value as in the site's HTML files
//   SUPABASE_SERVICE_ROLE_KEY — the SECRET key from Supabase (never the anon key)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.' });
  }

  const { role, email, password, profile } = req.body || {};
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // 1. Create the auth account, pre-confirmed — no email sent, no rate limit.
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: (profile && profile.full_name) || '', role }
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      const msg = createData.msg || createData.message || createData.error_description || 'Could not create account.';
      const friendly = /already.*registered|already exists/i.test(msg)
        ? 'An account with this email already exists. Try logging in instead.'
        : msg;
      return res.status(400).json({ error: friendly });
    }
    const userId = createData.id;

    // 2. Fill in the rest of the profile fields (the DB trigger already
    //    inserted a bare row with just id/email/role/full_name).
    if (profile && Object.keys(profile).length) {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(profile)
      });
      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        return res.status(200).json({
          success: true,
          userId,
          warning: 'Account created, but some details could not be saved: ' + (errData.message || 'unknown error')
        });
      }
    }

    return res.status(200).json({ success: true, userId });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
}
