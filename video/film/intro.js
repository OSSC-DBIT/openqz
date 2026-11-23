/* The long OpenQZ intro: new scenes around parts of the 15-second film (core.js).

   Every scene starts from the pink tile in the middle of the frame and ends on it, so each one
   grows out of the last. Every scene is a whole number of bars at 120 BPM (one beat = 0.5 s), and
   something moves on every beat. Times inside a scene are local seconds (t). */

// ---------------------------------------------------------------- shared pieces

const SCENES = [];
let LENGTH = 0;
function scene(name, dur, build) {
  SCENES.push({ name, start: LENGTH, dur, build });
  LENGTH += dur;
}
function coreScene(name, dur, offset) {
  SCENES.push({ name, start: LENGTH, dur, core: offset });
  LENGTH += dur;
}
const popS = (t, t0, d = 0.38) => E.spr(clamp((t - t0) / d));
/** 1 at rest; dips on the beat at t0 and comes back, without overshoot. */
function pulse(t, t0, depth = 0.12) {
  return 1 - depth * K(t, [[t0, 0], [t0 + 0.1, 1], [t0 + 0.45, 0, 'spr']]);
}
/** A filled layer that covers the element from the left by `amount` (0 to 1). */
const cover = (el, amount) => (el.style.clipPath = `inset(0 ${100 - 100 * clamp(amount)}% 0 0)`);

/** A line of type that inflates in letter by letter (pop) or rises out of its mask (rise). */
function Line(parent, text, { size = 80, weight = 900, color = COL.cream, ls = -2, align = 'center' } = {}) {
  const mask = mk('mask', parent);
  const row = mk('row', mask);
  row.style.cssText += `font-size:${size}px;color:${color};letter-spacing:${ls}px;font-weight:${weight};`;
  if (align === 'left') row.style.justifyContent = 'flex-start';
  const spans = letters(row, text);
  const w = tw(text, size, Math.max(weight, 700), ls) + size * 0.3;
  const h = size * 1.34;
  return {
    mask, row, spans, w, h,
    at(x, y) {
      const left = align === 'left' ? x - size * 0.15 : x - w / 2;
      mask.style.left = `${left}px`;
      mask.style.top = `${y - h / 2}px`;
      mask.style.width = `${w}px`;
      mask.style.height = `${h}px`;
      return this;
    },
    pop(t, tIn, tOut, step = 0.02) {
      const on = t >= tIn - 0.01 && (tOut == null || t < tOut + 0.35);
      vis(mask, on);
      if (on) inflate(spans, t, tIn, tOut, step);
      return this;
    },
    rise(t, tIn, tOut) {
      const p = E.spr(clamp((t - tIn) / 0.4));
      const q = tOut == null ? 0 : prog(t, tOut, 0.24);
      row.style.transform = `translateY(${(1 - p) * 105 - q * 110}%)`;
      vis(mask, t >= tIn - 0.01 && (tOut == null || t < tOut + 0.3));
      return this;
    },
    color(from, to, c) {
      spans.slice(from, to).forEach((s) => (s.style.color = c));
      return this;
    },
  };
}

/** A pill with an optional icon square on the left. */
function Chip(parent, text, { icon, size = 28, bg = COL.cream, fg = COL.plum, iconBg = COL.pink, iconFg = COL.white, weight = 700 } = {}) {
  const el = mk('abs ctr', parent);
  const h = size * 2;
  const pad = size * 0.75;
  const iw = icon ? size * 1.35 : 0;
  const gap = icon ? size * 0.45 : 0;
  const w = tw(text, size, weight) + pad * 2 + iw + gap;
  el.style.cssText += `gap:${gap}px;border-radius:${h / 2}px;background:${bg};color:${fg};font-size:${size}px;font-weight:${weight};white-space:nowrap;line-height:1;`;
  if (icon) {
    const i = mk('', el);
    i.style.cssText = `width:${iw}px;height:${iw}px;border-radius:${iw * 0.28}px;background:${iconBg};color:${iconFg};padding:${iw * 0.18}px;box-sizing:border-box;flex:none;`;
    i.innerHTML = ICONS[icon];
  }
  const s = document.createElement('span');
  s.textContent = text;
  el.appendChild(s);
  return { el, w, h };
}
function place(chip, x, y, sc) {
  vis(chip.el, sc > 0.001);
  box(chip.el, x, y, chip.w, chip.h, { sc: Math.max(sc, 0.0001) });
}
/** Plain text, placed by its centre (or by its left edge). */
function Txt(parent, text, size, weight, color) {
  const d = mk('abs', parent);
  d.textContent = text;
  d.style.cssText += `font-size:${size}px;font-weight:${weight};color:${color};white-space:nowrap;line-height:1;`;
  d.w = tw(text, size, weight);
  d.h = size;
  return d;
}
function placeTxt(d, x, y, sc = 1, left = false) {
  vis(d, sc > 0.001);
  box(d, left ? x + d.w / 2 : x, y, d.w + 4, d.h * 1.2, { sc: Math.max(sc, 0.0001) });
}
function iconEl(parent, name, color) {
  const d = mk('abs', parent, ICONS[name]);
  d.style.color = color;
  return d;
}
/** The tile every scene starts and ends on. */
function carrier(root) {
  const d = mk('abs', root);
  d.style.background = COL.pink;
  return d;
}

// ---------------------------------------------------------------- 1. the logo, built out of the tile (4 bars)

