(() => {
'use strict';
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]], TOTAL = 100, DARK = '#2f3e46', RED = '#e4572e';
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

let save = { max: 1 };
try { const s = JSON.parse(localStorage.getItem('arrowflow')); if (s && s.max) save = s; } catch (e) {}
const persist = () => { try { localStorage.setItem('arrowflow', JSON.stringify(save)); } catch (e) {} };

/* ---------- geração de níveis (sempre solucionáveis) ---------- */
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Dificuldade crescente: tabuleiro maior, setas mais longas e sinuosas, menos setas curtas "fáceis".
const config = l => { const w = Math.min(6 + Math.floor((l - 1) / 2.5), 18);
  return { w, h: Math.round(w * 1.4), maxLen: Math.min(4 + Math.floor(l * 0.5), 30),
    minLen: Math.min(2 + Math.floor(l / 12), 6), turn: Math.min(0.3 + l * 0.005, 0.55) }; };

// Cada cobra nova é "removida antes" das já existentes: o raio à frente da cabeça
// precisa estar livre no momento em que ela é criada -> ordem de remoção garantida.
function generate(l) {
  const { w, h, maxLen, minLen, turn } = config(l), r = rng(l * 7919 + 13);
  const occ = new Int16Array(w * h).fill(-1), snakes = [];
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const rayFree = cells => {
    const n = cells.length, [hx, hy] = cells[n - 1], [px, py] = cells[n - 2], dx = hx - px, dy = hy - py;
    for (let x = hx + dx, y = hy + dy; inb(x, y); x += dx, y += dy) {
      if (occ[y * w + x] !== -1) return false;
      if (cells.some(c => c[0] === x && c[1] === y)) return false;
    }
    return true;
  };
  const grow = (sx, sy, len) => {
    const cells = [[sx, sy]], used = new Set([sy * w + sx]); let d = DIRS[(r() * 4) | 0];
    while (cells.length < len) {
      const [x, y] = cells[cells.length - 1];
      const opts = DIRS.filter(([dx, dy]) => inb(x + dx, y + dy) && occ[(y + dy) * w + x + dx] === -1 && !used.has((y + dy) * w + x + dx));
      if (!opts.length) break;
      const st = opts.find(o => o[0] === d[0] && o[1] === d[1]);
      d = st && r() > turn ? st : opts[(r() * opts.length) | 0];
      cells.push([x + d[0], y + d[1]]); used.add((y + d[1]) * w + x + d[0]);
    }
    return cells;
  };
  let free = w * h, tries = w * h * 80; const total = tries;
  while (tries-- > 0 && free > 1) {
    const i = (r() * w * h) | 0; if (occ[i] !== -1) continue;
    let cells = grow(i % w, (i / w) | 0, minLen + ((r() * (maxLen - minLen + 1)) | 0));
    if (cells.length < (tries > total * 0.4 ? minLen : 2)) continue;
    if (!rayFree(cells)) { cells.reverse(); if (!rayFree(cells)) continue; }
    const id = snakes.length;
    cells.forEach(([x, y]) => occ[y * w + x] = id);
    free -= cells.length;
    snakes.push({ id, cells, state: 'idle' });
  }
  return { w, h, occ, snakes };
}

/* ---------- estado ---------- */
let G = null, W = 0, H = 0, dpr = 1, view = { s: 1, tx: 0, ty: 0 }, base = 1, raf = 0;
const diffOf = l => l <= 8 ? 'FÁCIL' : l <= 25 ? 'MÉDIO' : l <= 50 ? 'DIFÍCIL' : l <= 75 ? 'EXPERT' : 'MESTRE';

function startLevel(l) {
  const g = generate(l);
  G = { l, ...g, lives: 3, gone: 0, anims: [], over: false };
  $('title').textContent = 'Nível ' + l; $('diff').textContent = diffOf(l);
  $('hearts').innerHTML = HEART + HEART + HEART;
  $('barFill').style.width = '0';
  $('overlay').classList.add('hidden'); $('levels').classList.add('hidden');
  fit(); draw();
}
function updateHearts(hit) {
  [...$('hearts').children].forEach((el, i) => {
    el.classList.toggle('lost', i >= G.lives);
    if (hit && i === G.lives) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
  });
}
function overlay(title, text, btn, fn) {
  $('ovTitle').textContent = title; $('ovText').textContent = text; $('ovBtn').textContent = btn;
  $('ovBtn').onclick = fn; $('overlay').classList.remove('hidden');
}

