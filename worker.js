/**
 * Freezers – Cloudflare Worker
 *  GET  /steam-login?returnTo=<url>   -> přesměruje na Steam OpenID
 *  GET  /steam-callback               -> ověří Steam, vydá session token, vrátí na web (#steam_token=...)
 *  POST /gh-proxy                     -> zápis/čtení souborů v GitHub repu (GitHub token zůstává jen tady)
 *
 * Secrets (wrangler secret put ...):
 *   SESSION_SECRET   dlouhý náhodný řetězec (min. 32 znaků) pro podepisování tokenů
 *   GH_TOKEN         GitHub fine-grained PAT, jen na to jedno repo, oprávnění Contents: Read and write
 *
 * Vars (wrangler.toml [vars] nebo Dashboard):
 *   GH_OWNER         např. feitmenn
 *   GH_REPO          např. freezers
 *   GH_BRANCH        např. main
 *   OWNER_USERNAME   např. filas   (tento účet má vždy roli owner)
 *   ALLOWED_ORIGINS  adresy webu oddělené čárkou, např. https://feitmenn.github.io,https://freezers.cz
 */

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const ID_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const USERS_FILE = 'users.json';

/* Seznam souborů, do kterých se smí přes proxy sahat, a kdo smí.
   min: 'member' = kdokoli přihlášený, 'admin' = admin/owner
   perm: oprávnění z users.json (permissions) – platí jen pro admina, owner smí vždy.
         Pokud admin nemá objekt permissions vůbec, bere se jako "vše povoleno". */
const FILES = {
  'rsvps.json':            { min: 'member' },
  'excuses.json':          { min: 'member' },
  'notifications.json':    { min: 'member' },
  'users.json':            { min: 'admin' },
  'news.json':             { min: 'admin' },
  'roster.json':           { min: 'admin' },
  'scrimserver.json':      { min: 'admin' },
  'partners.json':         { min: 'admin' },
  'influencers.json':      { min: 'admin' },
  'attendance.json':       { min: 'admin' },
  'calendar.json':         { min: 'admin', perm: ['calendars', 'main'] },
  'calendar-academy.json': { min: 'admin', perm: ['calendars', 'academy'] },
  'playbook.json':         { min: 'admin', perm: ['playbooks'] },
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/steam-login' && request.method === 'GET') return steamLogin(url, env);
      if (url.pathname === '/steam-callback' && request.method === 'GET') return await steamCallback(url, env);
      if (url.pathname === '/gh-proxy' && request.method === 'POST') return await ghProxy(request, env, cors);
      return json({ error: 'Nenalezeno' }, 404, cors);
    } catch (e) {
      console.error('Worker error:', e && e.stack || e);
      if (e && e.ghStatus === 401) return json({ error: 'Worker má neplatný GH_TOKEN (GitHub: Bad credentials). Majitel webu musí v Cloudflare obnovit secret GH_TOKEN.' }, 502, cors);
      if (e && (e.ghStatus === 403 || e.ghStatus === 404)) return json({ error: 'GitHub odmítl přístup Workeru k repu (HTTP ' + e.ghStatus + '). Zkontroluj GH_TOKEN, GH_OWNER a GH_REPO.' }, 502, cors);
      return json({ error: 'Interní chyba serveru' }, 500, cors);
    }
  },
};

/* ------------------------- Steam přihlášení ------------------------- */

function steamLogin(url, env) {
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), env);
  if (!returnTo) return new Response('Neplatný returnTo', { status: 400 });

  const callback = new URL('/steam-callback', url.origin);
  callback.searchParams.set('returnTo', returnTo.toString());

  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': callback.toString(),
    'openid.realm': url.origin,
    'openid.identity': ID_SELECT,
    'openid.claimed_id': ID_SELECT,
  });
  return Response.redirect(`${STEAM_OPENID}?${p.toString()}`, 302);
}