scene('logo', 8, (root) => {
  const car = mk('abs', root);
  car.style.perspective = '1200px';
  const flip = mk('flip', car);
  const fr = mk('side', flip);
  fr.style.background = COL.pink;
  const lg = mk('abs', fr, LOGO);
  const bk = mk('side', flip);
  bk.style.transform = 'rotateY(180deg)';
  bk.style.overflow = 'hidden';
  bk.innerHTML = '<img src="ossc-logo.jpg" style="width:100%;height:100%;display:block">';
  const W = ['O', 'p', 'e', 'n', 'Q', 'Z'];
  const ws = W.map((ch, k) => {
    const d = mk('abs ctr', root);
    d.textContent = ch;
    d.style.cssText += `font-size:200px;font-weight:900;color:${k < 4 ? COL.cream : COL.pink};`;
    return d;
  });
  const m = W.map((ch) => tw(ch, 200, 900));
  const total = m.reduce((a, b) => a + b, 0) - 6 * 5;
  const lockW = 170 + 44 + total;
  const left = CX - lockW / 2;
  const tileX = left + 85;
  let x = left + 214;
  const LX = m.map((w) => {
    const c = x + w / 2;
    x += w - 6;
    return c;
  });
  const L1 = Line(root, 'Quizzes that play like a game.', { size: 84 });
  const L2 = Line(root, 'Marks that count.', { size: 84, color: COL.pink });
  const U2 = mk('abs', root);
  U2.style.background = COL.pink;
  const C1 = Line(root, 'The quiz and assignment platform of', { size: 38, weight: 600 });
  const C2 = Line(root, 'Don Bosco Institute of Technology, Bangalore', { size: 42, weight: 800 });
  const chip = Chip(root, 'Built by OSSC DBIT', { icon: 'heart', size: 30 });
  return (t) => {
    const lockY = K(t, [[0, CY], [0.5, CY, 'lin'], [0.95, CY - 120], [4.0, CY - 120, 'lin'], [4.42, CY - 160]]);
    const move = prog(t, 0.5, 0.45);
    const back = prog(t, 7.0, 0.42);
    const tx = lerp(lerp(CX, tileX, move), CX, back);
    const ty = lerp(lockY, CY, back);
    const ts = lerp(lerp(200, 170, move), 200, back);
    const sc = pulse(t, 0) * pulse(t, 7.5) * pulse(t, 3.0, 0.06);
    box(car, tx, ty, ts, ts, { sc });
    fr.style.borderRadius = bk.style.borderRadius = `${(48 * ts) / 200}px`;
    flip.style.transform = `rotateY(${K(t, [[5.0, 0], [5.42, 180, 'inOut'], [5.5, 180, 'lin'], [5.92, 360, 'inOut']])}deg)`;
    box(lg, ts / 2, ts / 2, ts * 0.6, ts * 0.6);
    ws.forEach((d, k) => {
      const tIn = [0.55, 1.05, 1.1, 1.15, 1.55, 1.6][k];
      const p = E.spr(clamp((t - tIn) / 0.42));
      const c = prog(t, 6.5 + (5 - k) * 0.03, 0.32, 'inOut');
      const on = p > 0.001 && c < 0.999;
      vis(d, on);
      if (!on) return;
      box(d, lerp(LX[k], tx, c), ty, m[k], 200, { sc: (0.3 + 0.7 * p) * (1 - c) });
      d.style.fontWeight = String(Math.round(250 + 650 * p));
    });
    L1.at(CX, CY + 70).pop(t, 2.0, 4.0);
    L2.at(CX, CY + 175).pop(t, 2.5, 4.0);
    const uw = L2.w * 0.86 * prog(t, 3.5, 0.35) * (1 - prog(t, 4.0, 0.2));
    vis(U2, uw > 1);
    box(U2, CX - (L2.w * 0.86) / 2 + uw / 2, CY + 236, uw, 10, { r: 5 });
    C1.at(CX, CY + 50).rise(t, 4.0, 6.0);
    C2.at(CX, CY + 112).pop(t, 4.5, 6.0, 0.012);
    place(chip, CX, CY + 200, popS(t, 5.5) * (1 - prog(t, 6.0, 0.25)));
  };
});

// ---------------------------------------------------------------- 2. the 15-second film's core (6 bars)

coreScene('core', 12, 0);

// ---------------------------------------------------------------- 3. four kinds of activity (4 bars)

scene('kinds', 8, (root) => {
  const KINDS = [
    ['Quiz', 'list-checks', 'pink', 'white', 'timed, auto-marked'],
    ['Assignment', 'clipboard-list', 'cream', 'plum', 'written work, rubrics'],
    ['Poll', 'chart-pie', 'white', 'plum', 'opinions, no marks'],
    ['Flashcards', 'layers', 'black', 'cream', 'self-study cards'],
  ];
  const items = KINDS.map(([name, icon, bg, fg, cap]) => {
    const o = mk('abs', root);
    o.style.background = COL[bg];
    o.style.overflow = 'hidden';
    if (bg === 'black') o.style.border = `6px solid ${COL.cream}`;
    const ic = iconEl(o, icon, COL[fg]);
    return { o, ic, L: Line(root, name, { size: 50 }), C: Line(root, cap, { size: 27, weight: 600 }) };
  });
  return (t) => {
    const col = prog(t, 7.0, 0.42, 'inOut');
    const any = prog(t, 3.0, 0.3) * (1 - prog(t, 7.0, 0.3));
    items.forEach((it, i) => {
      const xi = CX + (i - 1.5) * 300, yi = CY - 70;
      const sp = prog(t, i * 0.035, 0.42);
      let x = lerp(CX, xi, sp), y = lerp(CY, yi, sp), s = lerp(150, 210, sp), r = lerp(32, 44, sp);
      const a = E.spr(clamp((t - (3 + i)) / 0.35)) * (i < 3 ? 1 - E.spr(clamp((t - (4 + i)) / 0.35)) : 1 - prog(t, 7.0, 0.3));
      let sc = 1 + 0.12 * a - 0.1 * any * (1 - a);
      x = lerp(x, CX, col);
      y = lerp(y, CY, col);
      if (i === 0) {
        s = lerp(s, 200, col);
        r = lerp(r, 48, col);
        sc = lerp(sc, 1, col) * pulse(t, 7.5);
      } else sc *= 1 - col;
      vis(it.o, sc > 0.001 && (i === 0 || sp > 0.001));
      box(it.o, x, y, s, s, { r, sc: Math.max(sc, 0.0001) });
      const ip = popS(t, 0.3 + i * 0.05) * (1 - col) * (a > 0.5 ? pulse(t, 3.5 + i, 0.15) : 1);
      box(it.ic, s / 2, s / 2, s * 0.46, s * 0.46, { sc: Math.max(ip, 0.0001) });
      it.L.at(xi, CY + 92).pop(t, 0.5 + i * 0.5, 7.0);
      it.C.at(xi, CY + 148).rise(t, 3.0 + i * 1.0, 7.0);
    });
  };
});

// ---------------------------------------------------------------- 4. six question types (4 bars)

scene('qtypes', 8, (root) => {
  const NAMES = ['Six question types', 'Multiple choice', 'True / False', 'Multi-select', 'Fill in the blanks', 'Justify your answer', 'Open ended'];
  const ICON = [null, 'list-checks', 'check', 'layers', 'scroll-text', 'sparkles', 'clipboard-list'];
  const pill = mk('abs', root);
  pill.style.overflow = 'hidden';
  const fa = mk('fill', pill);
  const fb = mk('fill', pill);
  const rows = NAMES.map((n) => {
    const row = mk('row', pill);
    row.style.fontSize = '100px';
    row.style.letterSpacing = '-3px';
    return { row, spans: letters(row, n), w: tw(n, 100, 900, -3) + 150 };
  });
  const chips = NAMES.slice(1).map((n, k) => Chip(root, n, { icon: ICON[k + 1], size: 26 }));
  const rowsW = [0, 1].map((r) => chips.slice(r * 3, r * 3 + 3).reduce((a, c) => a + c.w + 22, -22));
  const CPOS = chips.map((c, k) => {
    const r = Math.floor(k / 3);
    let x = CX - rowsW[r] / 2;
    for (let j = r * 3; j < k; j++) x += chips[j].w + 22;
    return [x + c.w / 2, CY + 150 + r * 76];
  });
  const tIn = (i) => (i === 0 ? 0.5 : i * 1.0);
  const SW = [[0, 'pink', 'cream'], [1, 'cream', 'pink'], [2, 'pink', 'cream'], [3, 'cream', 'pink'], [4, 'pink', 'cream'], [5, 'cream', 'pink'], [6, 'pink', 'cream'], [7, 'cream', 'pink']];
  const keys = [[0, 200], [0.42, rows[0].w]];
  for (let i = 1; i < 7; i++) keys.push([tIn(i), rows[i - 1].w, 'lin'], [tIn(i) + 0.35, rows[i].w]);
  keys.push([7.0, rows[6].w, 'lin'], [7.42, 200]);
  return (t) => {
    const w = K(t, keys);
    const h = K(t, [[0, 200], [0.42, 190], [7.0, 190, 'lin'], [7.42, 200]]);
    const r = K(t, [[0, 48], [0.42, 60], [7.0, 60, 'lin'], [7.42, 48]]);
    const y = K(t, [[0, CY], [0.42, CY - 70], [7.0, CY - 70, 'lin'], [7.42, CY]]);
    box(pill, CX, y, w, h, { r, sc: pulse(t, 7.5) });
    const c = sweep(t, SW, 'pink');
    fa.style.background = COL[c.from];
    fb.style.background = COL[c.to];
    fb.style.clipPath = `inset(0 ${100 - 100 * c.p}% 0 0)`;
    rows.forEach((R, i) => {
      const a = tIn(i);
      const b = i < 6 ? tIn(i + 1) : 7.0;
      const on = t >= a - 0.01 && t < b + 0.3;
      vis(R.row, on);
      if (!on) return;
      R.row.style.color = i % 2 === 0 ? COL.plum : COL.white;
      inflate(R.spans, t, a, b, 0.018);
    });
    chips.forEach((ch, k) => {
      const p = popS(t, tIn(k + 1));
      const g = prog(t, 7.0 + k * 0.02, 0.35, 'inOut');
      place(ch, lerp(CPOS[k][0], CX, g), lerp(CPOS[k][1], CY, g), p * (1 - g));
    });
  };
});