/* ---------- tela / câmera ---------- */
function resize() {
  dpr = window.devicePixelRatio || 1; W = stage.clientWidth; H = stage.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; fit(); draw();
}
function fit() {
  if (!G) return;
  base = Math.min((W - 24) / G.w, (H - 24) / G.h);
  view = { s: base, tx: (W - G.w * base) / 2, ty: (H - G.h * base) / 2 };
}
function zoomAt(px, py, ns) {
  ns = Math.max(base * 0.7, Math.min(base * 6, ns));
  const wx = (px - view.tx) / view.s, wy = (py - view.ty) / view.s;
  view.tx = px - wx * ns; view.ty = py - wy * ns; view.s = ns;
}

/* ---------- desenho ---------- */
function arrow(x, y, dx, dy, color) {
  const bx = x - dx * 0.04, by = y - dy * 0.04, px = -dy * 0.21, py = dx * 0.21;
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x + dx * 0.34, y + dy * 0.34); ctx.lineTo(bx + px, by + py); ctx.lineTo(bx - px, by - py);
  ctx.closePath(); ctx.fill();
}
function poly(pts, color) {
  ctx.strokeStyle = color; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
}
const centers = cells => cells.map(c => [c[0] + 0.5, c[1] + 0.5]);
function at(ext, u) {
  const i = Math.max(0, Math.min(Math.floor(u), ext.length - 2)), f = u - i;
  return [ext[i][0] + (ext[i + 1][0] - ext[i][0]) * f, ext[i][1] + (ext[i + 1][1] - ext[i][1]) * f];
}
function drawMoving(a) {
  const n = a.s.cells.length, u0 = a.off, u1 = a.off + n - 1, pts = [at(a.ext, u0)];
  for (let k = Math.ceil(u0 + 1e-6); k < u1 - 1e-6; k++) pts.push(a.ext[k]);
  pts.push(at(a.ext, u1));
  const i = Math.max(0, Math.min(Math.floor(u1 - 1e-6), a.ext.length - 2));
  const dx = a.ext[i + 1][0] - a.ext[i][0], dy = a.ext[i + 1][1] - a.ext[i][1], hd = pts[pts.length - 1];
  if (a.kind === 'bounce') { poly(pts, RED); arrow(hd[0], hd[1], dx, dy, RED); return; }
  const m = pts.length - 1;
  for (let k = 0; k < m; k++) {
    ctx.strokeStyle = `hsl(${300 - (k / Math.max(1, m - 1)) * 110},85%,55%)`;
    ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k + 1][0], pts[k + 1][1]); ctx.stroke();
  }
  arrow(hd[0], hd[1], dx, dy, 'hsl(190,85%,55%)');
}
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  if (!G) return;
  ctx.translate(view.tx, view.ty); ctx.scale(view.s, view.s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 0.13;
  ctx.fillStyle = 'rgba(60,90,90,.28)';
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.occ[y * G.w + x] === -1) {
    ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.045, 0, 7); ctx.fill();
  }
  for (const s of G.snakes) if (s.state === 'idle') {
    const p = centers(s.cells), n = p.length, d = [p[n - 1][0] - p[n - 2][0], p[n - 1][1] - p[n - 2][1]];
    poly(p, DARK); arrow(p[n - 1][0], p[n - 1][1], d[0], d[1], DARK);
  }
  for (const a of G.anims) drawMoving(a);
}
function step(now) {
  for (const a of [...G.anims]) {
    const p = Math.min(1, (now - a.t0) / a.dur);
    a.off = a.kind === 'exit' ? a.max * p * (0.45 + 0.55 * p) : a.max * Math.sin(Math.PI * p);
    if (p >= 1) { G.anims.splice(G.anims.indexOf(a), 1); a.done(); }
  }
}
function loop(now) { raf = 0; step(now); draw(); if (G.anims.length) raf = requestAnimationFrame(loop); }
const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

