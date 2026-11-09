// Combine the walkthrough clips into ONE video with title cards, voice-over and background music.
//
//   node scripts/record_walkthrough.mjs                                  (records the clips)
//   python scripts/walkthrough_voice_online.py recordings/<dir>   (realistic online voice, preferred)
//   or: powershell -File scripts/walkthrough_voice.ps1 -OutDir recordings/<dir>   (offline Windows voice)
//   node scripts/make_walkthrough_video.mjs recordings/<dir>
//
// Output: recordings/<dir>/OpenQZ-walkthrough.mp4 (1920x1080, H.264 video, AAC audio), or .webm
// (VP9, Opus) where the browser engine cannot write MP4.
// It plays the clips in the browser engine, draws them onto a canvas and records canvas + audio in
// real time (no video tools needed). The music is generated here (original, no licence needed) and
// is lowered while the narrator speaks.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const dir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(path.join(dir, 'index.html'))) {
  console.error('usage: node scripts/make_walkthrough_video.mjs recordings/<date-time>');
  process.exit(1);
}
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const narration = JSON.parse(fs.readFileSync(path.join(here, 'walkthrough_narration.json'), 'utf8'));
const segments = narration.segments.map((s) => ({
  ...s,
  clip: fs.existsSync(path.join(dir, `${s.id}.webm`)) ? `${s.id}.webm` : null,
  // the online neural voice (mp3) wins over the offline Windows voice (wav)
  voice: [`voice-${s.id}.mp3`, `voice-${s.id}.wav`].find((f) => fs.existsSync(path.join(dir, f))) ?? null,
  phone: /student|room-join/.test(s.id),
}));
const missing = segments.filter((s) => !s.voice).map((s) => s.id);
if (missing.length) console.warn(`no voice for: ${missing.join(', ')} (run walkthrough_voice.ps1 first)`);

const outFile = path.join(dir, 'OpenQZ-walkthrough.part'); // renamed to .mp4 or .webm at the end
fs.rmSync(outFile, { force: true });