// ---------------------------------------------------------------- 5. import from a Google Form (4 bars)

scene('import', 8, (root) => {
  const IW = 1100, IH = 620;
  const W = mk('abs', root);
  W.style.overflow = 'hidden';
  const wf = mk('fill', W);
  wf.style.background = COL.white;
  const inner = mk('abs', W);
  inner.style.cssText += `width:${IW}px;height:${IH}px;`;
  const wp = mk('fill', W);
  wp.style.background = COL.pink;
  const bar = mk('abs', inner);
  bar.style.cssText += `left:0;top:0;width:${IW}px;height:58px;background:${COL.cream};`;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, k) => {
    const d = mk('abs', inner);
    d.style.cssText += `left:${24 + k * 26}px;top:22px;width:14px;height:14px;border-radius:7px;background:${c};`;
  });
  const title = Txt(inner, 'Import questions', 24, 700, COL.plum);
  const tabs = [
    Chip(inner, 'Google Form', { icon: 'link', size: 24, bg: COL.pink, fg: COL.white, iconBg: COL.white, iconFg: COL.pink }),
    Chip(inner, 'Spreadsheet', { icon: 'file-spreadsheet', size: 24 }),
    Chip(inner, 'Paste text', { icon: 'clipboard-paste', size: 24 }),
  ];
  const input = mk('abs', inner);
  input.style.cssText += `border:3px solid #dad3b9;border-radius:14px;background:#fff;`;
  const typed = Txt(inner, '', 28, 600, COL.plum);
  const caret = mk('abs', inner);
  caret.style.background = COL.pink;
  const LINK = 'docs.google.com/forms/d/e/1FAIpQL.../viewform';
  const btn = Chip(inner, 'Read questions', { size: 26, bg: COL.pink, fg: COL.white });
  const QS = ['What is the capital of France?', 'Which of these are prime numbers?', 'The Earth goes around the Sun.'];
  const TC = ['pink', 'white', 'cream', 'plum'];
  const rows = QS.map((q, r) => {
    const o = mk('abs', inner);
    o.style.cssText += `background:${COL.cream};border-radius:16px;`;
    const n = mk('abs ctr', o);
    n.textContent = String(r + 1);
    n.style.cssText += `left:18px;top:16px;width:44px;height:44px;border-radius:22px;background:${COL.pink};color:#fff;font-size:24px;font-weight:800;`;
    const tx = Txt(o, q, 27, 700, COL.plum);
    tx.style.left = '80px';
    tx.style.top = '24px';
    const ts = TC.map((c, k) => {
      const d = mk('abs', o);
      d.style.cssText += `left:${1020 - 26 - (4 - k) * 64}px;top:16px;width:54px;height:44px;border-radius:10px;background:${COL[c]};${c === 'white' ? `border:3px solid #dad3b9;` : ''}box-sizing:border-box;`;
      return d;
    });
    return { o, ts };
  });
  const tick = iconEl(rows[1].ts[1], 'check', COL.plum);
  const cap = Line(inner, 'Tap the right answer', { size: 26, weight: 700, color: COL.plum, align: 'left', ls: 0 });
  const ready = Chip(inner, '3 ready', { icon: 'check', size: 24, bg: COL.pink, fg: COL.white, iconBg: COL.white, iconFg: COL.pink });
  const add = Chip(inner, 'Add 3 questions', { size: 26, bg: COL.plum, fg: COL.cream });
  const cur = mk('abs', inner, ICONS['mouse-pointer-2'].replace('fill="none"', 'fill="#ffffff"'));
  cur.style.color = COL.plum;
  const tileXY = [1020 - 26 - 3 * 64 + 27 + 40, 290 + 92 + 38];
  return (t) => {
    const g = prog(t, 0, 0.45), c = prog(t, 7.0, 0.42, 'inOut');
    const w = lerp(lerp(200, IW, g), 200, c), h = lerp(lerp(200, IH, g), 200, c);
    box(W, CX, CY, w, h, { r: lerp(lerp(48, 26, g), 48, c), sc: pulse(t, 7.5) });
    cover(wp, t < 7.0 ? 1 - prog(t, 0.05, 0.35) : prog(t, 7.0, 0.3));
    inner.style.transform = `translate(${(w - IW) / 2}px, ${(h - IH) / 2}px)`;
    placeTxt(title, 120, 30, 1, true);
    let tx = 40;
    tabs.forEach((ch, k) => {
      place(ch, tx + ch.w / 2, 110, popS(t, 0.5 + k * 0.06));
      tx += ch.w + 16;
    });
    box(input, 40 + 380, 205, 760, 70);
    vis(input, t >= 0.9);
    input.style.transform += ` scale(${Math.max(popS(t, 0.9), 0.0001)})`;
    const n = Math.round(LINK.length * prog(t, 1.0, 1.35, 'lin'));
    typed.textContent = LINK.slice(0, n);
    typed.w = tw(typed.textContent, 28, 600);
    placeTxt(typed, 64, 205, t >= 1.0 ? 1 : 0, true);
    vis(caret, t >= 1.0 && t < 2.7 && (t < 2.35 || Math.floor(t * 4) % 2 === 0));
    box(caret, 64 + typed.w + 6, 205, 3, 38);
    const click = (t0) => pulse(t, t0, 0.1);
    place(btn, 830 + btn.w / 2, 205, popS(t, 0.95) * click(2.5));
    rows.forEach((R, r) => {
      const p = popS(t, 3.0 + r * 0.5, 0.42);
      vis(R.o, p > 0.001);
      box(R.o, 40 + 510, 290 + r * 92 + 38, 1020, 76);
      R.o.style.clipPath = `inset(0 ${100 - 100 * p}% 0 0 round 16px)`;
    });
    const tk = popS(t, 5.0, 0.3);
    box(tick, 27, 22, 30, 30, { sc: Math.max(tk, 0.0001) });
    rows[1].ts[1].style.boxShadow = tk > 0.01 ? `0 0 0 ${4 * tk}px ${COL.pink}` : 'none';
    cap.at(40, 568).rise(t, 5.0, 7.0);
    place(ready, 1060 - ready.w / 2, 110, popS(t, 5.5));
    place(add, 1060 - add.w / 2, 568, popS(t, 5.6) * click(6.5));
    const cx = K(t, [[2.15, 920], [2.45, 960], [4.6, 960, 'lin'], [4.95, tileXY[0]], [6.1, tileXY[0], 'lin'], [6.45, 1060 - add.w / 2]]);
    const cy = K(t, [[2.15, 660], [2.45, 222], [4.6, 222, 'lin'], [4.95, tileXY[1]], [6.1, tileXY[1], 'lin'], [6.45, 585]]);
    vis(cur, t >= 2.1 && t < 7.0);
    box(cur, cx + 14, cy + 18, 46, 46, { sc: 1 - 0.15 * Math.max(1 - click(2.5), 1 - click(5.0), 1 - click(6.5)) * 6 });
  };
});

