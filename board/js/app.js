/* Freezers Board — taktická tabule pro CS2 (Neutralino + funguje i v prohlížeči) */
(function(){
'use strict';
const NATIVE = typeof window.Neutralino !== 'undefined' && typeof window.NL_PORT !== 'undefined';
if(NATIVE){ try{ Neutralino.init(); Neutralino.events.on('windowClose', () => { saveLocal(); Neutralino.app.exit(); }); }catch(e){} }

const SIZE = 1024;                                   /* souřadnice tabule 0..1024 */
const MAPS = ['Mirage', 'Inferno', 'Nuke', 'Ancient', 'Anubis', 'Dust2', 'Train', 'Overpass', 'Vlastní'];
const RADAR_URL = m => `https://freezers-esport.eu/app/radars/${m.toLowerCase()}.png`;
const COLORS = ['#2fe0c9', '#ffffff', '#facc15', '#f97316', '#ef4444', '#ff5fb0', '#9a5cff', '#3b9cff', '#4ade80', '#111827', '#94a3b8', '#a16207'];
const WIDTHS = [2, 4, 7, 11];
const SIDE_C = { T: '#f59e0b', CT: '#3b9cff' };
const UTILS = { smoke: { l: 'Smoke', c: '#cbd5e1' }, flash: { l: 'Flash', c: '#fde047' }, molly: { l: 'Molotov', c: '#f97316' }, he: { l: 'HE', c: '#ef4444' }, bomb: { l: 'Bomba', c: '#ff5fb0' }, eye: { l: 'Drží', c: '#4ade80' } };
const I = { /* ikony nástrojů (vlastní jednoduché SVG) */
  select: '<path d="M5 3l14 8-6 2-3 6z"/>',
  pan: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-2L8 13"/>',
  pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  line: '<path d="M5 19L19 5"/>',
  dash: '<path d="M4 20l3-3M9 15l3-3M14 10l3-3M19 5l1-1"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  eraser: '<path d="M16 4l5 5-10 10H6l-3-3z"/><path d="M11 9l5 5M9 20h12"/>',
  T: '<circle cx="12" cy="12" r="8"/><path d="M9 9h6M12 9v7"/>',
  CT: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5a3.5 3.5 0 1 0 0 5"/>',
  smoke: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="11" r="5"/>',
  flash: '<path d="M13 3L6 13h5l-1 8 7-10h-5z"/>',
  molly: '<path d="M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-2-1-4 0-6z"/>',
  he: '<circle cx="12" cy="14" r="6"/><path d="M12 8V5h3"/>',
  bomb: '<rect x="5" y="8" width="14" height="10" rx="2"/><path d="M9 8V6h6v2M9 13h6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
};
const TOOLS = [['select', 'Výběr a přesun', 'V'], ['pan', 'Posun mapy', 'H'], null, ['pen', 'Tužka', 'P'], ['arrow', 'Šipka', 'A'], ['line', 'Čára', 'L'], ['dash', 'Přerušovaná čára (rotace)', 'D'], ['rect', 'Obdélník', 'R'], ['circle', 'Kruh', 'C'], ['text', 'Text', 'T'], ['eraser', 'Guma', 'E'], null, ['T', 'Hráč T', '1'], ['CT', 'Hráč CT', '2'], ['smoke', 'Smoke', '3'], ['flash', 'Flash', '4'], ['molly', 'Molotov', '5'], ['he', 'HE granát', '6']];

const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
const S = {
  map: 'Mirage', tool: 'pen', color: COLORS[0], width: 4,
  tok: { side: 'T', n: 1 }, util: 'smoke',
  boards: {},            /* mapa -> { steps:[{name, items}], step } */
  view: { x: 0, y: 0, s: 1 }, sel: null, drag: null, hist: {}, redo: {}
};
const bgCache = {};
function board(){ if(!S.boards[S.map]) S.boards[S.map] = { steps: [{ name: 'Setup', items: [] }], step: 0 }; return S.boards[S.map]; }
function step(){ const b = board(); return b.steps[b.step]; }
function items(){ return step().items; }
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- historie ---------- */
function hkey(){ return S.map + '#' + board().step; }
function snapshot(){ const k = hkey(); (S.hist[k] = S.hist[k] || []).push(JSON.stringify(items())); if(S.hist[k].length > 120) S.hist[k].shift(); S.redo[k] = []; dirty(); }
function undo(){ const k = hkey(), h = S.hist[k]; if(!h || !h.length) return toast('Není co vrátit'); (S.redo[k] = S.redo[k] || []).push(JSON.stringify(items())); step().items = JSON.parse(h.pop()); S.sel = null; draw(); dirty(); }
function redo(){ const k = hkey(), r = S.redo[k]; if(!r || !r.length) return; (S.hist[k] = S.hist[k] || []).push(JSON.stringify(items())); step().items = JSON.parse(r.pop()); S.sel = null; draw(); dirty(); }

/* ---------- uložení ---------- */
let saveT = 0;
function dirty(){ clearTimeout(saveT); saveT = setTimeout(saveLocal, 600); }
function saveLocal(){ try{ localStorage.setItem('fzb-state', JSON.stringify({ map: S.map, boards: S.boards, color: S.color, width: S.width })); }catch(e){} }
function loadLocal(){ try{ const d = JSON.parse(localStorage.getItem('fzb-state') || 'null'); if(d && d.boards){ S.boards = d.boards; S.map = MAPS.includes(d.map) ? d.map : S.map; S.color = d.color || S.color; S.width = d.width || S.width; } }catch(e){} }
function toast(t){ const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1800); }

/* ---------- podklad mapy ---------- */
function radarKey(m){ return 'fzb-radar-' + m; }
function loadBg(m){
  if(bgCache[m]) return bgCache[m];
  const st = bgCache[m] = { img: null, src: 'grid' };
  let own = null; try{ own = localStorage.getItem(radarKey(m)); }catch(e){}
  const tryImg = (src, kind, next) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { st.img = im; st.src = kind; draw(); updateBgNote(); }; im.onerror = () => next && next(); im.src = src; };
  if(own) tryImg(own, 'own', () => m !== 'Vlastní' && tryImg(RADAR_URL(m), 'web'));
  else if(m !== 'Vlastní') tryImg(RADAR_URL(m), 'web');
  return st;
}
function setRadar(dataUrl){
  try{ localStorage.setItem(radarKey(S.map), dataUrl); }catch(e){ toast('Obrázek je moc velký na uložení, zkus menší (do 4 MB)'); }
  delete bgCache[S.map]; loadBg(S.map); toast('Radar pro ' + S.map + ' nastaven');
}
function fileToRadar(file){
  if(!file || !/^image\//.test(file.type)) return toast('Tohle není obrázek');
  const r = new FileReader(); r.onload = () => {
    const im = new Image(); im.onload = () => { /* zmenšit na max 1600 px kvůli úložišti */
      const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); setRadar(c.toDataURL('image/webp', 0.9).startsWith('data:image/webp') ? c.toDataURL('image/webp', 0.9) : c.toDataURL('image/png'));
    }; im.src = r.result;
  }; r.readAsDataURL(file);
}
function updateBgNote(){
  const st = bgCache[S.map] || {};
  $('bgNote').textContent = st.src === 'own' ? 'Používáš vlastní radar pro tuhle mapu.' : st.src === 'web' ? 'Radar se načetl z webu Freezers.' : 'Bez radaru – nahraj obrázek mapy nebo ho přetáhni na tabuli.';
}

