// Edit a recorded demo (scripts/demo/record.mjs) into ONE narrated video.
//
//   node scripts/demo/edit.mjs recordings/demo-<time>
//
// Out: recordings/demo-<time>/OpenQZ-demo.mp4 (1920x1080, 30 fps, H.264 + AAC).
// What it does:
//   - opens with the logo sequence of the intro film (video/out/openqz-intro.mp4), then a title card;
//   - every scene: the filmed screens in device frames (desktop window, phones), a caption that
//     says what is about to happen (shown when the narrator starts that line) with the narration as
//     subtitles, and a full-screen card for each step;
//   - the narration (recordings/demo-voice) placed exactly where it was spoken during recording;
//   - music under it all ("Gaslight (120 bpm)" by Dante Ross, CC0), lowered while the voice speaks.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIR = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(path.join(DIR, 'timeline.json'))) {
  console.error('usage: node scripts/demo/edit.mjs recordings/demo-<time>');
  process.exit(1);
}
const FFMPEG =
  process.env.FFMPEG ??
  [path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Python/Python313/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')].find((f) => fs.existsSync(f)) ??
  'ffmpeg';
const MUSIC = process.env.MUSIC ?? path.join(ROOT, 'video', 'music', 'gaslight.mp3');
const OPENER = path.join(ROOT, 'video', 'out', 'openqz-intro.mp4');
const VOICE = path.join(ROOT, 'recordings', 'demo-voice');
const LINES = JSON.parse(fs.readFileSync(path.join(HERE, 'lines.json'), 'utf8'));
const TL = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'));
const FPS = 30;
const W = 1920;
const H = 1080;
const WORK = path.join(DIR, 'edit');
fs.mkdirSync(WORK, { recursive: true });

function ff(args, label) {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error(String(r.stderr));
    throw new Error(`ffmpeg failed: ${label}`);
  }
}

// ---------------------------------------------------------------- scenes from the timeline
const scenes = [];
for (const e of TL.events) {
  if (e.type === 'scene') scenes.push({ ...e, start: e.t, lines: [] });
  else if (e.type === 'line') scenes.at(-1).lines.push(e);
  else if (e.type === 'end') scenes.at(-1).end = e.t;
}
const DUR = JSON.parse(fs.readFileSync(path.join(VOICE, 'durations.json'), 'utf8'));

// ---------------------------------------------------------------- layouts: where each screen sits
const LAYOUTS = {
  desktop: { screens: [{ x: 240, y: 118, w: 1440, h: 810, kind: 'desktop' }], caption: { x: 240, y: 950, w: 1440, mode: 'below' } },
  phone: { screens: [{ x: 1214, y: 100, w: 406, h: 880, kind: 'phone' }], caption: { x: 180, y: 300, w: 900, mode: 'side' } },
  'desktop+phone': {
    screens: [
      { x: 70, y: 150, w: 1280, h: 720, kind: 'desktop' },
      { x: 1478, y: 150, w: 334, h: 724, kind: 'phone' },
    ],
    caption: { x: 70, y: 905, w: 1780, mode: 'below' },
  },
  'desktop+2phones': {
    screens: [
      { x: 50, y: 160, w: 1136, h: 640, kind: 'desktop' },
      { x: 1236, y: 160, w: 300, h: 650, kind: 'phone' },
      { x: 1574, y: 160, w: 300, h: 650, kind: 'phone' },
    ],
    caption: { x: 50, y: 860, w: 1824, mode: 'below' },
  },
};
// the video encoder needs even sizes
for (const L of Object.values(LAYOUTS)) for (const r of L.screens) { r.w -= r.w % 2; r.h -= r.h % 2; }
const WHO = { admin: 'Super admin | desktop', faculty: 'Dr. Ananya Rao, faculty | desktop', rahul: 'Rahul, student | phone', club: 'Tech Club | big screen', priya: 'Priya, student | phone', guest: 'Arjun, guest | phone' };