// ---------------------------------------------------------------- 6. classes: branch, semester, sections (2 bars)

scene('classes', 4, (root) => {
  const cse = mk('abs ctr', root);
  cse.style.cssText += `background:${COL.pink};color:#fff;font-size:56px;font-weight:900;overflow:hidden;`;
  const cseT = letters(cse, 'CSE');
  const sem = mk('abs ctr', root);
  sem.style.cssText += `background:${COL.cream};color:${COL.plum};font-size:50px;font-weight:900;`;
  const semT = letters(sem, 'Sem 5');
  const SEC = ['A', 'B', 'C'];
  const secs = SEC.map((n) => {
    const o = mk('abs ctr', root);
    o.style.cssText += `border:6px solid ${COL.cream};color:${COL.cream};font-size:50px;font-weight:900;box-sizing:border-box;overflow:hidden;`;
    const f = mk('fill', o);
    f.style.background = COL.pink;
    const s = mk('abs ctr', o);
    s.textContent = n;
    s.style.cssText += 'inset:0;';
    return { o, f, s };
  });
  const lines = [0, 1, 2, 3].map(() => {
    const d = mk('abs', root);
    d.style.cssText += `background:${COL.cream};height:6px;border-radius:3px;transform-origin:0 50%;`;
    return d;
  });
  const cap = Line(root, 'Only the classes you teach.', { size: 56 });
  const SY = [CY - 170, CY - 40, CY + 90];
  return (t) => {
    const col = prog(t, 3.0, 0.42, 'inOut');
    const g = prog(t, 0, 0.42);
    const toC = (x, y) => [lerp(x, CX, col), lerp(y, CY, col)];
    let [x, y] = toC(lerp(CX, CX - 470, g), lerp(CY, CY - 40, g));
    box(cse, x, y, lerp(lerp(200, 230, g), 200, col), lerp(lerp(200, 110, g), 200, col), { r: lerp(lerp(48, 55, g), 48, col), sc: pulse(t, 3.5) });
    inflate(cseT, t, 0.15, 2.95);
    cseT.forEach((sp) => (sp.style.opacity = String(1 - prog(t, 3.0, 0.15))));
    const sp = popS(t, 0.55) * (1 - col);
    [x, y] = toC(CX - 130, CY - 40);
    vis(sem, sp > 0.001);
    box(sem, x, y, 240, 110, { r: 55, sc: Math.max(sp, 0.0001) });
    inflate(semT, t, 0.6, 3.0, 0.015);
    const seg = (d, x0, y0, x1, y1, p) => {
      const len = Math.hypot(x1 - x0, y1 - y0) * p * (1 - col);
      vis(d, len > 1);
      d.style.width = `${len}px`;
      d.style.transform = `translate(${x0}px, ${y0 - 3}px) rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)`;
    };
    seg(lines[0], CX - 355, CY - 40, CX - 250, CY - 40, prog(t, 0.5, 0.3));
    SEC.forEach((_, j) => seg(lines[j + 1], CX - 10, CY - 40, CX + 195, SY[j], prog(t, 1.0 + j * 0.05, 0.3)));
    secs.forEach((S, j) => {
      const p = popS(t, 1.1 + j * 0.06) * (1 - col);
      const [sx, sy] = toC(CX + 260, SY[j]);
      vis(S.o, p > 0.001);
      box(S.o, sx, sy, 130, 100, { r: 24, sc: Math.max(p, 0.0001) });
      cover(S.f, j === 0 ? prog(t, 1.5, 0.3) : j === 2 ? prog(t, 2.0, 0.3) : 0);
      S.s.style.color = (j === 0 && t >= 1.6) || (j === 2 && t >= 2.1) ? COL.white : COL.cream;
    });
    cap.at(CX, CY + 230).pop(t, 2.5, 3.0);
  };
});

// ---------------------------------------------------------------- 7. a room: join code, QR, guests (4 bars)