/* ---------- vykreslení ---------- */
let W = 0, H = 0, DPR = 1;
function resize(){ const r = stage.getBoundingClientRect(); DPR = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); draw(); }
function fit(){ const s = Math.min(W, H) / SIZE * 0.96; S.view = { s, x: (W - SIZE * s) / 2, y: (H - SIZE * s) / 2 }; zoomLabel(); draw(); }
function zoomLabel(){ $('zVal').textContent = Math.round(S.view.s / (Math.min(W, H) / SIZE * 0.96) * 100) + ' %'; }
function toBoard(e){ const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - S.view.x) / S.view.s, (e.clientY - r.top - S.view.y) / S.view.s]; }

function drawGrid(c){
  c.save();
  c.fillStyle = '#10141c'; c.fillRect(0, 0, SIZE, SIZE);
  c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
  for(let i = 0; i <= SIZE; i += 32){ c.beginPath(); c.moveTo(i, 0); c.lineTo(i, SIZE); c.moveTo(0, i); c.lineTo(SIZE, i); c.stroke(); }
  c.strokeStyle = 'rgba(255,255,255,.1)';
  for(let i = 0; i <= SIZE; i += 128){ c.beginPath(); c.moveTo(i, 0); c.lineTo(i, SIZE); c.moveTo(0, i); c.lineTo(SIZE, i); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.07)'; c.font = '700 120px Chakra, ChakraX, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(S.map.toUpperCase(), SIZE / 2, SIZE / 2 - 20);
  c.font = '600 22px Inter, InterX, sans-serif'; c.fillStyle = 'rgba(255,255,255,.22)';
  if(S.map !== 'Vlastní' && !items().length) c.fillText('Přetáhni sem radar mapy nebo klikni na „Nahrát radar“', SIZE / 2, SIZE / 2 + 70);
  c.restore();
}
function drawBg(c){
  const st = loadBg(S.map);
  if(!st.img){ drawGrid(c); return; }
  c.fillStyle = '#0d1016'; c.fillRect(0, 0, SIZE, SIZE);
  const im = st.img, k = Math.min(SIZE / im.width, SIZE / im.height), w = im.width * k, h = im.height * k;
  c.drawImage(im, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
}
function arrowHead(c, a, b, w){
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 10 + w * 2.6;
  c.beginPath(); c.moveTo(b[0], b[1]);
  c.lineTo(b[0] - L * Math.cos(ang - 0.42), b[1] - L * Math.sin(ang - 0.42));
  c.lineTo(b[0] - L * Math.cos(ang + 0.42), b[1] - L * Math.sin(ang + 0.42));
  c.closePath(); c.fill();
}
function drawItem(c, it, sel){
  c.save();
  c.strokeStyle = c.fillStyle = it.c || '#fff'; c.lineWidth = it.w || 4; c.lineCap = 'round'; c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 4;
  if(it.t === 'pen'){
    const p = it.pts; if(p.length < 2){ c.beginPath(); c.arc(p[0][0], p[0][1], c.lineWidth / 2, 0, 7); c.fill(); }
    else{ c.beginPath(); c.moveTo(p[0][0], p[0][1]); for(let i = 1; i < p.length - 1; i++){ const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; c.quadraticCurveTo(p[i][0], p[i][1], mx, my); } c.lineTo(p[p.length - 1][0], p[p.length - 1][1]); c.stroke(); }
  }else if(it.t === 'arrow' || it.t === 'line' || it.t === 'dash'){
    if(it.t === 'dash') c.setLineDash([it.w * 2.5, it.w * 2.2]);
    const b = it.t === 'arrow' ? shorten(it.a, it.b, 6 + it.w) : it.b;
    c.beginPath(); c.moveTo(it.a[0], it.a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]);
    if(it.t === 'arrow' || it.t === 'dash') arrowHead(c, it.a, it.b, it.w);
  }else if(it.t === 'rect'){
    const x = Math.min(it.a[0], it.b[0]), y = Math.min(it.a[1], it.b[1]), w = Math.abs(it.b[0] - it.a[0]), h = Math.abs(it.b[1] - it.a[1]);
    c.globalAlpha = 0.14; c.fillRect(x, y, w, h); c.globalAlpha = 1; c.strokeRect(x, y, w, h);
  }else if(it.t === 'circle'){
    const r = Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]);
    c.beginPath(); c.arc(it.a[0], it.a[1], r, 0, 7); c.globalAlpha = 0.14; c.fill(); c.globalAlpha = 1; c.stroke();
  }else if(it.t === 'text'){
    c.font = `700 ${it.size || 24}px Chakra, ChakraX, sans-serif`; c.textBaseline = 'top'; c.textAlign = 'left'; c.shadowBlur = 0;
    c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.75)';
    String(it.s).split('\n').forEach((ln, i) => { c.strokeText(ln, it.p[0], it.p[1] + i * (it.size || 24) * 1.15); c.fillText(ln, it.p[0], it.p[1] + i * (it.size || 24) * 1.15); });
  }else if(it.t === 'tok'){
    const R = 17, col = SIDE_C[it.side];
    c.beginPath(); c.arc(it.p[0], it.p[1], R, 0, 7); c.fillStyle = col; c.fill();
    c.shadowBlur = 0; c.lineWidth = 3; c.strokeStyle = '#0b0d12'; c.stroke();
    c.fillStyle = '#0b0d12'; c.font = '700 18px Chakra, ChakraX, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(it.n), it.p[0], it.p[1] + 1);
    if(it.label){ c.font = '600 13px Inter, InterX, sans-serif'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(it.label, it.p[0], it.p[1] + R + 11); c.fillStyle = '#fff'; c.fillText(it.label, it.p[0], it.p[1] + R + 11); }
  }else if(it.t === 'util'){
    const u = UTILS[it.k] || UTILS.smoke;
    if(it.k === 'smoke'){ c.beginPath(); c.arc(it.p[0], it.p[1], 36, 0, 7); c.globalAlpha = .45; c.fillStyle = '#e2e8f0'; c.fill(); c.globalAlpha = 1; c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.8)'; c.stroke(); }
    if(it.k === 'molly'){ c.beginPath(); c.arc(it.p[0], it.p[1], 30, 0, 7); c.globalAlpha = .38; c.fillStyle = '#f97316'; c.fill(); c.globalAlpha = 1; c.lineWidth = 2; c.strokeStyle = '#fb923c'; c.setLineDash([5, 4]); c.stroke(); c.setLineDash([]); }
    c.beginPath(); c.arc(it.p[0], it.p[1], 14, 0, 7); c.fillStyle = '#0b0d12'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = u.c; c.stroke();
    c.save(); c.translate(it.p[0] - 9, it.p[1] - 9); c.scale(0.75, 0.75); c.strokeStyle = u.c; c.lineWidth = 2.4; c.shadowBlur = 0;
    iconPaths(it.k).forEach(pp => c.stroke(pp));
    c.restore();
  }
  c.restore();
  if(sel){ const b = bbox(it); c.save(); c.strokeStyle = '#2fe0c9'; c.lineWidth = 1.5 / S.view.s; c.setLineDash([6 / S.view.s, 4 / S.view.s]); c.strokeRect(b[0] - 6, b[1] - 6, b[2] - b[0] + 12, b[3] - b[1] + 12); c.restore(); }
}
const ICON_CACHE = {};
function iconPaths(name){
  if(ICON_CACHE[name]) return ICON_CACHE[name];
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${I[name] || ''}</svg>`, 'image/svg+xml');
  const out = [];
  doc.documentElement.querySelectorAll('*').forEach(el => {
    const n = el.tagName.toLowerCase(), a = k => parseFloat(el.getAttribute(k)) || 0, p = new Path2D();
    if(n === 'path') out.push(new Path2D(el.getAttribute('d')));
    else if(n === 'circle'){ p.arc(a('cx'), a('cy'), a('r'), 0, Math.PI * 2); out.push(p); }
    else if(n === 'rect'){ p.rect(a('x'), a('y'), a('width'), a('height')); out.push(p); }
  });
  return (ICON_CACHE[name] = out);
}
function shorten(a, b, d){ const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [b[0] - (b[0] - a[0]) / L * d, b[1] - (b[1] - a[1]) / L * d]; }
function render(c, withSel){
  drawBg(c);
  items().forEach(it => drawItem(c, it, withSel && S.sel === it.id));
  if(S.drag && S.drag.preview) drawItem(c, S.drag.preview, false);
}
function draw(){
  if(!W) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(S.view.x, S.view.y); ctx.scale(S.view.s, S.view.s);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 40; ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, SIZE, SIZE); ctx.restore();
  ctx.beginPath(); ctx.rect(0, 0, SIZE, SIZE); ctx.clip();
  render(ctx, true);
  ctx.restore();
}

/* ---------- hit test ---------- */
function bbox(it){
  if(it.t === 'pen'){ let a = 1e9, b = 1e9, c = -1e9, d = -1e9; it.pts.forEach(p => { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }); return [a, b, c, d]; }
  if(it.t === 'circle'){ const r = Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]); return [it.a[0] - r, it.a[1] - r, it.a[0] + r, it.a[1] + r]; }
  if(it.a) return [Math.min(it.a[0], it.b[0]), Math.min(it.a[1], it.b[1]), Math.max(it.a[0], it.b[0]), Math.max(it.a[1], it.b[1])];
  if(it.t === 'text'){ ctx.save(); ctx.font = `700 ${it.size || 24}px Chakra, ChakraX, sans-serif`; const lines = String(it.s).split('\n'); const w = Math.max(...lines.map(l => ctx.measureText(l).width)); ctx.restore(); return [it.p[0], it.p[1], it.p[0] + w, it.p[1] + lines.length * (it.size || 24) * 1.15]; }
  const r = it.t === 'util' ? (it.k === 'smoke' ? 36 : it.k === 'molly' ? 30 : 16) : 18;
  return [it.p[0] - r, it.p[1] - r, it.p[0] + r, it.p[1] + r];
}
function segDist(p, a, b){ const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function hit(p, tol){
  const list = items();
  for(let i = list.length - 1; i >= 0; i--){
    const it = list[i], t = tol + (it.w || 0) / 2;
    if(it.t === 'pen'){ for(let j = 1; j < it.pts.length; j++) if(segDist(p, it.pts[j - 1], it.pts[j]) < t) return it; if(it.pts.length === 1 && Math.hypot(p[0] - it.pts[0][0], p[1] - it.pts[0][1]) < t) return it; }
    else if(it.t === 'arrow' || it.t === 'line' || it.t === 'dash'){ if(segDist(p, it.a, it.b) < t) return it; }
    else if(it.t === 'circle'){ const r = Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]), d = Math.hypot(p[0] - it.a[0], p[1] - it.a[1]); if(d < r + t) return it; }
    else{ const b = bbox(it); if(p[0] > b[0] - tol && p[0] < b[2] + tol && p[1] > b[1] - tol && p[1] < b[3] + tol) return it; }
  }
  return null;
}
function moveItem(it, dx, dy){
  if(it.pts) it.pts = it.pts.map(q => [q[0] + dx, q[1] + dy]);
  if(it.a){ it.a = [it.a[0] + dx, it.a[1] + dy]; it.b = [it.b[0] + dx, it.b[1] + dy]; }
  if(it.p) it.p = [it.p[0] + dx, it.p[1] + dy];
}
function nextTokN(side){ const used = items().filter(i => i.t === 'tok' && i.side === side).map(i => i.n); for(let n = 1; n <= 5; n++) if(!used.includes(n)) return n; return (used.length % 5) + 1; }

/* ---------- ovládání myší ---------- */
let spaceDown = false;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  const p = toBoard(e), tool = (spaceDown || e.button === 1) ? 'pan' : S.tool;
  if(e.button === 2){ const h = hit(p, 10 / S.view.s); if(h){ snapshot(); step().items = items().filter(i => i !== h); draw(); } return; }
  if(tool === 'pan'){ S.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y }; stage.classList.add('panning'); return; }
  if(tool === 'select'){
    const h = hit(p, 8 / S.view.s); S.sel = h ? h.id : null;
    if(h){ snapshot(); S.drag = { move: h, last: p }; }
    draw(); return;
  }
  if(tool === 'eraser'){ snapshot(); S.drag = { erase: true }; eraseAt(p); return; }
  if(tool === 'text'){ e.preventDefault(); openText(p); return; }
  if(tool === 'T' || tool === 'CT'){
    const exist = hit(p, 4 / S.view.s);
    if(exist && exist.t === 'tok'){ snapshot(); S.drag = { move: exist, last: p }; S.sel = exist.id; draw(); return; }
    snapshot(); const n = S.tok.side === tool && S.tok.manual ? S.tok.n : nextTokN(tool); S.tok.manual = false;
    const it = { id: uid(), t: 'tok', side: tool, n, p }; items().push(it); S.drag = { move: it, last: p }; draw(); syncSide(); return;
  }
  if(UTILS[tool]){ snapshot(); const it = { id: uid(), t: 'util', k: tool, p }; items().push(it); S.drag = { move: it, last: p }; draw(); return; }
  const base = { id: uid(), t: tool, c: S.color, w: S.width };
  if(tool === 'pen') base.pts = [p]; else { base.a = p; base.b = p; }
  S.drag = { draw: base, preview: base };
});
cv.addEventListener('pointermove', e => {
  const d = S.drag; if(!d) return;
  if(d.pan){ S.view.x = d.vx + e.clientX - d.sx; S.view.y = d.vy + e.clientY - d.sy; draw(); return; }
  const p = toBoard(e);
  if(d.move){ moveItem(d.move, p[0] - d.last[0], p[1] - d.last[1]); d.last = p; draw(); return; }
  if(d.erase){ eraseAt(p); return; }
  if(d.draw){
    if(d.draw.pts){ const l = d.draw.pts[d.draw.pts.length - 1]; if(Math.hypot(p[0] - l[0], p[1] - l[1]) > 1.5 / S.view.s) d.draw.pts.push(p); }
    else{ let q = p; if(e.shiftKey && d.draw.t !== 'circle'){ const dx = p[0] - d.draw.a[0], dy = p[1] - d.draw.a[1]; if(d.draw.t === 'rect'){ const m = Math.max(Math.abs(dx), Math.abs(dy)); q = [d.draw.a[0] + Math.sign(dx) * m, d.draw.a[1] + Math.sign(dy) * m]; } else { const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(dx, dy); q = [d.draw.a[0] + Math.cos(ang) * L, d.draw.a[1] + Math.sin(ang) * L]; } } d.draw.b = q; }
    draw();
  }
});
function endDrag(){
  const d = S.drag; S.drag = null; stage.classList.remove('panning');
  if(!d) return;
  if(d.draw){
    const it = d.draw, tiny = it.pts ? false : Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]) < 4;
    if(!tiny){ snapshot(); items().push(it); }
  }
  if(d.move || d.erase || d.draw) dirty();
  draw();
}
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('contextmenu', e => e.preventDefault());
function eraseAt(p){ const h = hit(p, 10 / S.view.s); if(h){ step().items = items().filter(i => i !== h); draw(); } }
cv.addEventListener('dblclick', e => { const h = hit(toBoard(e), 6 / S.view.s); if(h && h.t === 'text') openText(h.p, h); else if(h && h.t === 'tok'){ const l = prompt('Jméno hráče u žetonu ' + h.side + ' ' + h.n + ':', h.label || ''); if(l !== null){ snapshot(); h.label = l.trim().slice(0, 16); draw(); } } });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.exp(-e.deltaY * 0.0015), base = Math.min(W, H) / SIZE * 0.96, s = Math.max(base * 0.4, Math.min(base * 8, S.view.s * k));
  S.view.x = mx - (mx - S.view.x) * s / S.view.s; S.view.y = my - (my - S.view.y) * s / S.view.s; S.view.s = s; zoomLabel(); draw();
}, { passive: false });
function zoomBy(k){ const mx = W / 2, my = H / 2, base = Math.min(W, H) / SIZE * 0.96, s = Math.max(base * 0.4, Math.min(base * 8, S.view.s * k)); S.view.x = mx - (mx - S.view.x) * s / S.view.s; S.view.y = my - (my - S.view.y) * s / S.view.s; S.view.s = s; zoomLabel(); draw(); }

/* ---------- text ---------- */
function openText(p, existing){
  const ta = document.createElement('div'); ta.className = 'textbox'; ta.contentEditable = 'true';
  ta.style.left = (S.view.x + p[0] * S.view.s) + 'px'; ta.style.top = (S.view.y + p[1] * S.view.s) + 'px';
  ta.style.fontSize = Math.max(12, 24 * S.view.s) + 'px'; ta.style.color = existing ? existing.c : S.color;
  ta.textContent = existing ? existing.s : ''; stage.appendChild(ta);
  const born = Date.now(), grab = () => { ta.focus(); document.getSelection().selectAllChildren(ta); };
  setTimeout(grab, 0); setTimeout(grab, 120);
  let done = false;
  const commit = () => {
    if(done) return; done = true; const s = ta.innerText.replace(/\n+$/, '').slice(0, 300); ta.remove();
    if(existing){ snapshot(); if(s) existing.s = s; else step().items = items().filter(i => i !== existing); }
    else if(s){ snapshot(); items().push({ id: uid(), t: 'text', p, s, c: S.color, size: 24 }); }
    draw(); dirty();
  };
  ta.addEventListener('blur', () => { if(Date.now() - born < 350 && !done && !ta._end){ setTimeout(grab, 0); return; } commit(); });
  ta.addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Escape'){ ta._end = true; ta.textContent = existing ? existing.s : ''; ta.blur(); } if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ta._end = true; ta.blur(); } });
}

/* ---------- klávesnice ---------- */
const KEYMAP = { v: 'select', h: 'pan', p: 'pen', a: 'arrow', l: 'line', d: 'dash', r: 'rect', c: 'circle', t: 'text', e: 'eraser', '1': 'T', '2': 'CT', '3': 'smoke', '4': 'flash', '5': 'molly', '6': 'he' };
document.addEventListener('keydown', e => {
  if(e.target.closest && e.target.closest('input, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if(e.ctrlKey || e.metaKey){
    if(k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); }
    else if(k === 'y' || (k === 'z' && e.shiftKey)){ e.preventDefault(); redo(); }
    else if(k === 's'){ e.preventDefault(); saveFile(); }
    else if(k === 'o'){ e.preventDefault(); openFile(); }
    else if(k === 'e'){ e.preventDefault(); exportPng(); }
    else if(k === 'n'){ e.preventDefault(); newBoard(); }
    else if(k === 'd' && S.sel){ e.preventDefault(); const it = items().find(i => i.id === S.sel); if(it){ snapshot(); const c = JSON.parse(JSON.stringify(it)); c.id = uid(); moveItem(c, 20, 20); items().push(c); S.sel = c.id; draw(); } }
    return;
  }
  if(e.key === ' '){ if(!spaceDown){ spaceDown = true; stage.classList.add('pan'); } e.preventDefault(); return; }
  if((e.key === 'Delete' || e.key === 'Backspace') && S.sel){ snapshot(); step().items = items().filter(i => i.id !== S.sel); S.sel = null; draw(); return; }
  if(e.key === 'Escape'){ S.sel = null; draw(); return; }
  if(e.key === 'ArrowRight'){ goStep(board().step + 1); return; }
  if(e.key === 'ArrowLeft'){ goStep(board().step - 1); return; }
  if(k === '0'){ fit(); return; }
  if(k === '+' || k === '='){ zoomBy(1.2); return; }
  if(k === '-'){ zoomBy(1 / 1.2); return; }
  if(KEYMAP[k]) setTool(KEYMAP[k]);
});
document.addEventListener('keyup', e => { if(e.key === ' '){ spaceDown = false; if(S.tool !== 'pan') stage.classList.remove('pan'); } });

/* ---------- UI ---------- */
function svg(name){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`; }
const HINTS = { select: 'Klikni a táhni pro přesun · Delete smaže · Ctrl+D duplikuje', pan: 'Táhni pro posun mapy · kolečko = zoom', pen: 'Kresli volně · pravé tlačítko smaže prvek', arrow: 'Táhni pro šipku · Shift = rovně po 45°', line: 'Táhni pro čáru · Shift = rovně', dash: 'Přerušovaná šipka – rotace, lurk', rect: 'Táhni pro oblast · Shift = čtverec', circle: 'Táhni od středu', text: 'Klikni a piš · Enter potvrdí · dvojklik na text = úprava', eraser: 'Táhni přes prvky, které chceš smazat', T: 'Klikni pro hráče T (čísluje se samo) · dvojklik = jméno', CT: 'Klikni pro hráče CT · dvojklik = jméno', smoke: 'Klikni, kam padne smoke', flash: 'Klikni, kam padne flash', molly: 'Klikni, kam padne molotov', he: 'Klikni, kam padne HE' };
function setTool(t){
  S.tool = t; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  stage.classList.toggle('pan', t === 'pan'); $('hint').textContent = HINTS[t] || '';
  cv.style.cursor = t === 'pan' ? '' : t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  syncSide();
}
function buildUI(){
  $('tools').innerHTML = TOOLS.map(t => t ? `<button class="tool" data-t="${t[0]}" title="${t[1]} (${t[2]})" aria-label="${t[1]}">${svg(t[0])}<span class="k">${t[2]}</span></button>` : '<hr>').join('');
  $('tools').querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.t)));
  $('colors').innerHTML = COLORS.map(c => `<button style="--c:${c}" data-c="${c}" title="${c}" aria-label="Barva ${c}"></button>`).join('');
  $('colors').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.color = b.dataset.c; const it = S.sel && items().find(i => i.id === S.sel); if(it && it.c){ snapshot(); it.c = S.color; draw(); } syncSide(); if(['select', 'eraser', 'pan', 'T', 'CT'].includes(S.tool) || UTILS[S.tool]) setTool('pen'); }));
  $('widths').innerHTML = WIDTHS.map(w => `<button data-w="${w}" title="Tloušťka ${w}"><i style="height:${Math.max(2, w * 0.9)}px"></i></button>`).join('');
  $('widths').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.width = +b.dataset.w; const it = S.sel && items().find(i => i.id === S.sel); if(it && it.w){ snapshot(); it.w = S.width; draw(); } syncSide(); }));
  ['T', 'CT'].forEach(side => {
    $('toks' + side).innerHTML = [1, 2, 3, 4, 5].map(n => `<button data-n="${n}" title="${side} hráč ${n}"><i style="background:${SIDE_C[side]}">${n}</i></button>`).join('');
    $('toks' + side).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.tok = { side, n: +b.dataset.n, manual: true }; setTool(side); }));
  });
  $('utils').innerHTML = Object.entries(UTILS).map(([k, u]) => `<button data-k="${k}" style="color:${u.c}">${svg(k)}<span style="color:var(--ink)">${u.l}</span></button>`).join('');
  $('utils').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.k)));
  $('maps').innerHTML = MAPS.map(m => `<button data-m="${m}" role="tab">${m}</button>`).join('');
  $('maps').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { S.map = b.dataset.m; S.sel = null; syncMaps(); renderSteps(); updateBgNote(); draw(); dirty(); }));
}
function syncSide(){
  document.querySelectorAll('#colors button').forEach(b => b.classList.toggle('on', b.dataset.c === S.color));
  document.querySelectorAll('#widths button').forEach(b => b.classList.toggle('on', +b.dataset.w === S.width));
  ['T', 'CT'].forEach(side => document.querySelectorAll('#toks' + side + ' button').forEach(b => b.classList.toggle('on', S.tool === side && S.tok.manual && S.tok.side === side && +b.dataset.n === S.tok.n)));
  document.querySelectorAll('#utils button').forEach(b => b.classList.toggle('on', S.tool === b.dataset.k));
}
function syncMaps(){ document.querySelectorAll('#maps button').forEach(b => b.classList.toggle('on', b.dataset.m === S.map)); }