async function steamCallback(url, env) {
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), env);
  if (!returnTo) return new Response('Neplatný returnTo', { status: 400 });
  const fail = (code) => redirectWithHash(returnTo, 'steam_error=' + code);

  if (url.searchParams.get('openid.mode') !== 'id_res') return fail('cancelled');
  if (url.searchParams.get('openid.op_endpoint') !== STEAM_OPENID) return fail('invalid');

  // return_to musí ukazovat na tento Worker a se stejným returnTo
  try {
    const rt = new URL(url.searchParams.get('openid.return_to') || '');
    if (rt.origin !== url.origin || rt.pathname !== '/steam-callback' ||
        rt.searchParams.get('returnTo') !== url.searchParams.get('returnTo')) return fail('invalid');
  } catch { return fail('invalid'); }

  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(url.searchParams.get('openid.claimed_id') || '');
  if (!m) return fail('invalid');
  const steamId64 = m[1];

  // Ověření podpisu přímo u Steamu
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (k.startsWith('openid.')) params.set(k, v);
  params.set('openid.mode', 'check_authentication');
  const r = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const text = await r.text();
  if (!/is_valid\s*:\s*true/.test(text)) return fail('invalid');

  const users = await loadUsers(env);
  const user = users.find((u) => u && u.steamId64 === steamId64);
  if (!user) return fail('not_registered');

  const payload = {
    steamId64,
    username: user.username,
    displayName: user.displayName || user.username,
    role: roleOf(user, env),
    category: user.category === 'academy' ? 'academy' : 'main',
    permissions: user.permissions || null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const token = await signToken(payload, env);
  return redirectWithHash(returnTo, 'steam_token=' + token);
}

function safeReturnTo(raw, env) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!allowedOrigins(env).includes(u.origin)) return null;
    u.hash = '';
    return u;
  } catch { return null; }
}