scene('room', 8, (root) => {
  const car = carrier(root);
  const CODE = '482913';
  const boxes = [...CODE].map(() => {
    const o = mk('abs', root);
    o.style.cssText += `background:${COL.cream};overflow:hidden;`;
    const strip = mk('strip', o);
    strip.style.cssText += `font-size:130px;font-weight:900;color:${COL.plum};font-variant-numeric:tabular-nums;`;
    for (let k = 0; k < 20; k++) mk('', strip).textContent = String(k % 10);
    return { o, strip };
  });
  const N = 21;
  const qr = mk('abs', root);
  qr.style.cssText += `background:#fff;`;
  const finder = (x, y) => [[0, 0], [14, 0], [0, 14]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x, y) => {
    for (const [fx, fy] of [[0, 0], [14, 0], [0, 14]]) {
      const a = x - fx, b = y - fy;
      if (a >= 0 && a < 7 && b >= 0 && b < 7) return a === 0 || a === 6 || b === 0 || b === 6 || (a >= 2 && a <= 4 && b >= 2 && b <= 4);
    }
    return false;
  };
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mods = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const on = finder(x, y) ? finderOn(x, y) : rnd() < 0.47;
    if (!on) continue;
    const d = mk('abs', qr);
    d.style.background = COL.plum;
    mods.push({ d, x, y, dist: Math.hypot(x - 10, y - 10) });
  }
  const Lj = Line(root, 'Join with a code', { size: 70 });
  const Lq = Line(root, 'Scan the QR', { size: 40, weight: 700 });
  const Lg = Line(root, 'Guests welcome in live games', { size: 38, weight: 700 });
  const players = ['Asha', 'Bharath', 'Chitra', 'Dev', 'Guest 1', 'Guest 2'].map((n) => Chip(root, n, { icon: 'user-check', size: 26 }));
  const joined = Chip(root, '6 joined', { icon: 'users', size: 26, bg: COL.pink, fg: COL.white, iconBg: COL.white, iconFg: COL.pink });
  const start = Chip(root, 'Start', { icon: 'play', size: 30, bg: COL.pink, fg: COL.white, iconBg: COL.white, iconFg: COL.pink });
  return (t) => {
    const col = prog(t, 6.5, 0.4, 'inOut');
    const toC = (x, y) => [lerp(x, CX, col), lerp(y, CY, col)];
    const ct = 1 - prog(t, 0, 0.3);
    const ce = prog(t, 6.6, 0.4);
    vis(car, ct > 0.001 || ce > 0.001);
    box(car, CX, CY, 200, 200, { r: 48, sc: Math.max(ct + ce, 0.0001) * pulse(t, 7.5) });
    const m = prog(t, 2.0, 0.45);
    boxes.forEach((B, i) => {
      const p = prog(t, i * 0.03, 0.42);
      const ax = CX + (i - 2.5) * 165 + (i < 3 ? -18 : 18), ay = CY - 40;
      const bx = CX - 330 + (i - 2.5) * 100 + (i < 3 ? -11 : 11), by = CY - 210;
      const wave = 1 + 0.08 * K(t, [[1.5 + i * 0.05, 0], [1.6 + i * 0.05, 1], [1.95 + i * 0.05, 0, 'spr']]);
      let [x, y] = toC(lerp(lerp(CX, ax, p), bx, m), lerp(lerp(CY, ay, p), by, m));
      const s = lerp(1, 0.6, m) * wave * (1 - col);
      vis(B.o, p > 0.001 && s > 0.001);
      box(B.o, x, y, 140 * p, 180 * p, { r: 24, sc: Math.max(s, 0.0001) });
      const roll = (Number(CODE[i]) + 10) * E.out(clamp((t - 0.5 - i * 0.05) / 0.6));
      B.strip.style.transform = `translateY(${25 - roll * 130 + 0}px)`;
    });
    Lj.at(CX, CY + 160).pop(t, 1.0, 2.0);
    const qs = 400 * prog(t, 2.0, 0.4) * (1 - col);
    const [qx, qy] = toC(CX + 360, CY - 30);
    vis(qr, qs > 1);
    box(qr, qx, qy, qs, qs, { r: 24 });
    const mod = (qs - 40) / N;
    mods.forEach((M) => {
      const p = prog(t, 2.1 + M.dist * 0.035, 0.25);
      vis(M.d, p > 0.01);
      box(M.d, 20 + (M.x + 0.5) * mod, 20 + (M.y + 0.5) * mod, mod, mod, { sc: Math.max(p, 0.0001) });
    });
    Lq.at(CX + 360, CY + 220).rise(t, 3.0, 6.5);
    Lg.at(CX - 330, CY - 110).rise(t, 3.5, 6.5);
    players.forEach((ch, k) => {
      const [px, py] = toC(CX - 330 + ((k % 3) - 1) * 210, CY - 20 + Math.floor(k / 3) * 84);
      place(ch, px, py, popS(t, 4.0 + Math.floor(k / 2) * 0.5 + (k % 2) * 0.08) * (1 - col));
    });
    let [jx, jy] = toC(CX - 330, CY + 170);
    place(joined, jx, jy, popS(t, 5.5) * (1 - col));
    [jx, jy] = toC(CX + 360, CY + 300);
    place(start, jx, jy, popS(t, 5.9) * pulse(t, 6.2, 0.1) * (1 - col));
  };
});

// ---------------------------------------------------------------- 8. a student answers on a phone (4 bars)

scene('play', 8, (root) => {
  const PW = 380, PH = 760;
  const cam = mk('abs', root);
  cam.style.cssText += 'width:1920px;height:1080px;perspective:1800px;perspective-origin:960px 540px;';
  const ph = mk('abs', cam);
  ph.style.cssText += `overflow:hidden;background:#000;box-sizing:border-box;`;
  const inner = mk('abs', ph);
  inner.style.cssText += `width:${PW}px;height:${PH}px;`;
  const pp = mk('fill', ph);
  pp.style.background = COL.pink;
  const count = Chip(inner, '3 / 10', { size: 22 });
  const timer = Chip(inner, '0:18', { icon: 'timer', size: 22, bg: COL.pink, fg: COL.white, iconBg: COL.white, iconFg: COL.pink });
  const track = mk('abs', inner);
  track.style.cssText += `left:30px;top:112px;width:320px;height:10px;border-radius:5px;background:${COL.plum};`;
  const fill = mk('abs', inner);
  fill.style.cssText += `left:30px;top:112px;height:10px;border-radius:5px;background:${COL.pink};`;
  const Q1 = Line(inner, 'Which shape has', { size: 40, color: COL.white });
  const Q2 = Line(inner, '3 sides?', { size: 40, color: COL.white });
  const NAMES = ['Rectangle', 'Triangle', 'Square', 'Circle'];
  const TB = ['pink', 'cream', 'white', 'plum'];
  const TF = ['white', 'plum', 'plum', 'cream'];
  const tl = NAMES.map((n, i) => {
    const o = mk('abs ctr', inner);
    o.style.cssText += `background:${COL[TB[i]]};color:${COL[TF[i]]};font-size:25px;font-weight:800;box-sizing:border-box;${TB[i] === 'plum' ? `border:4px solid ${COL.cream};` : ''}`;
    o.textContent = n;
    return o;
  });
  const ring = mk('abs', inner);
  ring.style.cssText += `border-radius:50%;border-style:solid;border-color:${COL.cream};box-sizing:border-box;`;
  const tick = iconEl(inner, 'check', COL.plum);
  const ban = mk('abs ctr', inner);
  ban.style.cssText += `left:0;top:${PH - 130}px;width:${PW}px;height:130px;background:${COL.pink};color:#fff;font-size:44px;font-weight:900;gap:16px;`;
  ban.textContent = 'Correct!';
  const marks = Chip(inner, '+2 marks', { size: 22 });
  const streak = Chip(root, '3 in a row', { icon: 'sparkles', size: 26 });
  const caps = ['One question at a time.', 'Timer kept by the server.', 'Instant feedback.'].map((s) => Line(root, s, { size: 60, align: 'left' }));
  return (t) => {
    const g = prog(t, 0, 0.45), c = prog(t, 7.0, 0.42, 'inOut');
    const w = lerp(lerp(200, PW, g), 200, c), h = lerp(lerp(200, PH, g), 200, c);
    const off = prog(t, 4.0, 0.45) * (1 - prog(t, 6.5, 0.45));
    const x = CX - 400 * off;
    const ps = lerp(lerp(1, 0.8, g), 1, c);
    box(ph, x, CY, w, h, { r: lerp(lerp(48, 54, g), 48, c), sc: ps * (1 - 0.1 * off) * pulse(t, 7.5), extra: `rotateY(${22 * off}deg)` });
    ph.style.border = g > 0.9 && c < 0.1 ? `6px solid ${COL.cream}` : 'none';
    cover(pp, t < 7.0 ? 1 - prog(t, 0.05, 0.35) : prog(t, 7.0, 0.3));
    inner.style.transform = `translate(${(w - PW) / 2}px, ${(h - PH) / 2}px)`;
    place(count, 75, 62, popS(t, 0.5));
    place(timer, PW - 30 - timer.w / 2, 62, popS(t, 0.55));
    vis(track, t >= 0.5);
    fill.style.width = `${320 * (1 - 0.55 * prog(t, 0.6, 1.9, 'lin'))}px`;
    vis(fill, t >= 0.5);
    Q1.at(PW / 2, 190).pop(t, 1.0, null, 0.015);
    Q2.at(PW / 2, 244).pop(t, 1.08, null, 0.015);
    const pick = popS(t, 2.5, 0.3);
    tl.forEach((o, i) => {
      const p = popS(t, 1.5 + i * 0.05);
      const sc = p * (i === 1 ? 1 + 0.07 * pick : 1 - 0.12 * pick);
      vis(o, p > 0.001);
      box(o, 30 + 75 + (i % 2) * 170, 320 + 65 + Math.floor(i / 2) * 150, 150, 130, { r: 20, sc: Math.max(sc, 0.0001) });
      o.style.opacity = i === 1 ? '1' : String(1 - 0.55 * pick);
    });
    const rp = prog(t, 2.0, 0.38);
    vis(ring, t >= 2.0 && t < 2.4);
    box(ring, 30 + 75 + 170, 385, 60 + 140 * rp, 60 + 140 * rp);
    ring.style.borderWidth = `${10 * (1 - rp)}px`;
    box(tick, 30 + 75 + 170, 385 - 30, 44, 44, { sc: Math.max(popS(t, 2.55, 0.3), 0.0001) });
    vis(tick, t >= 2.55);
    const bp = E.spr(clamp((t - 3.0) / 0.4));
    ban.style.transform = `translateY(${(1 - bp) * 100}%)`;
    vis(ban, t >= 3.0);
    place(marks, PW / 2, PH - 130 - 34, popS(t, 3.1) * (t >= 3.0 ? 1 : 0));
    place(streak, x + 140 * (1 - off * 0.25), CY - 300, popS(t, 3.5) * (1 - prog(t, 6.5, 0.3)));
    caps.forEach((L, k) => L.at(CX - 90, CY - 130 + k * 130).pop(t, 4.5 + k * 0.5, 6.0, 0.012));
  };
});

