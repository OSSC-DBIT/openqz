/* The 15-second OpenQZ film: every frame from the time alone (see film.html). */
// ---------------------------------------------------------------- time and easing

const CX = 960, CY = 540;
const COL = { plum: '#3b142a', cream: '#f3efda', pink: '#d6177f', white: '#ffffff', black: '#000000' };
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, p) => a + (b - a) * p;
const E = {
  lin: (p) => p,
  // exponential ease out: fast start, long soft landing
  out: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  inOut: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
  // critically damped spring: no overshoot, no bounce
  spr: (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const w = 7;
    return (1 - (1 + w * p) * Math.exp(-w * p)) / (1 - (1 + w) * Math.exp(-w));
  },
};
/** Keyframes [[time, value, ease]]: each ease shapes the segment that ends at its key. */
function K(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t < t1) return lerp(v0, v1, E[e || 'out']((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}
const prog = (t, start, dur, e = 'out') => E[e](clamp((t - start) / dur));

// ---------------------------------------------------------------- building blocks

const stage = document.getElementById('stage');
function mk(cls, parent = stage, html = '') {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  parent.appendChild(d);
  return d;
}
const px = (v) => (Array.isArray(v) ? v.map((x) => `${x}px`).join(' ') : `${v}px`);
/** Size and place an element by its centre. */
function box(d, x, y, w, h, o = {}) {
  d.style.width = `${w}px`;
  d.style.height = `${h}px`;
  d.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(${o.sx ?? o.sc ?? 1}, ${o.sy ?? o.sc ?? 1}) ${o.extra ?? ''}`;
  if (o.r !== undefined) d.style.borderRadius = px(o.r);
}
const vis = (d, on) => (d.style.display = on ? '' : 'none');
const LOGO = `<svg viewBox="0 0 64 64" width="100%" height="100%"><circle cx="28" cy="28" r="14" fill="none" stroke="#fff" stroke-width="6.5"/><path d="M38.5 38.5l11 11" stroke="#fff" stroke-width="7" stroke-linecap="round"/></svg>`;
const cv = document.createElement('canvas').getContext('2d');
function tw(text, size, weight = 900, ls = 0) {
  cv.font = `${weight} ${size}px DMS`;
  return cv.measureText(text).width + ls * Math.max(0, text.length - 1);
}
function letters(parent, text) {
  return [...text].map((ch) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? ' ' : ch;
    parent.appendChild(s);
    return s;
  });
}
/** Letters inflate up into place (weight 250 to 900) and leave upwards on the next beat. */
function inflate(spans, t, tIn, tOut, step = 0.028) {
  spans.forEach((s, j) => {
    const p = E.spr(clamp((t - tIn - j * step) / 0.42));
    const q = tOut == null ? 0 : prog(t, tOut + j * 0.012, 0.22);
    s.style.transform = `translateY(${(1 - p) * 115 - q * 135}%) scale(${0.72 + 0.28 * p})`;
    s.style.fontWeight = String(Math.round(250 + 650 * p));
  });
}
/** A text that rises out of its own mask, and leaves upwards. */
function riseText(mask, inner, t, tIn, tOut) {
  const p = E.spr(clamp((t - tIn) / 0.4));
  const q = tOut == null ? 0 : prog(t, tOut, 0.24);
  inner.style.transform = `translateY(${(1 - p) * 105 - q * 110}%)`;
  vis(mask, t >= tIn - 0.02 && (tOut == null || t < tOut + 0.3));
}

// ---------------------------------------------------------------- 1, 2: the tile, the pill and the words

const S = mk('abs');
S.style.overflow = 'hidden';
const S1 = mk('fill', S);
const S2 = mk('fill', S);
const SL = mk('abs', S, LOGO);
const WORDS = [
  ['TEACH.', 2.0, 'plum'],
  ['TEST.', 2.5, 'white'],
  ['PLAY.', 3.0, 'plum'],
  ['KNOW.', 3.5, 'white'],
];
const WFS = 160;
const words = WORDS.map(([w]) => {
  const row = mk('row', S);
  row.style.fontSize = `${WFS}px`;
  row.style.letterSpacing = '-4px';
  return { row, spans: letters(row, w) };
});
const SWEEPS = [
  [1.5, 'pink', 'cream'],
  [2.5, 'cream', 'pink'],
  [3.0, 'pink', 'cream'],
  [3.5, 'cream', 'pink'],
];
function sweep(t, list, base) {
  let from = base, to = base, p = 1;
  for (const [ts, a, b] of list) if (t >= ts) [from, to, p] = [a, b, prog(t, ts, 0.32)];
  return { from, to, p };
}
let WW = [];

function renderS(t) {
  const end = t >= 14.5;
  vis(S, t < 4.12 || end);
  if (!(t < 4.12 || end)) return;
  let w, h, r, sc, logo, c;
  if (!end) {
    const [WT, WS, WP, WK] = WW;
    w = K(t, [[0, 200], [0.5, 200, 'lin'], [0.88, 140], [1.0, 140, 'lin'], [1.4, 780], [1.5, 780, 'lin'], [1.88, WT], [2.5, WT, 'lin'], [2.85, WS], [3.0, WS, 'lin'], [3.35, WP], [3.5, WP, 'lin'], [3.85, WK]]);
    h = K(t, [[0, 200], [0.5, 200, 'lin'], [0.88, 140], [1.0, 140, 'lin'], [1.4, 200], [1.5, 200, 'lin'], [1.88, 240]]);
    r = K(t, [[0, 48], [0.5, 48, 'lin'], [0.88, 70], [1.0, 70, 'lin'], [1.4, 100], [1.5, 100, 'lin'], [1.88, 48]]);
    sc = K(t, [[0, 1], [0.1, 0.86], [0.48, 1, 'spr']]);
    logo = K(t, [[0.5, 1], [0.8, 0]]);
    c = sweep(t, SWEEPS, 'pink');
  } else {
    // the end: the wordmark folds back into the tile of the first frame
    w = h = 200;
    r = 48;
    sc = K(t, [[14.55, 0], [14.95, 1]]);
    logo = K(t, [[14.62, 0], [14.98, 1]]);
    c = { from: 'pink', to: 'pink', p: 1 };
  }
  box(S, CX, CY, w, h, { sc, r });
  S1.style.background = COL[c.from];
  S2.style.background = COL[c.to];
  S2.style.clipPath = `inset(0 ${100 - 100 * c.p}% 0 0)`;
  const ls = 120 * logo;
  box(SL, w / 2, h / 2, Math.max(ls, 0.01), Math.max(ls, 0.01));
  vis(SL, logo > 0.001);
  words.forEach((wd, i) => {
    const tIn = WORDS[i][1];
    const tOut = i < 3 ? WORDS[i + 1][1] : 4.0;
    const on = !end && t >= tIn - 0.01 && t < tOut + 0.3;
    vis(wd.row, on);
    if (!on) return;
    wd.row.style.color = COL[WORDS[i][2]];
    inflate(wd.spans, t, tIn, tOut);
  });
}

// ---------------------------------------------------------------- 3: answer tiles

const TCOL = ['pink', 'cream', 'white', 'black'];
const TTEXT = ['white', 'plum', 'plum', 'cream'];
const TRING = ['pink', 'cream', 'white', 'cream'];
const tiles = [0, 1, 2, 3].map((i) => {
  const o = mk('abs');
  o.style.overflow = 'hidden';
  const ring = mk('fill', o);
  ring.style.border = `10px solid ${COL[TRING[i]]}`;
  ring.style.boxSizing = 'border-box';
  const f = mk('fill', o);
  const f2 = mk('fill', o);
  const lab = mk('row', o);
  lab.style.fontSize = '110px';
  lab.style.color = COL[TTEXT[i]];
  const spans = letters(lab, 'ABCD'[i]);
  return { o, ring, f, f2, spans };
});
const chk = mk('fill', tiles[1].o, `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M27 53 L44 69 L75 34" fill="none" stroke="#3b142a" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>`);
const chkPath = chk.querySelector('path');

function renderTiles(t) {
  const on = t >= 4.12 && t < 6.5;
  tiles.forEach((T) => vis(T.o, on));
  if (!on) return;
  const WK = WW[3];
  const p1 = prog(t, 4.12, 0.34);
  const p2 = prog(t, 4.5, 0.38);
  const pk = E.spr(clamp((t - 5.5) / 0.38));
  const p3 = prog(t, 6.0, 0.42);
  tiles.forEach((T, i) => {
    let x, y = CY, w, h, r;
    if (t < 4.5) {
      vis(T.o, i < 2);
      const side = i === 0 ? -1 : 1;
      x = lerp(CX + (side * WK) / 4, CX + side * 120, p1);
      w = lerp(WK / 2, 220, p1);
      h = lerp(240, 220, p1);
      const ro = lerp(48, 44, p1), ri = lerp(0, 44, p1);
      r = i === 0 ? [ro, ri, ri, ro] : [ri, ro, ro, ri];
    } else {
      const from = [CX - 175, CX - 65, CX + 65, CX + 175][i];
      const to = CX + (i - 1.5) * 240;
      x = lerp(from, to, p2);
      w = lerp(110, 200, p2);
      h = lerp(220, 200, p2);
      const ro = lerp(44, 40, p2), ri = lerp(0, 40, p2);
      r = i % 2 === 0 ? [ro, ri, ri, ro] : [ri, ro, ro, ri];
      if (t >= 6.0) {
        const qx = CX + (i % 2 ? 105 : -105), qy = CY + (i < 2 ? -105 : 105);
        x = lerp(to, qx, p3);
        y = lerp(CY, qy, p3);
        w = h = lerp(200, 210, p3);
        const keep = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]][i];
        r = keep.map((k) => lerp(40, k * 40, p3));
      }
    }
    const pickScale = i === 1 ? 1 + 0.14 * pk : 1 - 0.16 * pk;
    const sc = lerp(pickScale, 1, p3);
    box(T.o, x, y, w, h, { sc, r });
    [T.ring, T.f, T.f2].forEach((d) => (d.style.borderRadius = px(r)));
    // the colours arrive with a sweep on beat 10
    const cp = prog(t, 5.0, 0.3);
    T.f.style.background = COL.pink;
    T.f2.style.background = COL[TCOL[i]];
    T.f2.style.clipPath = `inset(0 ${100 - 100 * cp}% 0 0)`;
    // the tiles that were not picked empty down to an outline
    const inset = i === 1 ? 0 : lerp(pk * (Math.min(w, h) / 2 - 10), 0, p3);
    const clip = inset > 0.5 ? `inset(${inset}px round ${Math.max(4, 40 - inset)}px)` : 'none';
    T.f.style.clipPath = clip;
    if (inset > 0.5) T.f2.style.clipPath = clip;
    vis(T.ring, inset > 0.5);
    // labels A to D inflate in, and shrink away when the tiles gather
    inflate(T.spans, t, 5.0 + i * 0.05, null);
    const lq = i === 1 ? Math.max(prog(t, 5.5, 0.18), prog(t, 6.0, 0.25)) : prog(t, 6.0, 0.25);
    T.spans[0].style.transform += ` scale(${Math.max(1 - lq, 0.0001)})`;
    T.spans[0].style.color = i !== 1 && inset > (Math.min(w, h) / 2 - 10) * 0.45 ? COL[TRING[i]] : COL[TTEXT[i]];
  });
  chkPath.setAttribute('stroke-dashoffset', String(1 - prog(t, 5.6, 0.3) + prog(t, 6.0, 0.2)));
}

// ---------------------------------------------------------------- 4: 2D to 3D

const cam = mk('abs');
cam.style.cssText += 'width:1920px;height:1080px;perspective:2200px;perspective-origin:960px 540px;';
const cube = mk('abs', cam);
cube.style.cssText += `width:420px;height:420px;left:${CX - 210}px;top:${CY - 210}px;transform-style:preserve-3d;`;
const FACES = {
  front: ['translateZ(210px)', [0, 0, 1]],
  back: ['rotateY(180deg) translateZ(210px)', [0, 0, -1]],
  right: ['rotateY(90deg) translateZ(210px)', [1, 0, 0]],
  left: ['rotateY(-90deg) translateZ(210px)', [-1, 0, 0]],
  top: ['rotateX(90deg) translateZ(210px)', [0, -1, 0]],
  bottom: ['rotateX(-90deg) translateZ(210px)', [0, 1, 0]],
};
const faces = {};
for (const [name, [tf, n]] of Object.entries(FACES)) {
  const f = mk('face', cube);
  f.style.transform = tf;
  f.style.borderRadius = '40px';
  f.style.background = COL.cream;
  faces[name] = { f, n, shade: null };
}
// front: the four answer tiles, gathered
faces.front.f.style.background = 'transparent';
faces.front.f.style.borderRadius = '0';
[[0, 0, 'pink', '40px 0 0 0'], [210, 0, 'cream', '0 40px 0 0'], [0, 210, 'white', '0 0 0 40px'], [210, 210, 'black', '0 0 40px 0']].forEach(([x, y, c, r]) => {
  const q = mk('abs', faces.front.f);
  q.style.cssText += `left:${x}px;top:${y}px;width:210px;height:210px;background:${COL[c]};border-radius:${r};`;
});
// right: the logo; top: the report in miniature (it becomes the card)
faces.right.f.style.background = COL.pink;
const rl = mk('abs', faces.right.f, LOGO);
rl.style.cssText += 'left:120px;top:120px;width:180px;height:180px;';
faces.top.f.style.background = COL.white;
const V0 = [0.3, 0.45, 0.6, 0.38, 0.25];
const V1 = [0.42, 0.68, 0.95, 0.55, 0.32];
V0.forEach((v, i) => {
  const b = mk('abs', faces.top.f);
  const h = 420 * 0.5 * v;
  b.style.cssText += `left:${420 * (0.1 + i * 0.17)}px;top:${420 * 0.86 - h}px;width:${420 * 0.11}px;height:${h}px;background:${COL.pink};border-radius:8px 8px 0 0;`;
});
const fb = mk('abs', faces.top.f);
fb.style.cssText += `left:${420 * 0.08}px;top:${420 * 0.86}px;width:${420 * 0.84}px;height:3px;background:${COL.plum};`;
for (const F of Object.values(faces)) F.shade = mk('shade', F.f);

function rotN([x, y, z], ax, ay) {
  const a = (ay * Math.PI) / 180, b = (ax * Math.PI) / 180;
  const x1 = x * Math.cos(a) + z * Math.sin(a), z1 = -x * Math.sin(a) + z * Math.cos(a);
  return [x1, y * Math.cos(b) - z1 * Math.sin(b), y * Math.sin(b) + z1 * Math.cos(b)];
}
function renderCube(t) {
  const on = t >= 6.5 && t < 8.0;
  vis(cam, on);
  if (!on) return;
  const ax = K(t, [[6.5, 0], [6.95, -20], [7.5, -20, 'lin'], [7.95, -90, 'inOut']]);
  const ay = K(t, [[6.5, 0], [6.95, 35], [7.0, 35, 'lin'], [7.45, -55, 'inOut'], [7.5, -55, 'lin'], [7.95, 0, 'inOut']]);
  cube.style.transform = `translateZ(-210px) rotateX(${ax}deg) rotateY(${ay}deg)`;
  for (const F of Object.values(faces)) {
    const nz = rotN(F.n, ax, ay)[2];
    F.shade.style.opacity = String((1 - clamp(nz)) * 0.5);
  }
}

// ---------------------------------------------------------------- 5: the report

const cg = mk('abs');
cg.style.cssText += 'width:1920px;height:1080px;transform-origin:960px 540px;';
const card = mk('abs', cg);
card.style.background = COL.white;
const bars = V1.map(() => {
  const b = mk('abs', cg);
  b.style.background = COL.pink;
  const top = mk('fill', b);
  top.style.background = COL.plum;
  return { b, top };
});
const base = mk('abs', cg);
base.style.background = COL.plum;
const avgM = mk('mask', cg);
const avg = mk('abs', avgM);
avg.textContent = 'average marks';
avg.style.cssText += `font-size:40px;font-weight:600;color:${COL.plum};white-space:nowrap;line-height:1.2;`;
const ansM = mk('mask', cg);
const ans = mk('abs', ansM);
ans.textContent = 'answers';
ans.style.cssText += `font-size:36px;font-weight:600;color:${COL.plum};white-space:nowrap;line-height:1.2;`;
const tag = mk('abs ctr', cg);
tag.textContent = '28 got it';
tag.style.cssText += `background:${COL.plum};color:${COL.cream};font-size:30px;font-weight:700;border-radius:999px;white-space:nowrap;`;

/** Digits on rolling strips. Each state is a string of slots (space = empty slot). */
function makeRoller(parent, size, color, slotChars) {
  const root = mk('abs', parent);
  root.style.cssText += `font-size:${size}px;color:${color};white-space:nowrap;line-height:1;font-variant-numeric:tabular-nums;display:flex;`;
  const slots = slotChars.map((chars) => {
    const s = mk('slot', root);
    const strip = mk('strip', s);
    chars.forEach((ch) => (mk('', strip).textContent = ch === ' ' ? '' : ch));
    return { s, strip, chars };
  });
  return { root, slots, size };
}
const DIG = '0123456789'.split('');
const big = makeRoller(stage, 520, COL.pink, [DIG, DIG, DIG, [' ', '%', '+']]);
const BIG_STATES = window.CORE?.states ?? [
  [-1, '    '],
  [9.0, ' 67%'],
  [9.98, ' 10 '],
  [10.5, ' 50+'],
  [11.0, '100%'],
];
const small = makeRoller(cg, 92, COL.plum, [DIG, [','], DIG, DIG, DIG]);
let charW = {};

function slotWidth(ch, size) {
  return ch === ' ' ? 0 : (charW[ch] ?? charW['0']) * (size / 100);
}
function renderBig(t) {
  let i = 0;
  while (i + 1 < BIG_STATES.length && t >= BIG_STATES[i + 1][0]) i++;
  const prev = BIG_STATES[Math.max(0, i - 1)][1];
  const next = BIG_STATES[i][1];
  const p = i === 0 ? 1 : prog(t, BIG_STATES[i][0], 0.45);
  let total = 0;
  big.slots.forEach((sl, k) => {
    const a = prev[k], b = next[k];
    const w = lerp(slotWidth(a, 520), slotWidth(b, 520), p);
    total += w;
    sl.s.style.width = `${w}px`;
    const idx = (ch) => Math.max(0, sl.chars.indexOf(ch === ' ' ? (sl.chars === DIG ? '0' : ' ') : ch));
    sl.strip.style.transform = `translateY(${-lerp(idx(a), idx(b), p)}em)`;
  });
  return total;
}

function renderCard(t) {
  const on = t >= 8.0 && t < 10.1;
  vis(cg, on);
  const fold = 1 - prog(t, 9.84, 0.16, 'inOut');
  cg.style.transform = `scaleY(${fold})`;
  const g = prog(t, 8.0, 0.45);
  const w = lerp(420, 1240, g), h = lerp(420, 660, g), r = lerp(40, 28, g);
  const left = CX - w / 2, top = CY - h / 2;
  box(card, CX, CY, w, h, { r });
  bars.forEach((B, i) => {
    const v = lerp(V0[i], V1[i], E.spr(clamp((t - 8.5 - i * 0.04) / 0.45)));
    const bh = h * 0.5 * v, bw = w * 0.11;
    const bx = left + w * (0.1 + i * 0.17) + bw / 2;
    box(B.b, bx, top + h * 0.86 - bh / 2, bw, bh, { r: [Math.min(12, bw / 4), Math.min(12, bw / 4), 0, 0] });
    B.top.style.clipPath = i === 2 ? `inset(${100 - 100 * prog(t, 9.5, 0.32)}% 0 0 0)` : 'inset(100% 0 0 0)';
  });
  box(base, CX, top + h * 0.86 + 1.5, w * 0.84, 3);
  // the counters of the card
  const s = 0.29;
  avgM.style.cssText += `left:${left + 70}px;top:${top + 70 + 520 * s + 18}px;width:400px;height:52px;`;
  riseText(avgM, avg, t, 9.06, null);
  if (!on) vis(avgM, false);
  const sv = 1000 * prog(t, 9.5, 0.32);
  const digits = [Math.floor(sv / 1000) % 10, null, (sv / 100) % 10, (sv / 10) % 10, sv % 10];
  digits.forEach((d, k) => {
    const sl = small.slots[k];
    sl.s.style.width = `${slotWidth(k === 1 ? ',' : '0', 92)}px`;
    if (d !== null) sl.strip.style.transform = `translateY(${-d}em)`;
  });
  const sw = small.slots.reduce((a, sl) => a + parseFloat(sl.s.style.width), 0);
  const sIn = E.spr(clamp((t - 9.5) / 0.35));
  small.root.style.transform = `translate(${left + w - 70 - sw}px, ${top + 70 + (1 - sIn) * 30}px)`;
  small.root.style.clipPath = `inset(0 0 ${100 - 100 * sIn}% 0)`;
  vis(small.root, t >= 9.5);
  ansM.style.cssText += `left:${left + w - 70 - 200}px;top:${top + 70 + 100}px;width:200px;height:48px;`;
  ans.style.left = 'auto';
  ans.style.right = '0';
  riseText(ansM, ans, t, 9.58, null);
  if (!on) vis(ansM, false);
  const tp = E.spr(clamp((t - 9.55) / 0.35));
  const b2x = left + w * (0.1 + 2 * 0.17) + (w * 0.11) / 2;
  const b2top = top + h * 0.86 - h * 0.5 * V1[2];
  box(tag, b2x, b2top - 44, 170, 54, { sc: Math.max(tp, 0.001) });
  vis(tag, t >= 9.55);
  return { left, top, w, h, s };
}

// ---------------------------------------------------------------- 6: the bold counter

const labelM = mk('mask');
const LABELS = window.CORE?.labels ?? [['developers', 10.14], ['hours of building', 10.5], ['open source', 11.0]];
const labels = LABELS.map(([text]) => {
  const d = mk('abs ctr', labelM);
  d.textContent = text;
  d.style.cssText += `width:100%;height:100%;font-size:76px;font-weight:700;color:${COL.cream};white-space:nowrap;`;
  return d;
});
const S3 = mk('abs');
S3.style.background = COL.pink;

function renderCounter(t, cardGeo) {
  vis(big.root, t >= 9.0 && t < 11.9);
  if (t >= 9.0 && t < 11.9) {
    const total = renderBig(t);
    const m = prog(t, 9.98, 0.42);
    const dfl = prog(t, 11.5, 0.3, 'out');
    const s = lerp(cardGeo ? cardGeo.s : 0.29, 1, m) * lerp(1, 0.04, dfl);
    const cardX = cardGeo ? cardGeo.left + 70 + (total * cardGeo.s) / 2 : CX;
    const cardY = cardGeo ? cardGeo.top + 70 + (520 * cardGeo.s) / 2 : CY;
    const x = lerp(cardX, CX, m), y = lerp(cardY, CY - 60, m);
    big.root.style.transform = `translate(${x - total / 2}px, ${y - 260}px) scale(${s})`;
    big.root.style.transformOrigin = `${total / 2}px 260px`;
    big.root.style.fontWeight = String(Math.round(lerp(900, 200, prog(t, 11.5, 0.3))));
  }
  labelM.style.cssText += `left:${CX - 500}px;top:${CY + 230}px;width:1000px;height:96px;`;
  vis(labelM, t >= 10.12 && t < 11.8);
  labels.forEach((d, i) => {
    const tIn = LABELS[i][1];
    const tOut = i < 2 ? LABELS[i + 1][1] : 11.5;
    const p = E.spr(clamp((t - tIn) / 0.4));
    const q = prog(t, tOut, 0.22);
    d.style.transform = `translateY(${(1 - p) * 105 - q * 110}%)`;
    vis(d, t >= tIn - 0.02 && t < tOut + 0.3);
  });
  const g = prog(t, 11.62, 0.34);
  vis(S3, t >= 11.62 && t < 12.0);
  box(S3, CX, CY, 150 * g + 0.01, 150 * g + 0.01, { r: 32 * g });
}

// ---------------------------------------------------------------- 7: the grid

const LET = { '1,0': 'O', '1,1': 'p', '1,2': 'e', '1,3': 'n', '2,1': 'Q', '2,2': 'Z' };
const ORDER = ['1,0', '1,1', '1,2', '1,3', '2,1', '2,2'];
const cells = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cells.push({ r, c });
// the centre pink cell last, so it is the one on top when all sixteen start as one
cells.sort((a, b) => (a.r === 1 && a.c === 1 ? 1 : b.r === 1 && b.c === 1 ? -1 : 0));
const grid = cells.map(({ r, c }) => {
  const o = mk('abs');
  const flip = mk('flip', o);
  const front = mk('side', flip);
  const back = mk('side', flip);
  back.style.transform = 'rotateY(180deg)';
  const key = `${r},${c}`;
  const first = (r + c) % 2 === 0 ? 'pink' : 'cream';
  back.style.background = COL[first === 'pink' ? 'cream' : 'pink'];
  return { r, c, key, o, flip, front, back, first, k: ORDER.indexOf(key) };
});

function renderGrid(t) {
  grid.forEach((G) => {
    const on = t >= 12.0 && t < 14.4;
    vis(G.o, on);
    if (!on) return;
    const d = Math.hypot(G.c - 1.5, G.r - 1.5);
    const sp = prog(t, 12.0 + (d - 0.707) * 0.05, 0.45);
    let x = lerp(CX, CX + (G.c - 1.5) * 166, sp);
    let y = lerp(CY, CY + (G.r - 1.5) * 166, sp);
    const a1 = 180 * prog(t, 12.5 + (G.r + G.c) * 0.045, 0.42, 'inOut');
    const a2 = 180 * prog(t, 13.0 + (6 - G.r - G.c) * 0.045, 0.42, 'inOut');
    G.flip.style.transform = `perspective(1400px) rotateY(${a1 + a2}deg)`;
    const letter = LET[G.key];
    if (a1 < 180) {
      G.front.style.background = COL[G.first];
      G.front.textContent = '';
    } else {
      G.front.style.background = letter ? (G.k < 4 ? COL.pink : COL.cream) : COL.black;
      G.front.style.color = G.k < 4 ? COL.cream : COL.pink;
      G.front.textContent = letter && t < 14.0 ? letter : '';
    }
    let sc = 1;
    if (letter) {
      const mx = prog(t, 13.5 + (G.k < 4 ? G.k : G.k - 4) * 0.02, 0.24);
      const my = prog(t, 13.72, 0.24);
      x = lerp(x, CX + (G.k - 2.5) * 166, mx);
      y = lerp(y, CY, my);
      sc = 1 - prog(t, 14.0 + G.k * 0.02, 0.3, 'inOut');
    } else {
      sc = 1 - prog(t, 13.42 + (2.12 - d) * 0.03, 0.2, 'inOut');
    }
    box(G.o, x, y, 150, 150, { sc: Math.max(sc, 0.0001) });
    vis(G.o, sc > 0.002);
  });
}

// ---------------------------------------------------------------- end title

const WM = ['O', 'p', 'e', 'n', 'Q', 'Z'];
const wm = WM.map((ch, k) => {
  const d = mk('abs ctr');
  d.textContent = ch;
  d.style.cssText += `font-size:200px;font-weight:900;color:${k < 4 ? COL.cream : COL.pink};`;
  return d;
});
const subM = mk('mask');
const sub = mk('abs ctr', subM);
sub.textContent = 'by OSSC DBIT';
sub.style.cssText += `width:100%;height:100%;font-size:46px;font-weight:600;color:${COL.cream};white-space:nowrap;`;
let WMX = [], WMW = [];

function renderTitle(t) {
  wm.forEach((d, k) => {
    const on = t >= 14.0 && t < 14.9;
    vis(d, on);
    if (!on) return;
    const m = prog(t, 14.0, 0.42);
    const c = prog(t, 14.5 + (2.5 - Math.abs(k - 2.5)) * 0.03, 0.32, 'inOut');
    const x = lerp(lerp(CX + (k - 2.5) * 166, WMX[k], m), CX, c);
    const y = lerp(lerp(CY, CY - 40, m), CY, c);
    const sc = lerp(0.55, 1, m) * (1 - c);
    box(d, x, y, WMW[k], 200, { sc: Math.max(sc, 0.0001) });
  });
  subM.style.cssText += `left:${CX - 400}px;top:${CY + 85}px;width:800px;height:64px;`;
  riseText(subM, sub, t, 14.14, 14.5);
  if (t < 14.1 || t >= 14.85) vis(subM, false);
}

// ---------------------------------------------------------------- seek

/** Everything the 15-second film draws, hidden (the long intro uses parts of it). */
function hideCore() {
  [S, cam, cg, big.root, labelM, S3, subM].forEach((d) => vis(d, false));
  tiles.forEach((T) => vis(T.o, false));
  grid.forEach((G) => vis(G.o, false));
  wm.forEach((d) => vis(d, false));
}
window.seekCore = (t) => {
  if (t < 0 || t > 15.001) return hideCore();
  renderS(t);
  renderTiles(t);
  renderCube(t);
  const geo = t >= 8.0 && t < 10.1 ? renderCard(t) : (vis(cg, false), null);
  renderCounter(t, geo ?? { left: CX - 620, top: CY - 330, w: 1240, h: 660, s: 0.29 });
  renderGrid(t);
  renderTitle(t);
};
window.seek = window.seekCore;

// ---------------------------------------------------------------- soundtrack (Web Audio, rendered offline)

window.renderAudio = async () => {
  const SR = 48000, DUR = 15, BEAT = 0.5;
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.82;
  master.connect(comp);

  const noiseBuf = ctx.createBuffer(1, SR * 2, SR);
  { const d = noiseBuf.getChannelData(0); let seed = 7; for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; } }
  function noise(t, dur) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.start(t); s.stop(t + dur); return s; }

  // room: a short hall made of decaying noise
  const verb = ctx.createConvolver();
  { const len = SR * 2.2, b = ctx.createBuffer(2, len, SR); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let seed = 11 + ch; for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 3.2); } } verb.buffer = b; }
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.32;
  const verbLP = ctx.createBiquadFilter();
  verbLP.type = 'lowpass';
  verbLP.frequency.value = 5200;
  verbIn.connect(verb); verb.connect(verbLP); verbLP.connect(master);

  // music bus, ducked by every kick (side-chain)
  const music = ctx.createGain();
  music.connect(master);
  music.connect(verbIn);
  for (let b = 0; b < 30; b++) {
    const t = b * BEAT;
    music.gain.setValueAtTime(0.28, t);
    music.gain.setTargetAtTime(1, t + 0.012, 0.075);
  }

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // kick: every beat
  for (let b = 0; b < 30; b++) {
    const t = b * BEAT;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.45);
    const n = noise(t, 0.012);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = ctx.createGain(); ng.gain.value = 0.25;
    n.connect(hp); hp.connect(ng); ng.connect(master);
  }

  // clap on the back beats
  for (let b = 1; b < 28; b += 2) {
    const t = b * BEAT;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    [0, 0.011, 0.022].forEach((d) => { g.gain.setValueAtTime(0.55, t + d); g.gain.exponentialRampToValueAtTime(0.06, t + d + 0.009); });
    g.gain.setValueAtTime(0.4, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    const n = noise(t, 0.25);
    n.connect(bp); bp.connect(g); g.connect(master); g.connect(verbIn);
  }

  // hats in sixteenths from bar 2, opening up in the last bar
  for (let s = 16; s < 112; s++) {
    const t = s * BEAT / 4;
    const pos = s % 4;
    const vel = pos === 2 ? 0.32 : pos === 0 ? 0.12 : 0.18;
    const open = pos === 2 && t >= 12 ? 0.14 : 0.035;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * (t >= 12 ? 1.25 : 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + open);
    const n = noise(t, open + 0.01);
    n.connect(hp); hp.connect(g); g.connect(master);
  }

  // harmony: Am  F  C  G, one chord per bar
  const PROG = [[45, [57, 60, 64]], [41, [53, 57, 60]], [48, [55, 60, 64]], [43, [55, 59, 62]]];
  for (let bar = 0; bar < 8; bar++) {
    const t0 = bar * 2;
    const [root, chord] = PROG[bar % 4];
    // pad: detuned saws through a soft filter
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.linearRampToValueAtTime(bar === 6 ? 3200 : 1700, t0 + 2);
    const pg = ctx.createGain();
    const len = bar === 7 ? 1.0 : 2.0;
    pg.gain.setValueAtTime(0.0001, t0);
    pg.gain.exponentialRampToValueAtTime(0.09, t0 + 0.08);
    pg.gain.setValueAtTime(0.09, t0 + len - 0.12);
    pg.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    lp.connect(pg); pg.connect(music);
    for (const n of chord) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
      o.connect(lp); o.start(t0); o.stop(t0 + len);
    }
    // bass: off-beat eighths from bar 2
    if (bar >= 1 && bar < 7) {
      for (let e = 0; e < 8; e++) {
        const t = t0 + e * BEAT / 2;
        if (e % 2 === 0) continue;
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(root - 12 + (e === 7 && bar % 2 ? 7 : 0));
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.2);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.23);
        o.connect(f); f.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.25);
        const sub = ctx.createOscillator(); sub.frequency.value = midi(root - 24);
        const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.32, t + 0.01); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        sub.connect(sg); sg.connect(master); sub.start(t); sub.stop(t + 0.25);
      }
    }
    // pluck: a sixteenth arpeggio from bar 3, an octave up
    if (bar >= 2 && bar < 7) {
      const tones = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24];
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * BEAT / 4;
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midi(tones[(s * 3) % 4]);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(s % 4 === 0 ? 0.11 : 0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g); g.connect(music); o.start(t); o.stop(t + 0.18);
      }
    }
  }

  // a hit on every scene change: a low boom, a noise crack and a chord stab
  for (const t of [2, 4, 6, 8, 10, 12, 14]) {
    const big = t === 12 || t === 14;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(big ? 0.9 : 0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 1.2 : 0.7));
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.3);
    const n = noise(t, 0.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(big ? 0.5 : 0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(lp); lp.connect(ng); ng.connect(master); ng.connect(verbIn);
    const [, chord] = PROG[Math.floor(t / 2) % 4];
    for (const nn of chord) {
      const s = ctx.createOscillator(); s.type = 'square'; s.frequency.value = midi(nn + 12);
      const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2600;
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.05, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      s.connect(sf); sf.connect(sg); sg.connect(master); sg.connect(verbIn); s.start(t); s.stop(t + 0.4);
    }
  }

  // riser into the last full bar (10 s to 12 s): filtered noise opening up, a rising tone,
  // and a snare roll that doubles its speed
  {
    const n = noise(10, 2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(350, 10); bp.frequency.exponentialRampToValueAtTime(7000, 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, 10); g.gain.exponentialRampToValueAtTime(0.42, 11.98); g.gain.setValueAtTime(0.0001, 12);
    n.connect(bp); bp.connect(g); g.connect(master); g.connect(verbIn);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, 10); o.frequency.exponentialRampToValueAtTime(880, 12);
    const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.setValueAtTime(600, 10); of.frequency.exponentialRampToValueAtTime(5000, 12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, 10); og.gain.exponentialRampToValueAtTime(0.07, 11.98); og.gain.setValueAtTime(0.0001, 12);
    o.connect(of); of.connect(og); og.connect(music); o.start(10); o.stop(12);
    for (let k = 0; k < 24; k++) {
      const t = k < 8 ? 11 + k * 0.0625 : 11.5 + (k - 8) * 0.03125;
      const sb = ctx.createBiquadFilter(); sb.type = 'bandpass'; sb.frequency.value = 2200;
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.08 + k * 0.012, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      const sn = noise(t, 0.06); sn.connect(sb); sb.connect(sg); sg.connect(master);
    }
  }

  const buf = await ctx.startRendering();
  // 16-bit stereo WAV
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const n = L.length, bytes = 44 + n * 4, ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = 0.9 / Math.max(peak, 1e-6);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, clamp(L[i] * k, -1, 1) * 32767, true);
    v.setInt16(46 + i * 4, clamp(R[i] * k, -1, 1) * 32767, true);
  }
  const u8 = new Uint8Array(ab);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
};

// ---------------------------------------------------------------- ready

window.ready = (async () => {
  await document.fonts.load('900 160px DMS');
  await document.fonts.load('250 160px DMS');
  await document.fonts.ready;
  WW = WORDS.map(([w]) => tw(w, WFS, 900, -4) + 170);
  for (const ch of [...'0123456789%+,']) charW[ch] = tw(ch, 100, 900);
  const m = WM.map((ch) => tw(ch, 200, 900));
  const ls = -6;
  const total = m.reduce((a, b) => a + b, 0) + ls * (m.length - 1);
  let x = CX - total / 2;
  WMX = m.map((w) => { const c = x + w / 2; x += w + ls; return c; });
  WMW = m;
  window.seek(0);
  return true;
})();