// ---------------------------------------------------------------- local server: files, page, upload
const TYPES = { '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && url === '/__chunk') {
    const out = fs.createWriteStream(outFile, { flags: 'a' });
    req.pipe(out);
    out.on('finish', () => res.end('ok'));
    return;
  }
  if (url === '/__compose') {
    res.setHeader('content-type', 'text/html');
    return res.end(PAGE);
  }
  const f = path.join(dir, path.basename(url));
  if (!fs.existsSync(f)) return res.writeHead(404).end();
  res.setHeader('content-type', TYPES[path.extname(f)] ?? 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- the compositor (runs in the page)
const PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1920" height="1080"></canvas>
<script>
const SEGMENTS = ${JSON.stringify(segments)};
const W = 1920, H = 1080, BRAND = '#5b3fd6';
const c = document.getElementById('c'), g = c.getContext('2d');
const ac = new AudioContext({ sampleRate: 48000 });
const dest = ac.createMediaStreamDestination();
const master = ac.createGain(); master.gain.value = 0.9; master.connect(dest);
const musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
const voiceBus = ac.createGain(); voiceBus.gain.value = 1.0; voiceBus.connect(master);

// ---------- music: a calm, original chord loop (pads + soft plucks)
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[48, 55, 60, 64, 67, 71], [45, 52, 57, 60, 64, 67], [41, 48, 53, 57, 60, 64], [43, 50, 55, 59, 62, 67]]; // Cmaj7 Am7 Fmaj7 G
const BAR = 4.0;
const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(musicBus);
function pad(t, notes) {
  for (const n of notes.slice(0, 4)) for (const det of [-6, 6]) {
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(n); o.detune.value = det;
    const e = ac.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.045, t + 1.2); e.gain.setValueAtTime(0.045, t + BAR - 0.6); e.gain.linearRampToValueAtTime(0, t + BAR + 0.4);
    o.connect(e).connect(lp); o.start(t); o.stop(t + BAR + 0.5);
  }
  const b = ac.createOscillator(); b.type = 'sine'; b.frequency.value = NOTE(notes[0] - 12);
  const be = ac.createGain(); be.gain.setValueAtTime(0, t); be.gain.linearRampToValueAtTime(0.09, t + 0.3); be.gain.exponentialRampToValueAtTime(0.001, t + BAR);
  b.connect(be).connect(musicBus); b.start(t); b.stop(t + BAR);
}
function pluck(t, n, v) {
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(n);
  const e = ac.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(v, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
  o.connect(e).connect(musicBus); o.start(t); o.stop(t + 1);
}
let nextBar = 0, bar = 0;
function scheduleMusic() {
  while (nextBar < ac.currentTime + 2) {
    const ch = CHORDS[bar % CHORDS.length];
    pad(nextBar, ch);
    const arp = [ch[2], ch[3], ch[4], ch[5], ch[4], ch[3], ch[2], ch[3]];
    arp.forEach((n, i) => pluck(nextBar + i * (BAR / 8), n + 12, i % 4 === 0 ? 0.05 : 0.03));
    nextBar += BAR; bar++;
  }
}
function musicLevel(v, secs = 0.6) { musicBus.gain.cancelScheduledValues(ac.currentTime); musicBus.gain.setTargetAtTime(v, ac.currentTime, secs / 3); }
const MUSIC_UP = 0.55, MUSIC_UNDER_VOICE = 0.16;

// ---------- drawing helpers
function bg() {
  const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1a1240'); gr.addColorStop(0.55, '#2a1b6e'); gr.addColorStop(1, '#4a2bb0');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.arc(W - 160, 120, 300, 0, 7); g.fill(); g.beginPath(); g.arc(180, H - 60, 240, 0, 7); g.fill();
}
function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function logo(x, y, s) {
  g.fillStyle = BRAND; rr(x, y, s, s, s * 0.24); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = s * 0.11; g.beginPath(); g.arc(x + s * 0.47, y + s * 0.47, s * 0.24, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(x + s * 0.6, y + s * 0.6); g.lineTo(x + s * 0.76, y + s * 0.76); g.stroke();
}
function text(t, x, y, size, weight = 700, color = '#fff', align = 'center') {
  g.font = weight + ' ' + size + 'px "Segoe UI", system-ui, sans-serif'; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y);
}
function card(seg, fade) {
  bg();
  const big = seg.id === 'intro' || seg.id === 'outro';
  if (big) { logo(W / 2 - 70, H / 2 - 230, 140); text(seg.title, W / 2, H / 2 - 40, 110, 800); text(seg.subtitle, W / 2, H / 2 + 60, 40, 500, '#d9ceff'); text('Open Source Students Club | DBIT', W / 2, H - 90, 28, 600, 'rgba(255,255,255,0.6)'); }
  else { logo(W / 2 - 45, H / 2 - 190, 90); text(seg.title, W / 2, H / 2 - 30, 76, 800); text(seg.subtitle, W / 2, H / 2 + 55, 38, 500, '#d9ceff'); }
  if (fade < 1) { g.fillStyle = 'rgba(0,0,0,' + (1 - fade) + ')'; g.fillRect(0, 0, W, H); }
}
function frame(seg, video, fade) {
  bg();
  if (seg.phone) {
    const h = 960, w = Math.round(h * video.videoWidth / video.videoHeight), x = 1080, y = 60;
    g.fillStyle = '#0c0a1a'; rr(x - 18, y - 18, w + 36, h + 36, 56); g.fill();
    g.save(); rr(x, y, w, h, 40); g.clip(); g.drawImage(video, x, y, w, h); g.restore();
    logo(170, 330, 84); text(seg.title, 170, 470, 58, 800, '#fff', 'left'); text(seg.subtitle, 170, 540, 34, 500, '#d9ceff', 'left');
    text('On a phone', 170, 620, 26, 600, 'rgba(255,255,255,0.55)', 'left');
  } else {
    const w = 1680, h = Math.round(w * video.videoHeight / video.videoWidth), x = (W - w) / 2, y = 30;
    g.fillStyle = 'rgba(0,0,0,0.35)'; rr(x + 10, y + 14, w, h, 22); g.fill();
    g.save(); rr(x, y, w, h, 18); g.clip(); g.drawImage(video, x, y, w, h); g.restore();
    text(seg.title, x, y + h + 26, 26, 700, 'rgba(255,255,255,0.85)', 'left');
  }
  if (fade < 1) { g.fillStyle = 'rgba(0,0,0,' + (1 - fade) + ')'; g.fillRect(0, 0, W, H); }
}

// ---------- timeline
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const buffers = {};
async function loadVoice(f) { if (!f) return null; const b = await (await fetch(f)).arrayBuffer(); return ac.decodeAudioData(b); }
function playVoice(buf) {
  if (!buf) return Promise.resolve();
  const s = ac.createBufferSource(); s.buffer = buf; s.connect(voiceBus);
  musicLevel(MUSIC_UNDER_VOICE, 0.5); s.start();
  return new Promise((r) => (s.onended = () => { musicLevel(MUSIC_UP, 1.2); r(); }));
}
let draw = () => {};
(function loop() { draw(); requestAnimationFrame(loop); })();

async function showCard(seg, secs, voice) {
  const t0 = performance.now();
  draw = () => card(seg, Math.min(1, (performance.now() - t0) / 500));
  const v = voice ? playVoice(voice) : null;
  await Promise.all([sleep(secs * 1000), v]);
}
async function showClip(seg, voice) {
  const video = document.createElement('video'); video.src = seg.clip; video.muted = true; video.playsInline = true;
  await new Promise((r) => (video.oncanplay = r));
  // skip the recording browser's blank page before the app loads (a grey flash otherwise)
  video.currentTime = 1.0;
  await new Promise((r) => (video.onseeked = r));
  const t0 = performance.now();
  draw = () => frame(seg, video, Math.min(1, (performance.now() - t0) / 450));
  const ended = new Promise((r) => (video.onended = r));
  await video.play();
  await sleep(700);
  const v = playVoice(voice);
  await Promise.all([ended, v.then(() => sleep(900))]); // a short clip waits on its last frame for the narrator
  await sleep(500);
}

window.run = async () => {
  await ac.resume();
  for (const s of SEGMENTS) buffers[s.id] = await loadVoice(s.voice);
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 160_000 });
  let queue = Promise.resolve();
  rec.ondataavailable = (e) => { if (e.data.size) { const d = e.data; queue = queue.then(() => fetch('/__chunk', { method: 'POST', body: d })); } };
  const stopped = new Promise((r) => (rec.onstop = r));
  const musicTimer = setInterval(scheduleMusic, 250);
  nextBar = ac.currentTime + 0.1; scheduleMusic();
  rec.start(1000);
  musicLevel(MUSIC_UP, 2.5);
  for (const seg of SEGMENTS) {
    console.log('segment ' + seg.id);
    if (!seg.clip) { await showCard(seg, Math.max(4, (buffers[seg.id]?.duration ?? 0) + 2), buffers[seg.id]); continue; }
    if (!seg.id.startsWith('06b')) await showCard(seg, 2.8, null);
    await showClip(seg, buffers[seg.id]);
  }
  musicLevel(0, 2.5); await sleep(3000);
  clearInterval(musicTimer);
  rec.stop(); await stopped; await queue;
  return mime;
};
</script></body></html>`;

// ---------------------------------------------------------------- run it
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', (m) => console.log(m.text()));
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${base}/__compose`);
const started = Date.now();
const mime = await page.evaluate(() => window.run(), null);
await browser.close();
server.close();
const final = path.join(dir, `OpenQZ-walkthrough.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
fs.renameSync(outFile, final);
const mb = (fs.statSync(final).size / 1e6).toFixed(1);
console.log(`\n${final}\n${mime}, ${Math.round((Date.now() - started) / 1000)} s, ${mb} MB`);