// ---------------------------------------------------------------- 9. fair exams (4 bars)

scene('fair', 8, (root) => {
  const ST = [
    ['Full screen, when you ask.', 'maximize-2'],
    ['Tab switches counted.', 'eye'],
    ['Second device? Noticed.', 'monitor-smartphone'],
    ['One attempt each.', 'rotate-ccw'],
    ['Keys stay hidden.', 'lock'],
    ['Unblock in one click.', 'lock-open'],
    ['Fair for every student.', 'shield-check'],
  ];
  const tile = carrier(root);
  const icons = ST.map(([, ic]) => iconEl(tile, ic, COL.white));
  const lines = ST.map(([s], i) => {
    const L = Line(root, s, { size: 88, align: 'left' });
    if (i === 6) L.color(0, 4, COL.pink);
    return L;
  });
  const tIn = (i) => (i === 0 ? 0.15 : i * 1.0);
  return (t) => {
    const g = prog(t, 0, 0.42), c = prog(t, 7.0, 0.42, 'inOut');
    const x = lerp(lerp(CX, 400, g), CX, c);
    const s = lerp(lerp(200, 180, g), 200, c);
    const beat = Math.floor(t / 0.5);
    const tick = beat >= 1 && beat < 14 && beat % 2 === 1 ? pulse(t, beat * 0.5, 0.08) : 1;
    box(tile, x, CY, s, s, { r: (48 * s) / 200, sc: pulse(t, 7.5) * tick });
    icons.forEach((d, i) => {
      const p = popS(t, tIn(i), 0.32) * (1 - prog(t, i < 6 ? tIn(i + 1) - 0.08 : 7.0, 0.16));
      vis(d, p > 0.001);
      box(d, s / 2, s / 2, s * 0.5, s * 0.5, { sc: Math.max(p, 0.0001) });
    });
    lines.forEach((L, i) => L.at(540, CY).pop(t, tIn(i), i < 6 ? tIn(i + 1) : 7.0, 0.014));
  };
});

// ---------------------------------------------------------------- 10. a live game on the big screen (4 bars)

scene('live', 8, (root) => {
  const SW = 1160, SH = 640;
  const scr = mk('abs', root);
  scr.style.cssText += `overflow:hidden;background:#000;box-sizing:border-box;`;
  const inner = mk('abs', scr);
  inner.style.cssText += `width:${SW}px;height:${SH}px;`;
  const sp = mk('fill', scr);
  sp.style.background = COL.pink;
  const head = Txt(inner, 'Live game', 36, 800, COL.cream);
  const qn = Chip(inner, 'Question 3 of 10', { size: 22 });
  const P = ['Asha', 'Bharath', 'Chitra', 'Dev', 'Guest 2'];
  const R = [[820, 760, 640, 590, 410], [1520, 1560, 1290, 1380, 1100], [2410, 2200, 1980, 2250, 1720]];
  const RT = [1.0, 3.0, 4.0];
  const rank = R.map((sc) => P.map((_, i) => sc.filter((v) => v > sc[i]).length));
  const rows = P.map((n) => {
    const name = Txt(inner, n, 34, 700, COL.cream);
    const num = Txt(inner, '', 34, 900, COL.cream);
    const bar = mk('abs', inner);
    bar.style.background = COL.pink;
    const pts = Txt(inner, '0', 30, 800, COL.cream);
    return { name, num, bar, pts };
  });
  const gain = [Chip(inner, '+800', { size: 22, bg: COL.cream }), Chip(inner, '+890', { size: 22, bg: COL.cream })];
  const crown = iconEl(inner, 'crown', COL.pink);
  const c1 = Line(root, 'Live games on the big screen.', { size: 56 });
  const c2 = Line(root, 'Phones show only the answers.', { size: 56 });
  return (t) => {
    const g = prog(t, 0, 0.45), c = prog(t, 7.0, 0.42, 'inOut');
    const shrink = prog(t, 5.5, 0.4) * (1 - c);
    const w = lerp(lerp(200, SW, g), 200, c), h = lerp(lerp(200, SH, g), 200, c);
    box(scr, CX, CY - 90 * shrink, w, h, { r: lerp(lerp(48, 28, g), 48, c), sc: (1 - 0.2 * shrink) * pulse(t, 7.5) });
    scr.style.border = g > 0.9 && c < 0.1 ? `6px solid ${COL.cream}` : 'none';
    cover(sp, t < 7.0 ? 1 - prog(t, 0.05, 0.35) : prog(t, 7.0, 0.3));
    inner.style.transform = `translate(${(w - SW) / 2}px, ${(h - SH) / 2}px)`;
    placeTxt(head, 60, 60, popS(t, 0.5), true);
    place(qn, SW - 60 - qn.w / 2, 60, popS(t, 0.55));
    let ri = 0;
    while (ri + 1 < RT.length && t >= RT[ri + 1]) ri++;
    const p = ri === 0 ? prog(t, RT[0], 0.5) : prog(t, RT[ri], 0.45);
    rows.forEach((row, i) => {
      const prevV = ri === 0 ? 0 : R[ri - 1][i];
      const prevR = ri === 0 ? rank[0][i] : rank[ri - 1][i];
      const v = lerp(prevV, R[ri][i], p);
      const slot = lerp(prevR, rank[ri][i], p);
      const y = 150 + slot * 92;
      const inP = popS(t, 1.0 + i * 0.08);
      const on = inP > 0.001;
      [row.name, row.num, row.bar, row.pts].forEach((d) => vis(d, on));
      if (!on) return;
      row.num.textContent = String(Math.round(slot) + 1);
      placeTxt(row.num, 60, y, inP, true);
      placeTxt(row.name, 110, y, inP, true);
      const bw = (v / 2600) * 560;
      box(row.bar, 330 + bw / 2, y, Math.max(bw, 0.01), 46, { r: 12 });
      row.bar.style.background = i === 0 && t >= 5.0 ? COL.cream : COL.pink;
      row.pts.textContent = String(Math.round(v));
      row.pts.w = tw(row.pts.textContent, 30, 800);
      placeTxt(row.pts, 350 + bw, y, inP, true);
    });
    const y1 = 150 + rank[1][1] * 92, y2 = 150 + rank[2][0] * 92;
    place(gain[0], 360 + (R[1][1] / 2600) * 560 + 140, y1, popS(t, 3.5) * (1 - prog(t, 4.0, 0.2)));
    place(gain[1], 360 + (R[2][0] / 2600) * 560 + 140, y2, popS(t, 4.5) * (1 - prog(t, 5.0, 0.2)));
    const cr = popS(t, 5.0, 0.32);
    vis(crown, cr > 0.001);
    box(crown, 35, 150 - 30, 40, 40, { sc: Math.max(cr, 0.0001) });
    c1.at(CX, CY + 285).pop(t, 5.5, 6.0, 0.012);
    c2.at(CX, CY + 285).pop(t, 6.0, 6.5, 0.012);
  };
});

