/* =====================================================================
   FREEZERS – úložiště videí a STRAT BOOK PDF v Cloudflare R2
   Přidej do svého existujícího Workeru (freezers-steam-auth).

   1) Cloudflare dashboard → R2 → Create bucket → název: freezers-media
   2) Workers & Pages → freezers-steam-auth → Settings → Bindings → Add → R2 bucket
        Variable name: MEDIA     Bucket: freezers-media
   3) Do Workeru vlož tuhle funkci a na ZAČÁTEK svého fetch() přidej:

        if (new URL(request.url).pathname.startsWith('/media/')) {
          return handleMedia(request, env, async (token) => {
            // ↓↓↓ TADY zavolej stejnou funkci, kterou tvůj Worker ověřuje X-Session-Token u /gh-proxy
            //     (musí vrátit objekt s .role a .username, nebo null když token neplatí)
            return await verifySessionToken(token, env);
          });
        }

   Web (index.html) pak nahrává videa a PDF sem automaticky. Dokud tohle ve Workeru
   není, web zkouší GitHub (a ten velké soubory odmítá).
   ===================================================================== */

const MEDIA_MAX_BYTES = 100 * 1024 * 1024; // limit těla requestu u Workers free plánu
const MEDIA_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function mediaCors(extra = {}) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  }, extra);
}
const mediaJson = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: mediaCors({ 'Content-Type': 'application/json' }) });

async function handleMedia(request, env, verify) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: mediaCors() });
  if (!env.MEDIA) return mediaJson({ error: 'R2 bucket MEDIA není připojený k Workeru' }, 501);

  // ---------- NAHRÁNÍ (jen admin / owner) ----------
  if (url.pathname === '/media/upload' && request.method === 'PUT') {
    const user = await verify(request.headers.get('X-Session-Token') || '');
    if (!user) return mediaJson({ error: 'Nejsi přihlášený' }, 401);
    const role = user.role || '';
    if (!(role === 'admin' || role === 'owner' || user.username === 'filas')) return mediaJson({ error: 'Nahrávat může jen admin' }, 403);

    const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (!/^(playbook-videos|stratbooks|playbook-maps)\/[\w.\-]+\.(mp4|webm|mov|pdf|jpg|jpeg|png|webp)$/i.test(path)) {
      return mediaJson({ error: 'Neplatná cesta souboru' }, 400);
    }
    const len = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (len > MEDIA_MAX_BYTES) return mediaJson({ error: 'Soubor je moc velký (max 100 MB)' }, 413);
    const ext = path.split('.').pop().toLowerCase();
    await env.MEDIA.put(path, request.body, {
      httpMetadata: { contentType: MEDIA_TYPES[ext] || 'application/octet-stream', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { uploadedBy: user.username || '', uploadedAt: new Date().toISOString() }
    });
    return mediaJson({ ok: true, path });
  }

  // ---------- SMAZÁNÍ (jen admin / owner) ----------
  if (request.method === 'DELETE') {
    const user = await verify(request.headers.get('X-Session-Token') || '');
    if (!user || !(user.role === 'admin' || user.role === 'owner' || user.username === 'filas')) return mediaJson({ error: 'Zakázáno' }, 403);
    await env.MEDIA.delete(url.pathname.slice('/media/'.length));
    return mediaJson({ ok: true });
  }

  // ---------- STAŽENÍ / PŘEHRÁVÁNÍ (s podporou Range → posouvání ve videu) ----------
  if (request.method === 'GET' || request.method === 'HEAD') {
    const key = decodeURIComponent(url.pathname.slice('/media/'.length));
    const rangeHeader = request.headers.get('Range');
    let range;
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        if (m[1] === '' && m[2] !== '') range = { suffix: parseInt(m[2], 10) };
        else range = { offset: parseInt(m[1], 10), length: m[2] ? parseInt(m[2], 10) - parseInt(m[1], 10) + 1 : undefined };
      }
    }
    const obj = await env.MEDIA.get(key, range ? { range } : undefined);
    if (!obj) return mediaJson({ error: 'Soubor nenalezen' }, 404);
    const headers = mediaCors({
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'ETag': obj.httpEtag
    });
    if (key.endsWith('.pdf')) headers['Content-Disposition'] = 'inline; filename="' + key.split('/').pop() + '"';
    if (range && obj.range) {
      const start = obj.range.offset !== undefined ? obj.range.offset : obj.size - obj.range.suffix;
      const length = obj.range.length !== undefined ? obj.range.length : obj.size - start;
      headers['Content-Range'] = `bytes ${start}-${start + length - 1}/${obj.size}`;
      headers['Content-Length'] = String(length);
      return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers });
    }
    headers['Content-Length'] = String(obj.size);
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
  }

  return mediaJson({ error: 'Nepodporovaná metoda' }, 405);
}