/* ---------- jogada ---------- */
function play(s) {
  const n = s.cells.length, [hx, hy] = s.cells[n - 1], [px, py] = s.cells[n - 2], dx = hx - px, dy = hy - py;
  let x = hx + dx, y = hy + dy, free = 0;
  while (x >= 0 && y >= 0 && x < G.w && y < G.h && G.occ[y * G.w + x] === -1) { free++; x += dx; y += dy; }
  const blocked = x >= 0 && y >= 0 && x < G.w && y < G.h;
  const ext = centers(s.cells), len = blocked ? free + 1 : free + n + 3;
  for (let k = 1; k <= len; k++) ext.push([hx + 0.5 + dx * k, hy + 0.5 + dy * k]);
  if (!blocked) {
    s.cells.forEach(([cx, cy]) => G.occ[cy * G.w + cx] = -1);
    s.state = 'moving';
    const max = free + n + 0.5;
    G.anims.push({ s, ext, kind: 'exit', max, off: 0, t0: performance.now(), dur: max / 26 * 1000, done() {
      s.state = 'gone'; G.gone++;
      $('barFill').style.width = (G.gone / G.snakes.length * 100) + '%';
      if (G.gone === G.snakes.length) {
        save.max = Math.max(save.max, Math.min(TOTAL, G.l + 1)); persist();
        setTimeout(() => overlay('Nível concluído!', 'Você liberou todas as setas.', G.l < TOTAL ? 'Próximo nível' : 'Jogar de novo', () => startLevel(G.l < TOTAL ? G.l + 1 : 1)), 350);
      }
    } });
  } else {
    s.state = 'bounce'; G.lives--; updateHearts(true);
    if (navigator.vibrate) navigator.vibrate(60);
    if (G.lives <= 0) G.over = true;
    G.anims.push({ s, ext, kind: 'bounce', max: free + 0.3, off: 0, t0: performance.now(), dur: 420, done() {
      s.state = 'idle';
      if (G.over) setTimeout(() => overlay('Sem vidas!', 'Tente novamente este nível.', 'Tentar de novo', () => startLevel(G.l)), 200);
    } });
  }
  kick();
}
function tap(px, py) {
  if (!G || G.over) return;
  const wx = (px - view.tx) / view.s, wy = (py - view.ty) / view.s;
  let best = null, bd = 0.5;
  for (const s of G.snakes) if (s.state === 'idle') {
    const p = centers(s.cells);
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1], vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((wx - ax) * vx + (wy - ay) * vy) / (vx * vx + vy * vy)));
      const d = Math.hypot(wx - ax - vx * t, wy - ay - vy * t);
      if (d < bd) { bd = d; best = s; }
    }
  }
  if (best) play(best);
}

/* ---------- entrada: toque, arrastar, pinça, roda do mouse ---------- */
const ptrs = new Map(); let tapInfo = null, pinch = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (ptrs.size === 1) tapInfo = { x: e.offsetX, y: e.offsetY, moved: false };
  else { tapInfo = null; const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const nx = e.offsetX, ny = e.offsetY;
  if (ptrs.size === 1 && tapInfo) {
    if (!tapInfo.moved && Math.hypot(nx - tapInfo.x, ny - tapInfo.y) > 8) tapInfo.moved = true;
    if (tapInfo.moved) { view.tx += nx - p.x; view.ty += ny - p.y; }
  }
  p.x = nx; p.y = ny;
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    zoomAt(mx, my, view.s * d / pinch.d); view.tx += mx - pinch.mx; view.ty += my - pinch.my;
    pinch = { d, mx, my };
  }
  draw();
});
const release = (e, ok) => {
  if (ok && ptrs.size === 1 && tapInfo && !tapInfo.moved) tap(e.offsetX, e.offsetY);
  ptrs.delete(e.pointerId); tapInfo = null; pinch = null;
};
cv.addEventListener('pointerup', e => release(e, true));
cv.addEventListener('pointercancel', e => release(e, false));
cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, view.s * Math.exp(-e.deltaY * 0.0015)); draw(); }, { passive: false });

/* ---------- menus ---------- */
function openLevels() {
  const g = $('lvGrid'); g.innerHTML = '';
  for (let i = 1; i <= TOTAL; i++) {
    const b = document.createElement('button'); b.textContent = i; b.disabled = i > save.max;
    if (G && i === G.l) b.className = 'cur';
    b.onclick = () => startLevel(i); g.appendChild(b);
  }
  $('levels').classList.remove('hidden');
}
$('btnBack').onclick = openLevels;
$('btnRestart').onclick = () => startLevel(G.l);
$('lvClose').onclick = () => $('levels').classList.add('hidden');
$('ovLevels').onclick = () => { $('overlay').classList.add('hidden'); openLevels(); };
new ResizeObserver(resize).observe(stage);
G = null; resize(); startLevel(Math.min(save.max, TOTAL));
})();