// ---------------------------------------------------------------- 11. reports and the admin office (4 bars)

scene('reports', 8, (root) => {
  const card = mk('abs', root);
  card.style.cssText += `overflow:hidden;`;
  const cf = mk('fill', card);
  cf.style.background = COL.white;
  const inner = mk('abs', card);
  inner.style.cssText += 'width:620px;height:560px;';
  const cp = mk('fill', card);
  cp.style.background = COL.pink;
  const title = Txt(inner, 'Report', 30, 800, COL.plum);
  const pct = makeRoller(inner, 120, COL.pink, [DIG, DIG, [' ', '%']]);
  const avg = Txt(inner, 'average marks', 26, 600, COL.plum);
  const PEOPLE = [['Asha K', '9 / 10', 'top'], ['Bharath M', '7 / 10', '1 warning'], ['Chitra R', '- / 10', 'to mark']];
  const prow = PEOPLE.map(([n, m, b]) => {
    const o = mk('abs', inner);
    o.style.cssText += `background:${COL.cream};border-radius:14px;`;
    const a = Txt(o, n, 26, 700, COL.plum);
    a.style.left = '24px';
    a.style.top = '22px';
    const mm = Txt(o, m, 26, 800, COL.plum);
    mm.style.left = '250px';
    mm.style.top = '22px';
    const bd = Chip(inner, b, { size: 20, bg: b === 'to mark' ? COL.pink : COL.plum, fg: b === 'to mark' ? COL.white : COL.cream });
    return { o, bd };
  });
  const excel = Chip(inner, 'Excel', { icon: 'file-spreadsheet', size: 24, bg: COL.plum, fg: COL.cream });
  const csv = Chip(inner, 'CSV', { icon: 'download', size: 24, bg: COL.plum, fg: COL.cream });
  const dl = iconEl(inner, 'download', COL.pink);
  // the office sheet on the right
  const sheet = mk('abs', root);
  const cells = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
    const d = mk('abs', sheet);
    d.style.background = r === 0 ? COL.pink : COL.cream;
    cells.push({ d, r, c });
  }
  const NAMES = ['A', 'B', 'C', 'D'];
  const av = NAMES.map((n) => {
    const d = mk('abs ctr', root);
    d.textContent = n;
    d.style.cssText += `border-radius:50%;background:${COL.cream};color:${COL.plum};font-size:40px;font-weight:900;`;
    return d;
  });
  const cap = Line(root, 'Office sheets become accounts.', { size: 38, weight: 700 });
  const pills = [Chip(root, 'Super admin', { icon: 'shield-check', size: 26 }), Chip(root, 'Audit log', { icon: 'scroll-text', size: 26 }), Chip(root, 'Integrity log', { icon: 'eye', size: 26 })];
  const RX = CX + 330;
  return (t) => {
    const g = prog(t, 0, 0.45), c = prog(t, 6.5, 0.45, 'inOut'), e = prog(t, 7.0, 0.42);
    const toC = (x, y) => [lerp(x, CX, c), lerp(y, CY, c)];
    const shift = prog(t, 3.0, 0.45);
    const cw = lerp(lerp(200, 620, g), 200, Math.max(c, e)), chh = lerp(lerp(200, 560, g), 200, Math.max(c, e));
    const [cx, cy] = toC(lerp(CX, CX - 320, shift), CY);
    box(card, cx, cy, cw, chh, { r: lerp(lerp(48, 26, g), 48, Math.max(c, e)), sc: pulse(t, 7.5) });
    cover(cp, t < 6.5 ? 1 - prog(t, 0.05, 0.35) : prog(t, 6.5, 0.3));
    inner.style.transform = `translate(${(cw - 620) / 2}px, ${(chh - 560) / 2}px)`;
    placeTxt(title, 40, 50, popS(t, 0.5), true);
    // the percentage rolls to 67
    const rp = prog(t, 0.5, 0.6);
    const vals = [' ', ' ', ' '];
    if (t >= 0.5) {
      const v = 67 * rp;
      pct.slots[0].strip.style.transform = `translateY(${-(Math.floor(v / 10) + clamp((v % 10) - 9))}em)`;
      pct.slots[1].strip.style.transform = `translateY(${-(v % 10)}em)`;
      pct.slots[2].strip.style.transform = 'translateY(-1em)';
    }
    void vals;
    pct.slots.forEach((sl, k) => (sl.s.style.width = `${slotWidth(k === 2 ? '%' : '0', 120)}px`));
    vis(pct.root, t >= 0.5);
    pct.root.style.transform = `translate(40px, 90px) scale(${Math.max(popS(t, 0.5), 0.0001)})`;
    pct.root.style.transformOrigin = '0 0';
    placeTxt(avg, 44, 236, popS(t, 0.6), true);
    prow.forEach((P, i) => {
      const p = popS(t, 1.0 + i * 0.1, 0.42);
      vis(P.o, p > 0.001);
      box(P.o, 40 + 270, 300 + i * 72, 540, 60);
      P.o.style.clipPath = `inset(0 ${100 - 100 * p}% 0 0 round 14px)`;
      place(P.bd, 560 - P.bd.w / 2, 300 + i * 72, popS(t, 1.5 + i * 0.08));
    });
    place(excel, 40 + excel.w / 2, 515, popS(t, 2.0) * pulse(t, 2.5, 0.1));
    place(csv, 40 + excel.w + 14 + csv.w / 2, 515, popS(t, 2.06));
    const dp = prog(t, 2.55, 0.4);
    vis(dl, t >= 2.55 && t < 2.95);
    box(dl, 40 + excel.w / 2, 470 + 50 * dp, 30, 30);
    // right side: the office sheet fills, then each row becomes an account
    const cellW = 120, cellH = 46;
    cells.forEach(({ d, r, c: cc }) => {
      const p = popS(t, 3.0 + r * 0.12 + cc * 0.03, 0.3);
      const m = prog(t, 4.0 + r * 0.05, 0.4, 'inOut');
      const gx = RX - 1.5 * (cellW + 6) + cc * (cellW + 6), gy = CY - 200 + r * (cellH + 6);
      const tx = r === 0 ? gx : RX - 1.5 * 140 + (r - 1) * 140;
      const ty = r === 0 ? gy : CY - 90;
      let [x, y] = toC(lerp(gx, tx, r === 0 ? 0 : m), lerp(gy, ty, r === 0 ? 0 : m));
      const s = p * (1 - (r === 0 ? prog(t, 4.0, 0.3) : m)) * (1 - c);
      vis(d, s > 0.001);
      box(d, x, y, cellW, cellH, { r: 8, sc: Math.max(s, 0.0001) });
    });
    av.forEach((d, k) => {
      const p = prog(t, 4.25 + k * 0.05, 0.3);
      const [x, y] = toC(RX - 1.5 * 140 + k * 140, CY - 90);
      const s = p * (1 - c);
      vis(d, s > 0.001);
      box(d, x, y, 110, 110, { sc: Math.max(s, 0.0001) });
    });
    cap.at(RX, CY + 20).rise(t, 4.5, 6.5);
    pills.forEach((ch, k) => {
      const [x, y] = toC(RX, CY + 110 + k * 76);
      place(ch, x, y, popS(t, 5.0 + k * 0.5) * (1 - c));
    });
  };
});