function redirectWithHash(urlObj, hash) {
  const u = new URL(urlObj.toString());
  u.hash = hash;
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

/* ------------------------- GitHub proxy ------------------------- */

async function ghProxy(request, env, cors) {
  const payload = await verifyToken(request.headers.get('X-Session-Token'), env);
  if (!payload) return json({ error: 'Session vypršela nebo je neplatná — přihlas se znovu přes Steam.' }, 401, cors);

  // Aktuální stav účtu (role se mohla od vydání tokenu změnit, účet mohl být smazán)
  const users = await loadUsers(env);
  const me = users.find((u) => u && u.username === payload.username && u.steamId64 === payload.steamId64);
  if (!me) return json({ error: 'Účet už neexistuje nebo nemá přiřazený tento Steam.' }, 403, cors);
  const role = roleOf(me, env);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Neplatné tělo požadavku' }, 400, cors); }
  const path = body && body.path;
  const rule = typeof path === 'string' && Object.prototype.hasOwnProperty.call(FILES, path) ? FILES[path] : null;
  if (!rule) return json({ error: 'Tento soubor není povolený.' }, 403, cors);
  if (!allowed(rule, role, me)) return json({ error: 'Na tuhle akci nemáš oprávnění.' }, 403, cors);

  if (body.action === 'get-sha') return ghGet(path, env, cors);
  if (body.action === 'put') return ghPut(body, path, me, role, users, env, cors);
  return json({ error: 'Neznámá akce' }, 400, cors);
}

function allowed(rule, role, me) {
  if (role === 'owner') return true;
  if (rule.min === 'member') return true;
  if (role !== 'admin') return false;
  const perms = me.permissions;
  if (rule.perm && perms && typeof perms === 'object') {
    const [key, val] = rule.perm;
    const v = perms[key];
    return val === undefined ? !!v : Array.isArray(v) && v.includes(val);
  }
  return true;
}

async function ghGet(path, env, cors) {
  const res = await gh(env, `/contents/${encodeURI(path)}?ref=${encodeURIComponent(env.GH_BRANCH || 'main')}`);
  if (res.status === 404) return json({ error: 'Soubor neexistuje' }, 404, cors);
  if (!res.ok) return json({ error: 'GitHub chyba ' + res.status }, 502, cors);
  const data = await res.json();

  // Contents API vrací prázdný obsah u souborů >1 MB – dočteme přes blob API
  if ((!data.content || data.encoding === 'none') && data.sha && data.size > 0) {
    const blob = await gh(env, `/git/blobs/${data.sha}`);
    if (!blob.ok) return json({ error: 'GitHub chyba ' + blob.status }, 502, cors);
    const b = await blob.json();
    return json({ sha: data.sha, content: b.content }, 200, cors);
  }
  return json({ sha: data.sha, content: data.content }, 200, cors);
}

async function ghPut(body, path, me, role, users, env, cors) {
  const { content, sha, message } = body;
  if (typeof content !== 'string' || content.length > MAX_CONTENT_BYTES * 1.4) {
    return json({ error: 'Neplatný nebo příliš velký obsah' }, 400, cors);
  }
  let parsed;
  try { parsed = JSON.parse(b64ToUtf8(content)); }
  catch { return json({ error: 'Obsah není platný JSON' }, 400, cors); }

  if (path === USERS_FILE) {
    const problem = validateUsersWrite(users, parsed, role, env);
    if (problem) return json({ error: problem }, 403, cors);
  }

  const commitMessage = (String(message || 'Aktualizace ' + path).slice(0, 200) + ` [${me.username}]`);
  const payload = { message: commitMessage, content, branch: env.GH_BRANCH || 'main' };
  if (typeof sha === 'string' && sha) payload.sha = sha;

  const res = await gh(env, `/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = res.status === 401 ? 'Worker má neplatný GH_TOKEN (GitHub: Bad credentials). Majitel webu musí v Cloudflare obnovit secret GH_TOKEN.'
      : res.status === 409 || res.status === 422
      ? 'Soubor mezitím někdo změnil — obnov stránku a zkus to znovu.'
      : (data.message || 'GitHub chyba ' + res.status);
    return json({ error: msg }, res.status === 409 || res.status === 422 ? 409 : 502, cors);
  }
  return json({ ok: true, sha: data.content && data.content.sha }, 200, cors);
}

/* Ochrana users.json: i admin smí upravovat jen to, co mu UI dovoluje */
function validateUsersWrite(oldUsers, newUsers, role, env) {
  if (!Array.isArray(newUsers)) return 'users.json musí být pole.';
  const owner = env.OWNER_USERNAME || 'filas';
  const seenNames = new Set();
  const seenSteam = new Set();

  for (const u of newUsers) {
    if (!u || typeof u.username !== 'string' || !u.username || u.username.length > 40) return 'Neplatné uživatelské jméno.';
    if (seenNames.has(u.username)) return 'Duplicitní uživatelské jméno.';
    seenNames.add(u.username);
    if (u.steamId64 != null && !/^\d{17}$/.test(String(u.steamId64))) return 'Neplatné SteamID64.';
    if (u.steamId64) {
      if (seenSteam.has(u.steamId64)) return 'Stejné SteamID64 nesmí mít dva účty.';
      seenSteam.add(u.steamId64);
    }
    if (u.role === 'owner' && u.username !== owner) return 'Roli owner nelze přidělit.';
    if (u.role && !['owner', 'admin', 'member'].includes(u.role)) return 'Neplatná role.';
  }

  if (role === 'owner') return null;

  // Admin: owner účet musí zůstat nedotčený
  const oldOwner = oldUsers.find((u) => u.username === owner);
  if (oldOwner) {
    const newOwner = newUsers.find((u) => u.username === owner);
    if (!newOwner) return 'Owner účet nelze smazat.';
    if ((newOwner.steamId64 || null) !== (oldOwner.steamId64 || null)) return 'Owner účet nelze měnit.';
  }
  // Admin nesmí měnit kategorii ani oprávnění (to umí jen owner)
  const norm = (u) => JSON.stringify([u.category === 'academy' ? 'academy' : 'main', u.permissions || null]);
  for (const u of newUsers) {
    const prev = oldUsers.find((o) => o.username === u.username);
    if (prev && norm(prev) !== norm(u)) return 'Kategorii a oprávnění může měnit jen owner.';
    if (!prev && norm(u) !== JSON.stringify(['main', null])) return 'Nový účet může založit admin jen v kategorii Main bez speciálních oprávnění.';
  }
  return null;
}

/* ------------------------- Pomocné funkce ------------------------- */

function roleOf(user, env) {
  if (user.username === (env.OWNER_USERNAME || 'filas')) return 'owner';
  return user.role === 'admin' ? 'admin' : 'member';
}

async function gh(env, apiPath, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}${apiPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${String(env.GH_TOKEN || '').trim().replace(/^["']|["']$/g, '')}`,
      'User-Agent': 'freezers-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}

async function loadUsers(env) {
  const res = await gh(env, `/contents/${USERS_FILE}?ref=${encodeURIComponent(env.GH_BRANCH || 'main')}`, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  if (res.status === 404) return [];
  if (!res.ok) { const e = new Error('users.json: GitHub ' + res.status); e.ghStatus = res.status; throw e; }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Session-Token';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

/* Tokeny: base64url(JSON payload) + "." + base64url(HMAC-SHA256) */
async function hmacKey(env, usage) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET chybí nebo je příliš krátký');
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
async function signToken(payload, env) {
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env, 'sign'), enc.encode(p));
  return p + '.' + b64urlEncode(new Uint8Array(sig));
}
async function verifyToken(token, env) {
  if (typeof token !== 'string') return null;
  const [p, s, extra] = token.split('.');
  if (!p || !s || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env, 'verify'), b64urlDecode(s), enc.encode(p));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(p)));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return dec.decode(out);
}