// ---------------------------------------------------------------- drawing the frames, captions and cards (HTML -> PNG)
// the font travels inside the page: a page made with setContent may not read files from disk
const FONT = `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'video', 'film', 'dmsans.woff2')).toString('base64')}`;
const LOGO = `<svg viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="16" fill="#d6177f"/><circle cx="30" cy="30" r="14" fill="none" stroke="#fff" stroke-width="6"/><path d="M41 41l8 8" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const CSS = `@font-face{font-family:D;src:url(${FONT}) format('woff2');font-weight:100 1000}
*{box-sizing:border-box;margin:0}body{width:${W}px;height:${H}px;overflow:hidden;font-family:D,sans-serif;color:#f3efda;
background:radial-gradient(1200px 700px at 85% -10%,#5a1f41 0%,transparent 60%),radial-gradient(900px 600px at -10% 110%,#4a1836 0%,transparent 60%),#3b142a}
.abs{position:absolute}.brand{left:56px;top:30px;display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px}.brand i{display:block;width:44px;height:44px}
.chip{display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:#d6177f;color:#fff;font-weight:800;font-size:22px}
.chip.c{background:#f3efda;color:#3b142a}`;

function chromeHtml(scene, line) {
  const L = LAYOUTS[scene.layout];
  const ch = scene.chapter ? LINES.chapters[scene.chapter] : null;
  const text = line ? LINES.lines[line.id] : null;
  let s = `<div class="abs brand"><i>${LOGO}</i><span>Open<span style="color:#ff4fa8">QZ</span></span></div>`;
  if (ch) s += `<div class="abs" style="right:56px;top:34px;display:flex;gap:10px"><span class="chip">${esc(ch.step)}</span><span class="chip c">${esc(ch.who)} | ${esc(ch.device)}</span></div>`;
  L.screens.forEach((r, i) => {
    const who = WHO[scene.pages[i]] ?? '';
    if (r.kind === 'desktop') {
      s += `<div class="abs" style="left:${r.x - 8}px;top:${r.y - 44}px;width:${r.w + 16}px;height:${r.h + 52}px;border-radius:16px;background:#f3efda;box-shadow:0 30px 80px rgba(0,0,0,.45)"></div>`;
      s += `<div class="abs" style="left:${r.x + 14}px;top:${r.y - 30}px;display:flex;gap:9px">${['#ff5f57', '#febc2e', '#28c840'].map((c) => `<b style="width:15px;height:15px;border-radius:50%;background:${c};display:block"></b>`).join('')}</div>`;
      s += `<div class="abs" style="left:${r.x + 110}px;top:${r.y - 36}px;height:28px;padding:0 16px;border-radius:8px;background:#e6dfc4;color:#3b142a;font-size:17px;font-weight:700;display:flex;align-items:center">${esc(who)}</div>`;
    } else {
      const b = Math.round(r.w * 0.045);
      s += `<div class="abs" style="left:${r.x - b}px;top:${r.y - b}px;width:${r.w + 2 * b}px;height:${r.h + 2 * b}px;border-radius:${Math.round(r.w * 0.14)}px;background:#111;box-shadow:0 30px 80px rgba(0,0,0,.5),inset 0 0 0 3px #333"></div>`;
      if (scene.layout !== 'phone') s += `<div class="abs" style="left:${r.x}px;top:${r.y - b - 44}px;width:${r.w}px;text-align:center;font-size:18px;font-weight:700;color:#f3efda;opacity:.85">${esc(who)}</div>`;
    }
  });
  if (text) {
    const c = L.caption;
    if (c.mode === 'side') {
      s += `<div class="abs" style="left:${c.x}px;top:${c.y}px;width:${c.w}px">
        <div style="font-size:24px;font-weight:700;color:#ff8cc6;letter-spacing:.04em;text-transform:uppercase">${esc(ch?.title ?? '')}</div>
        <div style="margin-top:18px;font-size:76px;font-weight:900;line-height:1.02;letter-spacing:-1.5px">${esc(text.do)}</div>
        <div style="margin-top:30px;font-size:31px;font-weight:500;line-height:1.4;color:#e9dfc9">${esc(text.text)}</div></div>`;
    } else {
      s += `<div class="abs" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;display:flex;gap:28px;align-items:flex-start">
        <div style="flex:none;max-width:44%;font-size:40px;font-weight:900;line-height:1.05;letter-spacing:-.5px;color:#fff"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:#d6177f;margin-right:14px;vertical-align:middle;position:relative;top:-4px"></span>${esc(text.do)}</div>
        <div style="flex:1;font-size:24px;font-weight:500;line-height:1.38;color:#e9dfc9;padding-top:4px">${esc(text.text)}</div></div>`;
    }
  }
  return s;
}
function cardHtml(kind, data) {
  if (kind === 'chapter')
    return `<div class="abs" style="inset:0;display:flex;flex-direction:column;justify-content:center;padding-left:220px">
      <div class="chip" style="align-self:flex-start;font-size:34px;padding:12px 28px">${esc(data.step)}</div>
      <div style="margin-top:34px;font-size:110px;font-weight:900;letter-spacing:-3px;line-height:1">${esc(data.title)}</div>
      <div style="margin-top:34px;font-size:40px;font-weight:600;color:#e9dfc9">${esc(data.who)} <span style="color:#d6177f">|</span> ${esc(data.device)}</div></div>
      <div class="abs brand"><i>${LOGO}</i><span>Open<span style="color:#ff4fa8">QZ</span></span></div>`;
  return `<div class="abs" style="inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="display:flex;align-items:center;gap:36px"><i style="display:block;width:170px;height:170px">${LOGO}</i><span style="font-size:190px;font-weight:900;letter-spacing:-6px">Open<span style="color:#ff2d95">QZ</span></span></div>
    <div style="margin-top:36px;font-size:54px;font-weight:800">${esc(data.title)}</div>
    <div style="margin-top:20px;font-size:34px;font-weight:600;color:#e9dfc9">${esc(data.sub)}</div>
    <div class="abs" style="bottom:60px;font-size:26px;font-weight:700;color:#e9dfc9;opacity:.8">Built and maintained by OSSC DBIT | Don Bosco Institute of Technology, Bangalore</div></div>`;
}

const browser = await chromium.launch();
const shotPage = await browser.newPage({ viewport: { width: W, height: H } });
async function png(html, file) {
  await shotPage.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body>${html}</body></html>`);
  await shotPage.evaluate(() => document.fonts.ready);
  await shotPage.screenshot({ path: file });
}

// ---------------------------------------------------------------- one scene -> one clip
/** Constant-frame-rate clip of one filmed page between two times, scaled to its slot. */
function screenClip(name, t0, t1, slot, out) {
  const meta = TL.pages[name];
  const fr = meta.frames;
  let i = 0;
  while (i + 1 < fr.length && fr[i + 1][1] <= t0) i++;
  const list = [];
  let t = t0;
  for (let k = i; k < fr.length && t < t1; k++) {
    const next = Math.min(t1, k + 1 < fr.length ? Math.max(fr[k + 1][1], t) : t1);
    const d = next - t;
    if (d > 0.0005 || k === i) list.push(`file '${path.join(DIR, 'frames', name, fr[k][0]).replace(/\\/g, '/')}'\nduration ${Math.max(d, 0.001).toFixed(4)}`);
    t = next;
  }
  if (t < t1) list.push(`file '${path.join(DIR, 'frames', name, fr.at(-1)[0]).replace(/\\/g, '/')}'\nduration ${(t1 - t).toFixed(4)}`);
  list.push(list.at(-1).split('\n')[0]); // the concat demuxer needs the last file twice
  const lst = `${out}.txt`;
  fs.writeFileSync(lst, `ffconcat version 1.0\n${list.join('\n')}\n`);
  ff(['-f', 'concat', '-safe', '0', '-i', lst, '-vf', `scale=${slot.w}:${slot.h}:flags=lanczos,fps=${FPS},format=yuv420p`, '-t', (t1 - t0).toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out], `screen ${name}`);
}

const parts = [];
let n = 0;
for (const sc of scenes) {
  const D = sc.end - sc.start;
  const tag = `${String(++n).padStart(2, '0')}-${sc.name}`;
  console.log(`scene ${tag} (${D.toFixed(1)} s)`);
  const out = path.join(WORK, `${tag}.mp4`);
  if (fs.existsSync(out) && !process.env.REDO) {
    parts.push(out);
    continue;
  }
  // the voice of this scene, placed where it was spoken
  const vin = [];
  const vf = [];
  sc.lines.forEach((l, k) => {
    vin.push('-i', path.join(VOICE, `${l.id}.mp3`));
    const ms = Math.max(0, Math.round((l.t - sc.start) * 1000));
    vf.push(`[${k + 1}:a]adelay=${ms}|${ms},aformat=channel_layouts=stereo:sample_rates=48000[v${k}]`);
  });
  const mix = sc.lines.length ? `${vf.join(';')};${sc.lines.map((_, k) => `[v${k}]`).join('')}amix=inputs=${sc.lines.length}:normalize=0:duration=longest,apad,atrim=0:${D.toFixed(3)}[a]` : `anullsrc=r=48000:cl=stereo,atrim=0:${D.toFixed(3)}[a]`;

  if (sc.layout === 'title') {
    const card = path.join(WORK, `${tag}.png`);
    const intro = sc.name === 'intro';
    await png(cardHtml('title', intro ? { title: 'From setup to marks, in one walkthrough', sub: 'Super admin, faculty, students and clubs' } : { title: 'Quizzes that play like a game. Marks that count.', sub: 'Open source. Built for every college.' }), card);
    ff(['-loop', '1', '-framerate', String(FPS), '-i', card, ...vin, '-filter_complex', `[0:v]format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${(D - 0.5).toFixed(3)}:d=0.5[vv];${mix}`, '-map', '[vv]', '-map', '[a]', '-t', D.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', out], tag);
    parts.push(out);
    continue;
  }

  const L = LAYOUTS[sc.layout];
  // caption states: before the first line, then one per line
  const chapterLine = sc.lines.find((l) => l.id.endsWith('.chapter'));
  const states = [{ t: sc.start, line: null }, ...sc.lines.filter((l) => l !== chapterLine).map((l) => ({ t: l.t, line: l }))];
  const clist = [];
  for (const [k, st] of states.entries()) {
    const f = path.join(WORK, `${tag}-c${k}.png`);
    await png(chromeHtml(sc, st.line), f);
    const until = k + 1 < states.length ? states[k + 1].t : sc.end;
    clist.push(`file '${f.replace(/\\/g, '/')}'\nduration ${Math.max(0.04, until - st.t).toFixed(4)}`);
  }
  clist.push(clist.at(-1).split('\n')[0]);
  const chromeList = path.join(WORK, `${tag}-chrome.txt`);
  fs.writeFileSync(chromeList, `ffconcat version 1.0\n${clist.join('\n')}\n`);
  // the screens
  const screens = L.screens.map((slot, i) => {
    const f = path.join(WORK, `${tag}-s${i}.mp4`);
    screenClip(sc.pages[i], sc.start, sc.end, slot, f);
    return f;
  });
  // the step card, over everything while the narrator announces the step
  const cardIn = [];
  let cardF = '';
  if (chapterLine) {
    const card = path.join(WORK, `${tag}-card.png`);
    await png(cardHtml('chapter', LINES.chapters[sc.chapter]), card);
    const a = Math.max(0, chapterLine.t - sc.start);
    const nextLine = sc.lines[sc.lines.indexOf(chapterLine) + 1];
    const b = nextLine ? nextLine.t - sc.start : a + DUR[chapterLine.id] + 0.5;
    cardIn.push('-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(3), '-i', card);
    cardF = `;[ci]format=yuva420p,fade=t=out:st=${(b - 0.35).toFixed(3)}:d=0.35:alpha=1[cf];[base${screens.length}][cf]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[vv]`;
  }
  // rounded corners: a mask per screen (white = shown)
  const masks = [];
  for (const [i, slot] of L.screens.entries()) {
    const r = slot.kind === 'phone' ? Math.round(slot.w * 0.1) : 8;
    const m = path.join(WORK, `mask-${slot.w}x${slot.h}-${r}.png`);
    if (!fs.existsSync(m)) {
      await shotPage.setViewportSize({ width: slot.w, height: slot.h });
      await shotPage.setContent(`<body style="margin:0;background:#000"><div style="width:${slot.w}px;height:${slot.h}px;border-radius:${r}px;background:#fff"></div></body>`);
      await shotPage.screenshot({ path: m });
      await shotPage.setViewportSize({ width: W, height: H });
    }
    masks[i] = m;
  }
  // inputs: 0 chrome, 1.. screens, masks, then the card, then the voices
  const inputs = ['-f', 'concat', '-safe', '0', '-i', chromeList, ...screens.flatMap((f) => ['-i', f]), ...masks.flatMap((m) => ['-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(3), '-i', m]), ...cardIn];
  const maskIdx = 1 + screens.length;
  const cardIdx = maskIdx + masks.length;
  const voiceBase = cardIdx + (chapterLine ? 1 : 0);
  let g = `[0:v]fps=${FPS},format=yuv420p,scale=${W}:${H}[base0]`;
  L.screens.forEach((slot, i) => {
    g += `;[${maskIdx + i}:v]format=gray[mk${i}];[${i + 1}:v][mk${i}]alphamerge[sr${i}];[base${i}][sr${i}]overlay=${slot.x}:${slot.y}:shortest=1[base${i + 1}]`;
  });
  if (chapterLine) g += `;[${cardIdx}:v]null[ci]${cardF}`;
  else g += `;[base${screens.length}]null[vv]`;
  const vmix = sc.lines.length
    ? `;${sc.lines.map((l, k) => { const ms = Math.max(0, Math.round((l.t - sc.start) * 1000)); return `[${voiceBase + k}:a]adelay=${ms}|${ms},aformat=channel_layouts=stereo:sample_rates=48000[v${k}]`; }).join(';')};${sc.lines.map((_, k) => `[v${k}]`).join('')}amix=inputs=${sc.lines.length}:normalize=0:duration=longest,apad,atrim=0:${D.toFixed(3)}[a]`
    : `;anullsrc=r=48000:cl=stereo,atrim=0:${D.toFixed(3)}[a]`;
  ff([...inputs, ...vin, '-filter_complex', g + `;[vv]fade=t=in:st=0:d=0.35,fade=t=out:st=${(D - 0.35).toFixed(3)}:d=0.35[vo]` + vmix, '-map', '[vo]', '-map', '[a]', '-t', D.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', out], tag);
  parts.push(out);
}
await browser.close();

// ---------------------------------------------------------------- the opener: the logo sequence of the intro film
const opener = path.join(WORK, '00-opener.mp4');
if (fs.existsSync(OPENER)) {
  ff(['-t', '7.6', '-i', OPENER, '-f', 'lavfi', '-t', '7.6', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', `scale=${W}:${H},fps=${FPS},format=yuv420p,fade=t=out:st=7.25:d=0.35`, '-map', '0:v', '-map', '1:a', '-t', '7.6', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', opener], 'opener');
  parts.unshift(opener);
}

// ---------------------------------------------------------------- join, then the music under the voice
const joined = path.join(WORK, 'joined.mp4');
fs.writeFileSync(path.join(WORK, 'parts.txt'), parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n') + '\n');
ff(['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'parts.txt'), '-c', 'copy', joined], 'join');
const probe = spawnSync(FFMPEG, ['-i', joined], { encoding: 'utf8' }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
const total = Number(probe[1]) * 3600 + Number(probe[2]) * 60 + Number(probe[3]);

const final = path.join(DIR, 'OpenQZ-demo.mp4');
if (fs.existsSync(MUSIC)) {
  // Gaslight from 0:48.475 (where the intro film's music starts), its steady part looped with crossfades.
  const LOOP_A = 48.475;
  const LOOP_LEN = 128;
  const copies = Math.max(1, Math.ceil(total / (LOOP_LEN - 2)) + 1);
  const mins = [];
  let mf = '';
  for (let k = 0; k < copies; k++) mins.push('-ss', String(LOOP_A), '-t', String(LOOP_LEN), '-i', MUSIC);
  mf = `[1:a]anull[m0]`;
  for (let k = 1; k < copies; k++) mf += `;[m${k - 1}][${k + 1}:a]acrossfade=d=2:c1=tri:c2=tri[m${k}]`;
  mf += `;[m${copies - 1}]atrim=0:${total.toFixed(3)},aformat=channel_layouts=stereo:sample_rates=48000,volume='if(lt(t,7.6),0.6,0.09)':eval=frame,afade=t=out:st=${(total - 4).toFixed(3)}:d=4[mus]`;
  // the voice ducks the music: loud alone (the opener), quiet under the narrator
  mf += `;[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo:sample_rates=48000,asplit=2[voice][key];[mus][key]sidechaincompress=threshold=0.02:ratio=10:attack=12:release=700:makeup=1[duck];[voice][duck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[out]`;
  ff(['-i', joined, ...mins, '-filter_complex', mf, '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final], 'music');
} else {
  console.warn(`no music at ${MUSIC}: the video has the narration only`);
  fs.copyFileSync(joined, final);
}
console.log(`\n${final}\n${Math.floor(total / 60)} min ${Math.round(total % 60)} s`);