// ---------------------------------------------------------------- 12. who built it (4 bars), ending on the small square (no contributor list)

scene('credits', 8, (root) => {
  const logo = mk('abs', root);
  logo.style.cssText += `overflow:hidden;background:${COL.pink};`;
  const img = mk('abs', logo, '<img src="ossc-logo.jpg" style="width:100%;height:100%;display:block">');
  const L1 = Line(root, 'Built by the', { size: 70 });
  const L2 = Line(root, 'Open Source Students Club, DBIT', { size: 70, color: COL.pink });
  const U = mk('abs', root);
  U.style.background = COL.cream;
  const NUM = [[10, '', 'developers', 'pink'], [50, '+', 'hours of building', 'cream'], [100, '%', 'open source', 'white']];
  const tiles = NUM.map(([, , label, bg]) => {
    const o = mk('abs', root);
    o.style.cssText += `background:${COL[bg]};overflow:hidden;`;
    const n = mk('abs ctr', o);
    n.style.cssText += `left:0;top:30px;width:100%;height:120px;font-size:100px;font-weight:900;color:${bg === 'pink' ? COL.white : COL.plum};font-variant-numeric:tabular-nums;`;
    const l = mk('abs ctr', o);
    l.style.cssText += `left:0;top:152px;width:100%;height:40px;font-size:30px;font-weight:700;color:${bg === 'pink' ? COL.cream : COL.plum};white-space:nowrap;`;
    l.textContent = label;
    return { o, n };
  });
  const O1 = Line(root, 'Open source. Free for every college.', { size: 64 });
  const link = Chip(root, 'github.com/OSSC-DBIT/openqz', { icon: 'heart', size: 28 });
  const sq = carrier(root);
  return (t) => {
    // the tile becomes the round OSSC badge
    const g = prog(t, 0, 0.42), out = prog(t, 2.0, 0.3, 'inOut');
    const ls = lerp(200, 180, g) * (1 - out);
    vis(logo, ls > 0.5);
    box(logo, CX, lerp(CY, CY - 190, g), ls, ls, { r: lerp(48, 90, g) * (1 - out) });
    box(img, ls / 2, ls / 2, ls, ls, { sc: Math.max(popS(t, 0.1, 0.35), 0.0001) });
    L1.at(CX, CY + 10).pop(t, 0.5, 2.0);
    L2.at(CX, CY + 105).pop(t, 1.0, 2.0, 0.012);
    const uw = L2.w * 0.84 * prog(t, 1.5, 0.35) * (1 - prog(t, 2.0, 0.2));
    vis(U, uw > 1);
    box(U, CX - (L2.w * 0.84) / 2 + uw / 2, CY + 160, uw, 8, { r: 4 });
    // the numbers
    tiles.forEach((T, i) => {
      const a = 2.0 + i * 0.5;
      const p = popS(t, a, 0.42) * (1 - prog(t, 5.0, 0.3, 'inOut'));
      const wv = (b) => K(t, [[b + i * 0.06, 0], [b + 0.1 + i * 0.06, 1], [b + 0.45 + i * 0.06, 0, 'spr']]);
      const wave = 1 + 0.06 * (wv(3.5) + wv(4.0) + wv(4.5));
      vis(T.o, p > 0.001);
      box(T.o, CX + (i - 1) * 360, CY - 30, 320, 220, { r: 28, sc: Math.max(p * wave, 0.0001) });
      T.n.textContent = `${Math.round(NUM[i][0] * prog(t, a, 0.4))}${NUM[i][1]}`;
    });
    // the closing line
    O1.at(CX, CY - 40).pop(t, 5.0, 6.0, 0.012);
    place(link, CX, CY + 70, popS(t, 5.5) * (1 - prog(t, 6.0, 0.3)));
    // everything folds into the small square the grid bursts out of
    const sp = prog(t, 6.05, 0.4);
    const rot = K(t, [[6.5, 0], [6.9, 90, 'inOut']]);
    vis(sq, sp > 0.001);
    box(sq, CX, CY, 150 * sp, 150 * sp, { r: 32 * sp, sc: pulse(t, 7.0, 0.08) * pulse(t, 7.5, 0.08), extra: `rotate(${rot}deg)` });
  };
});

// ---------------------------------------------------------------- 13. the grid spells OpenQZ, back to the tile (1.5 bars)

coreScene('end', 3, 12);

// ---------------------------------------------------------------- seek

window.FILM_LENGTH = LENGTH;
const coreReady = window.ready;
window.ready = (async () => {
  await coreReady;
  for (const S of SCENES) {
    if (S.core !== undefined) continue;
    S.root = mk('abs');
    S.root.style.cssText += 'width:1920px;height:1080px;';
    S.render = S.build(S.root);
    vis(S.root, false);
  }
  window.seek = (T) => {
    let core = -1;
    for (const S of SCENES) {
      const on = T >= S.start && (T < S.start + S.dur || (S === SCENES[SCENES.length - 1] && T <= LENGTH));
      if (S.core !== undefined) {
        if (on) core = S.core + (T - S.start);
        continue;
      }
      vis(S.root, on);
      if (on) S.render(T - S.start);
    }
    window.seekCore(core);
  };
  window.seek(0);
  return true;
})();