/* ---------- kroky ---------- */
function renderSteps(){
  const b = board();
  $('stlist').innerHTML = b.steps.map((s, i) => `<div class="st${i === b.step ? ' on' : ''}" data-i="${i}" title="Dvojklik = přejmenovat"><b>${i + 1}</b><span>${esc(s.name)}</span>${b.steps.length > 1 ? `<button class="x" data-x="${i}" title="Smazat krok" aria-label="Smazat krok">✕</button>` : ''}</div>`).join('');
  $('stlist').querySelectorAll('.st').forEach(el => {
    el.addEventListener('click', e => { if(e.target.dataset.x !== undefined){ if(confirm('Smazat krok „' + b.steps[+e.target.dataset.x].name + '“?')){ b.steps.splice(+e.target.dataset.x, 1); b.step = Math.min(b.step, b.steps.length - 1); renderSteps(); draw(); dirty(); } return; } goStep(+el.dataset.i); });
    el.addEventListener('dblclick', () => {
      const i = +el.dataset.i, sp = el.querySelector('span'), inp = document.createElement('input'); inp.value = b.steps[i].name; sp.replaceWith(inp); inp.focus(); inp.select();
      const ok = () => { b.steps[i].name = inp.value.trim().slice(0, 30) || ('Krok ' + (i + 1)); renderSteps(); dirty(); };
      inp.addEventListener('blur', ok); inp.addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Enter') inp.blur(); });
    });
  });
}
function goStep(i){ const b = board(); if(i < 0 || i >= b.steps.length) return; b.step = i; S.sel = null; renderSteps(); draw(); dirty(); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------- soubory ---------- */
function stratJson(){ return JSON.stringify({ app: 'freezers-board', v: 1, map: S.map, steps: board().steps, saved: new Date().toISOString() }, null, 1); }
function slug(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, ''); }
async function saveFile(){
  const name = `freezers-${slug(S.map)}-${slug(step().name || 'strat')}.fzboard`;
  try{
    if(NATIVE){
      const p = await Neutralino.os.showSaveDialog('Uložit strategii', { defaultPath: name, filters: [{ name: 'Freezers Board', extensions: ['fzboard'] }] });
      if(!p) return; await Neutralino.filesystem.writeFile(/\.fzboard$/i.test(p) ? p : p + '.fzboard', stratJson()); toast('Uloženo');
    }else download(new Blob([stratJson()], { type: 'application/json' }), name);
  }catch(e){ toast('Uložení se nepovedlo: ' + (e.message || e)); }
}
function applyStrat(txt){
  let d; try{ d = JSON.parse(txt); }catch(e){ return toast('Tohle není soubor Freezers Board'); }
  if(!d || !Array.isArray(d.steps)) return toast('Tohle není soubor Freezers Board');
  const m = MAPS.includes(d.map) ? d.map : 'Vlastní';
  S.boards[m] = { steps: d.steps.map(s => ({ name: String(s.name || 'Krok'), items: Array.isArray(s.items) ? s.items : [] })), step: 0 };
  S.map = m; S.sel = null; syncMaps(); renderSteps(); updateBgNote(); draw(); dirty(); toast('Otevřeno: ' + m);
}
async function openFile(){
  try{
    if(NATIVE){
      const r = await Neutralino.os.showOpenDialog('Otevřít strategii', { filters: [{ name: 'Freezers Board', extensions: ['fzboard', 'json'] }] });
      if(r && r[0]) applyStrat(await Neutralino.filesystem.readFile(r[0]));
    }else $('fileOpen').click();
  }catch(e){ toast('Otevření se nepovedlo'); }
}
$('fileOpen').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if(f) f.text().then(applyStrat); });
function pngCanvas(){
  const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d'); g.scale(2, 2);
  render(g, false);
  g.save(); g.fillStyle = 'rgba(11,13,18,.78)'; g.fillRect(0, SIZE - 46, SIZE, 46); g.fillStyle = '#2fe0c9'; g.font = '700 20px Chakra, ChakraX, sans-serif'; g.textBaseline = 'middle';
  g.fillText('FREEZERS', 18, SIZE - 23); g.fillStyle = '#fff'; g.font = '600 17px Inter, InterX, sans-serif'; g.fillText(`${S.map} · ${board().step + 1}. ${step().name}`, 128, SIZE - 23); g.restore();
  return c;
}
async function exportPng(){
  const c = pngCanvas(), name = `freezers-${slug(S.map)}-${board().step + 1}-${slug(step().name)}.png`;
  try{
    if(NATIVE){
      const p = await Neutralino.os.showSaveDialog('Uložit obrázek', { defaultPath: name, filters: [{ name: 'PNG', extensions: ['png'] }] });
      if(!p) return; const blob = await new Promise(r => c.toBlob(r, 'image/png')); await Neutralino.filesystem.writeBinaryFile(/\.png$/i.test(p) ? p : p + '.png', await blob.arrayBuffer()); toast('Obrázek uložen');
    }else c.toBlob(b => download(b, name), 'image/png');
  }catch(e){ toast(/tainted|insecure/i.test(String(e)) ? 'Obrázek nejde uložit kvůli radaru z jiné stránky – nahraj radar ze souboru' : 'Uložení se nepovedlo'); }
}
function download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function newBoard(){ if(items().length && !confirm('Začít novou strategii na ' + S.map + '? Současná se smaže (ulož si ji předem).')) return; S.boards[S.map] = { steps: [{ name: 'Setup', items: [] }], step: 0 }; S.sel = null; renderSteps(); draw(); dirty(); }

