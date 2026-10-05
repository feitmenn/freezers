import crypto from 'node:crypto';

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://freezers-esport.eu';
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
const USERS_URL = 'https://raw.githubusercontent.com/feitmenn/freezers/main/users.json';
const TOKEN_TTL = 7 * 24 * 3600;

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const params = new URLSearchParams(event.rawQuery || '');
  const returnTo = decodeURIComponent(params.get('returnTo') || SITE_ORIGIN);

  if (!returnTo.startsWith(SITE_ORIGIN)) {
    return errorPage('Neplatný návratový odkaz.');
  }

  try {
    const isValid = await verifySteamOpenID(params);
    if (!isValid) {
      return errorPage('Steam ověření selhalo. Zkus to prosím znovu.');
    }

    const claimedId = params.get('openid.claimed_id') || '';
    const steamId64 = extractSteamID64(claimedId);
    if (!steamId64) {
      return errorPage('Nepodařilo se získat SteamID.');
    }

    const users = await fetchUsers();
    const user = users.find(u => u.steamId64 === steamId64);
    if (!user) {
      return errorPage(
        `Tvůj Steam účet (${steamId64}) není přiřazený k žádnému účtu na webu. Kontaktuj staff.`
      );
    }

    const token = createSessionToken(user);
    const separator = returnTo.includes('#') ? '&' : '#';
    const redirectUrl = `${returnTo}${separator}steam_token=${token}`;

    return {
      statusCode: 302,
      headers: { Location: redirectUrl, ...corsHeaders() },
      body: ''
    };
  } catch (err) {
    console.error('Steam callback error:', err);
    return errorPage('Chyba při přihlášení přes Steam: ' + err.message);
  }
}

async function verifySteamOpenID(params) {
  const verifyParams = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    verifyParams.set(key, value);
  }
  verifyParams.set('openid.mode', 'check_authentication');

  const res = await fetch('https://steamcommunity.com/openid/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString()
  });

  const text = await res.text();
  return text.includes('is_valid:true');
}

function extractSteamID64(claimedId) {
  const match = claimedId.match(/\/(\d{17})$/);
  return match ? match[1] : null;
}

async function fetchUsers() {
  const res = await fetch(USERS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch users.json');
  return res.json();
}

function createSessionToken(user) {
  const payload = {
    steamId64: user.steamId64,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || 'member',
    category: user.category || 'main',
    permissions: user.permissions || null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function errorPage(message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
    body: `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chyba přihlášení</title>
<style>body{font-family:sans-serif;background:#0b0b0c;color:#e4e8ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}
.box{max-width:480px;padding:32px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(18,18,20,.9)}
h2{color:#ff5555;margin:0 0 12px}p{margin:0 0 20px;line-height:1.6}
a{color:#2fe0c9;text-decoration:none;font-weight:600}</style></head>
<body><div class="box"><h2>Chyba přihlášení</h2><p>${escapeHtml(message)}</p>
<a href="${SITE_ORIGIN}">Zpět na web</a></div></body></html>`
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': SITE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };
}
