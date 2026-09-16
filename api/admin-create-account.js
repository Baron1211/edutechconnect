// /api/admin-create-account.js
// Admin-only. Verifies the caller is really an authenticated admin before
// doing anything, then creates a pre-confirmed account with a randomly
// generated temporary password and returns that password so the admin
// panel can display it once for copying into a WhatsApp message.
//
// Requires the same Environment Variables as create-account.js, plus:
//   SUPABASE_ANON_KEY — same value as in the site's HTML files

function generatePassword() {
  const words = ['Forest', 'River', 'Cocoa', 'Kente', 'Baobab', 'Harmattan', 'Savannah', 'Adom'];
  const word = words[Math.floor(Math.random() * words.length)];
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${word}${digits}!`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return res.status(500).json({ error: 'Server is missing required Supabase environment variables.' });
  }

  // ---- Verify the caller is a real, currently-logged-in admin ----
  const authHeader = req.headers.authorization || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${callerToken}` }
  });
  const me = await meRes.json();
  if (!meRes.ok || !me.id) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  const profData = await profRes.json();
  if (!profRes.ok || !profData.length || profData[0].role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  // ---- Create the account ----
  const { role, email, full_name, extra } = req.body || {};
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (!email || !full_name) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const tempPassword = generatePassword();

  try {
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name, role }
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      const msg = createData.msg || createData.message || 'Could not create account.';
      const friendly = /already.*registered|already exists/i.test(msg)
        ? 'An account with this email already exists.'
        : msg;
      return res.status(400).json({ error: friendly });
    }
    const userId = createData.id;

    const profilePatch = { status: role === 'student' ? 'Payment Pending' : 'Active', ...(extra || {}) };
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(profilePatch)
    });

    return res.status(200).json({ success: true, userId, tempPassword });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
}