/* ---------- tlačítka ---------- */
$('btnNew').onclick = newBoard; $('btnOpen').onclick = openFile; $('btnSave').onclick = saveFile; $('btnPng').onclick = exportPng;
$('zIn').onclick = () => zoomBy(1.2); $('zOut').onclick = () => zoomBy(1 / 1.2); $('zFit').onclick = fit;
$('stPrev').onclick = () => goStep(board().step - 1); $('stNext').onclick = () => goStep(board().step + 1);
$('stAdd').onclick = () => { const b = board(); b.steps.splice(b.step + 1, 0, { name: 'Krok ' + (b.steps.length + 1), items: JSON.parse(JSON.stringify(items())).map(i => (i.id = uid(), i)) }); b.step++; renderSteps(); draw(); dirty(); toast('Nový krok – navazuje na předchozí'); };
$('btnClear').onclick = () => { if(!items().length) return; snapshot(); step().items = []; S.sel = null; draw(); toast('Krok vyčištěn · Ctrl+Z vrátí'); };
$('btnRadar').onclick = () => $('fileRadar').click();
$('fileRadar').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; fileToRadar(f); });
$('btnRadarDel').onclick = () => { try{ localStorage.removeItem(radarKey(S.map)); }catch(e){} delete bgCache[S.map]; draw(); updateBgNote(); toast('Výchozí podklad'); };
let onTop = false, mini = false;
$('btnTop').onclick = async () => { onTop = !onTop; $('btnTop').classList.toggle('on', onTop); if(NATIVE){ try{ await Neutralino.window.setAlwaysOnTop(onTop); }catch(e){} } toast(onTop ? 'Okno zůstane navrchu i přes hru (hra v režimu okno bez okrajů)' : 'Navrchu vypnuto'); };
$('btnMini').onclick = async () => {
  mini = !mini; document.body.classList.toggle('mini', mini); $('btnMini').classList.toggle('on', mini);
  if(NATIVE){ try{ if(mini){ await Neutralino.window.setSize({ width: 560, height: 620 }); if(!onTop) $('btnTop').click(); } else await Neutralino.window.setSize({ width: 1360, height: 860 }); }catch(e){} }
  setTimeout(() => { resize(); fit(); }, 60);
};
/* přetažení obrázku radaru nebo souboru strategie */
['dragenter', 'dragover'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); if(ev === 'dragleave' && stage.contains(e.relatedTarget)) return; stage.classList.remove('dragging'); }));
stage.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if(!f) return; if(/\.(fzboard|json)$/i.test(f.name)) f.text().then(applyStrat); else fileToRadar(f); });

/* ---------- start ---------- */
loadLocal(); buildUI(); syncMaps(); renderSteps(); setTool('pen'); updateBgNote();
new ResizeObserver(() => { const first = !W; resize(); if(first) fit(); }).observe(stage);
if(document.fonts) document.fonts.ready.then(draw);
window.fzBoard = { S, items, applyStrat, stratJson };
})();
