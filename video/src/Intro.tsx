import { AlignLeft, CheckSquare, ClipboardList, Eye, Hash, Image as ImageIcon, Layers, ListChecks, Lock, MessageSquareQuote, MonitorSmartphone, MousePointer2, PieChart, Play, RotateCcw, ScrollText, ShieldCheck, Shuffle, Star, TextCursorInput, Timer, ToggleLeft, Unlock, Maximize2, type LucideIcon } from 'lucide-react';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { AbsoluteFill, Audio, Easing, Series, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

/* The OpenQZ walkthrough. Cut like a product film: hard cuts between plum and cream screens,
   short statements, icons and chips that snap in, product close-ups, a results dashboard.
   Every motion is a spring or an eased interpolate on the current frame, and every scene
   lasts a whole number of beats of the soundtrack (120 BPM: one beat is 15 frames). */

const PLUM = '#3b142a';
const CREAM = '#f3efda';
const PINK = '#ff2e93';
const PINK_DEEP = '#d6177f';
const MINT = '#a6e6df';
const PEACH = '#ffc48a';
const TILES = ['#1a73e8', '#12b5a6', '#f7931e', '#e8481c'];
const FONT = "'DM Sans Variable', Arial, sans-serif";

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

function useS(delay = 0, damping = 13, stiffness = 170) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness, mass: 0.7 } });
}

const BEAT = 15;
/** Which scene of the cut is on screen (used to vary wipes and backdrops). */
const SceneIndex = createContext(0);

/** 1 on the beat, falling to 0 before the next one. */
function useBeat() {
  const frame = useCurrentFrame();
  return Math.pow(1 - (frame % BEAT) / BEAT, 2.2);
}

/** Shapes drifting behind the content and breathing with the beat. */
function Backdrop({ dark, seed }: { dark: boolean; seed: number }) {
  const frame = useCurrentFrame();
  const beat = useBeat();
  const tone = dark ? 'rgba(255,46,147,0.10)' : 'rgba(59,20,42,0.04)';
  const tone2 = dark ? 'rgba(243,239,218,0.045)' : 'rgba(214,23,127,0.06)';
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {[0, 1, 2].map((k) => {
        // three soft lights that wander slowly: the gradient never sits still
        const a = frame * 0.012 + seed * 1.7 + k * 2.1;
        const x = 50 + Math.cos(a) * 34 + Math.sin(a * 0.6) * 10;
        const y = 55 + Math.sin(a * 0.8) * 30;
        const colors = dark ? ['rgba(255,46,147,0.42)', 'rgba(163,51,111,0.55)', 'rgba(120,60,200,0.30)'] : ['rgba(255,196,138,0.50)', 'rgba(255,160,205,0.38)', 'rgba(166,230,223,0.40)'];
        return <div key={`g${k}`} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: 760, height: 760, marginLeft: -380, marginTop: -380, borderRadius: '50%', background: `radial-gradient(closest-side, ${colors[k]}, transparent)` }} />;
      })}
    </AbsoluteFill>
  );
}

/** A full screen of one colour: a quiet moving backdrop and a slow push of the camera. Scenes
 * change with a clean cut; the new one settles in over a few frames. */
function Screen({ bg, children, style, zoom = 1 }: { bg: string; children: ReactNode; style?: CSSProperties; zoom?: number }) {
  const frame = useCurrentFrame();
  const index = useContext(SceneIndex);
  const pop = interpolate(frame, [0, 9], [1.025, 1], { ...clamp, easing: ease });
  const push = 1 + frame * 0.00045;
  const drift = Math.sin(frame * 0.02 + index) * 6;
  const dark = bg === PLUM;
  return (
    <AbsoluteFill style={{ background: bg, color: dark ? CREAM : PLUM, fontFamily: FONT, alignItems: 'center', justifyContent: 'center', ...style }}>
      <Backdrop dark={dark} seed={index} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${pop * push * zoom}) translate(${drift}px, ${-drift * 0.5}px)` }}>{children}</AbsoluteFill>
      {/* a soft vignette keeps the eye in the middle */}
      <AbsoluteFill style={{ background: dark ? 'radial-gradient(75% 75% at 50% 50%, transparent 55%, rgba(0,0,0,0.28))' : 'radial-gradient(75% 75% at 50% 50%, transparent 60%, rgba(59,20,42,0.07))', pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
}

/** A burst of confetti from a point. */
function Confetti({ at, x = 640, y = 360, count = 46, power = 1 }: { at: number; x?: number; y?: number; count?: number; power?: number }) {
  const frame = useCurrentFrame() - at;
  if (frame < 0 || frame > 50) return null;
  const palette = [PINK, '#f7c531', '#34c98b', '#1a73e8', CREAM, '#f7931e'];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }, (_, k) => {
        const angle = random(`a${k}`) * Math.PI * 2;
        const speed = (7 + random(`s${k}`) * 15) * power;
        const px = x + Math.cos(angle) * speed * frame * (1 - frame / 130);
        const py = y + Math.sin(angle) * speed * frame * (1 - frame / 130) + 0.22 * frame * frame;
        const size = 8 + random(`z${k}`) * 12;
        return <div key={k} style={{ position: 'absolute', left: px, top: py, width: size, height: size * (k % 2 ? 0.45 : 1), borderRadius: k % 3 === 0 ? '50%' : 2, background: palette[k % palette.length], opacity: interpolate(frame, [30, 50], [1, 0], clamp), transform: `rotate(${frame * (10 + random(`r${k}`) * 20)}deg)` }} />;
      })}
    </AbsoluteFill>
  );
}

/** One statement, centred. Words rise in one after another, already visible on the first
 * frame of the scene; `mark` puts a solid pill of colour behind one word (counting from 0). */
function Say({ text, size = 104, gap = 3, delay = 0, color, mark }: { text: string; size?: number; gap?: number; delay?: number; color?: string; mark?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `${size * 0.1}px ${size * 0.26}px`, maxWidth: 1120, fontSize: size, fontWeight: 700, letterSpacing: -size * 0.035, lineHeight: 1.04, color, textAlign: 'center' }}>
      {text.split(' ').map((w, wi) => {
        const start = delay + wi * gap;
        // starts a few frames "before" the scene so the first frame is never empty
        const s = spring({ frame: frame - start + 3, fps, config: { damping: 20, stiffness: 230, mass: 0.6 } });
        const band = interpolate(frame, [start + 5, start + 13], [0, 1], { ...clamp, easing: ease });
        const marked = mark === wi;
        return (
          <span key={wi} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap', opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * size * 0.3}px)` }}>
            {marked && <span style={{ position: 'absolute', left: -size * 0.12, right: -size * 0.12, top: size * 0.06, bottom: -size * 0.02, borderRadius: size * 0.16, background: PINK_DEEP, transformOrigin: 'left center', transform: `scaleX(${band})` }} />}
            <span style={{ position: 'relative', color: marked && band > 0.5 ? '#fff' : undefined }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
}

/** A number that counts up quickly and lands. */
function Roll({ value, delay = 0, suffix = '' }: { value: number; delay?: number; suffix?: string }) {
  const frame = useCurrentFrame();
  const n = Math.round(interpolate(frame, [delay, delay + 18], [0, value], { ...clamp, easing: Easing.out(Easing.cubic) }));
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {n}
      {suffix}
    </span>
  );
}

/** An app window around a product moment: it leans back, then settles flat. */
function Window({ children, title, width = 900, from = 0 }: { children: ReactNode; title: string; width?: number; from?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - from, fps, config: { damping: 20, stiffness: 150, mass: 0.8 } });
  return (
    <div style={{ perspective: 1600 }}>
      <div style={{ width, borderRadius: 18, overflow: 'hidden', background: '#fff', color: PLUM, boxShadow: '0 40px 90px -30px rgba(59,20,42,0.6), 0 0 0 1px rgba(59,20,42,0.08)', transform: `rotateX(${(1 - s) * 14}deg) rotateY(${(1 - s) * -8}deg) translateY(${(1 - s) * 50}px) scale(${0.93 + s * 0.07})` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#f6f2e4', borderBottom: '1px solid #e4dfc8' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
          <span style={{ marginLeft: 12, fontSize: 16, fontWeight: 600, color: 'rgba(59,20,42,0.55)' }}>{title}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A feature chip: label and its icon on a small coloured square. */
function Chip({ label, icon: Icon, color = PINK, size = 30, light = false }: { label: string; icon: LucideIcon; color?: string; size?: number; light?: boolean }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.4, padding: `${size * 0.26}px ${size * 0.3}px ${size * 0.26}px ${size * 0.5}px`, borderRadius: size * 0.24, background: light ? '#fbf9ee' : CREAM, color: PLUM, fontSize: size, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 1px 0 rgba(59,20,42,0.10), 0 10px 24px -14px rgba(59,20,42,0.45)' }}>
      {label}
      <span style={{ width: size * 1.2, height: size * 1.2, borderRadius: size * 0.24, background: color, color: '#fff', display: 'grid', placeItems: 'center' }}>
        <Icon size={size * 0.74} strokeWidth={2.4} />
      </span>
    </div>
  );
}

const CHIPS: [string, LucideIcon, string][] = [
  ['Multiple choice', CheckSquare, '#e8336d'],
  ['True / False', ToggleLeft, '#12b5a6'],
  ['Multi-select', ListChecks, '#1a73e8'],
  ['Fill in the blanks', TextCursorInput, '#f7931e'],
  ['Justify your answer', MessageSquareQuote, '#8b5cf6'],
  ['Open ended', AlignLeft, '#e8481c'],
  ['Rubrics', Star, '#12b5a6'],
  ['Images', ImageIcon, '#1a73e8'],
  ['Timers', Timer, '#e8336d'],
  ['Marks', Hash, '#f7931e'],
  ['Polls', PieChart, '#8b5cf6'],
  ['Flashcards', Layers, '#e8481c'],
];

// ---------------------------------------------------------------- scenes

/** Four kinds of activity; the cursor comes in and picks Quiz. */
function Kinds() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const kinds: [string, LucideIcon, string][] = [
    ['Quiz', ListChecks, '#22c55e'],
    ['Assignment', ClipboardList, '#f7931e'],
    ['Poll', PieChart, '#e8336d'],
    ['Flashcards', Layers, '#1a73e8'],
    ['Live game', Play, '#8b5cf6'],
  ];

  const cx = interpolate(frame, [18, 44], [760, 262], { ...clamp, easing: ease });
  const cy = interpolate(frame, [18, 44], [540, 346], { ...clamp, easing: ease });
  const click = spring({ frame: frame - 48, fps, config: { damping: 9, stiffness: 240 } });
  return (
    <Screen bg={PLUM} zoom={1.18} style={{ background: `linear-gradient(180deg, ${PLUM} 55%, #8a2a62 135%)` }}>
      <div style={{ display: 'flex', gap: 56 }}>
        {kinds.map(([name, KindIcon, color], i) => {
          const s = spring({ frame: frame + 4 - i * 3, fps, config: { damping: 14, stiffness: 200 } });
          const picked = i === 0 ? click : 0;
          return (
            <div key={name} style={{ textAlign: 'center', opacity: s, transform: `translateY(${(1 - s) * 40}px) scale(${1 + picked * 0.18})` }}>
              <div style={{ width: 96, height: 96, margin: '0 auto', borderRadius: 20, background: color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 52, fontWeight: 800, transform: `rotate(${(i - 2) * 4}deg)`, boxShadow: picked ? `0 0 0 ${picked * 8}px rgba(255,255,255,0.25)` : 'none' }}><KindIcon size={50} strokeWidth={2.4} /></div>
              <div style={{ marginTop: 16, fontSize: 28, fontWeight: 600 }}>{name}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: cx, top: cy, transform: `scale(${1 - click * 0.18})`, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.35))' }}>
        <MousePointer2 size={54} fill="#fff" color={PLUM} strokeWidth={1.4} />
      </div>
    </Screen>
  );
}

/** A big number counting up, then its label. */
function Count({ to, label, bg = CREAM }: { to: number; label: string; bg?: string }) {
  const s = useS(2);
  return (
    <Screen bg={bg}>
      <div style={{ fontSize: 250, fontWeight: 700, letterSpacing: -8, lineHeight: 1, color: bg === CREAM ? '#7a1f55' : PINK, }}>
        <Roll value={to} />
      </div>
      <div style={{ fontSize: 46, fontWeight: 600, marginTop: 6, opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>{label}</div>
    </Screen>
  );
}

/** Chips drop in one under another. */
function ChipStack() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Screen bg={PLUM} zoom={1.25}>
      <div style={{ display: 'grid', gap: 18, justifyItems: 'start' }}>
        {CHIPS.slice(0, 3).map(([label, icon, color], i) => {
          const s = spring({ frame: frame + 3 - i * 8, fps, config: { damping: 15, stiffness: 220 } });
          return (
            <div key={label} style={{ opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * -60}px) rotate(${(1 - s) * -6}deg)` }}>
              <Chip label={label} icon={icon} color={color} size={46} />
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

/** A wall of chips: rows sliding left and right while the whole wall pulls back. */
function ChipWall() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 70], [1.5, 1], { ...clamp, easing: ease });
  const rows = 8;
  return (
    <Screen bg={PLUM}>
      <div style={{ transform: `scale(${zoom})`, display: 'grid', gap: 16, width: 1600 }}>
        {Array.from({ length: rows }, (_, r) => {
          const dir = r % 2 === 0 ? -1 : 1;
          const x = dir * frame * 2.2 + (dir < 0 ? 0 : -400) - r * 60;
          const list = [...CHIPS.slice(r % 5), ...CHIPS, ...CHIPS];
          return (
            <div key={r} style={{ display: 'flex', gap: 16, transform: `translateX(${x}px)` }}>
              {list.map(([label, icon, color], i) => (
                <Chip key={i} label={label} icon={icon} color={color} size={27} />
              ))}
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

/** Close-up of the import box: the link types itself and the button is pressed. */
function ImportForm() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const link = 'docs.google.com/forms/d/e/1FAIpQL.../viewform';
  const typed = link.slice(0, Math.round(interpolate(frame, [8, 52], [0, link.length], clamp)));
  const press = spring({ frame: frame - 60, fps, config: { damping: 9, stiffness: 230 } });
  const pan = interpolate(frame, [0, 80], [40, -30], { ...clamp, easing: ease });
  return (
    <Screen bg={CREAM} zoom={1.12} style={{ background: `linear-gradient(160deg, ${CREAM} 40%, #f8d9c4 110%)` }}>
      <div style={{ transform: `translateX(${pan}px) scale(1.18)`, width: 900 }}>
        <div style={{ fontSize: 40, fontWeight: 600, color: 'rgba(59,20,42,0.5)', textAlign: 'center', marginBottom: 18 }}>Import from a Google Form</div>
        <Window title="OpenQZ | Import questions" width={900}>
        <div style={{ background: '#fff', padding: 30 }}>
          <div style={{ fontSize: 34, fontWeight: 500, minHeight: 46, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {typed}
            <span style={{ opacity: Math.floor(frame / 8) % 2 ? 0 : 1, color: PINK_DEEP }}>|</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 26 }}>
            {['Spreadsheet', 'Paste text'].map((t) => (
              <span key={t} style={{ border: '2px solid #e4dfc8', borderRadius: 10, padding: '10px 18px', fontSize: 24, fontWeight: 600 }}>{t}</span>
            ))}
            <span style={{ marginLeft: 'auto', background: PINK_DEEP, color: '#fff', borderRadius: 10, padding: '14px 28px', fontSize: 28, fontWeight: 700, transform: `scale(${1 - press * 0.08 + Math.max(0, press - 0.7) * 0.25})` }}>Read questions</span>
          </div>
        </div>
        </Window>
      </div>
    </Screen>
  );
}

/** "Or host a [room card] room": the card opens the sentence while the screen changes colour. */
function HostRoom() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const open = spring({ frame: frame + 2, fps, config: { damping: 18, stiffness: 170 } });
  const bg = frame < 30 ? CREAM : frame < 60 ? MINT : PEACH;
  const code = frame < 60 ? '482 913' : '706 154';
  const badges = ['Join with a code', 'Scan the QR', 'Guests welcome'];
  return (
    <Screen bg={bg} zoom={1.12}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 92, fontWeight: 700, letterSpacing: -3.5 }}>
        <span>Or host a</span>
        <div style={{ width: open * 330, overflow: 'hidden', opacity: open }}>
          <div style={{ width: 330, background: '#fbf9ee', borderRadius: 18, padding: '18px 22px', boxShadow: '0 14px 30px -14px rgba(59,20,42,0.4)' }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: 0, color: 'rgba(59,20,42,0.6)' }}>Join code</div>
            <div style={{ fontSize: 62, fontWeight: 700, letterSpacing: 2, lineHeight: 1.05 }}>{code}</div>
          </div>
        </div>
        <span>room</span>
      </div>
      <div style={{ position: 'absolute', top: 196, display: 'flex', gap: 300 }}>
        {badges.slice(0, 1).map((b) => (
          <span key={b} style={{ background: '#fff', borderRadius: 999, padding: '8px 18px', fontSize: 22, fontWeight: 600, opacity: open, transform: `scale(${open})` }}>{b}</span>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 190, display: 'flex', gap: 110 }}>
        {badges.slice(1).map((b, i) => {
          const s = spring({ frame: frame - 30 - i * 6, fps, config: { damping: 11, stiffness: 200 } });
          return (
            <span key={b} style={{ background: '#fff', borderRadius: 999, padding: '8px 18px', fontSize: 22, fontWeight: 600, transform: `scale(${s})` }}>{b}</span>
          );
        })}
      </div>
    </Screen>
  );
}

/** The question card on the left, a big quiet word on the right that keeps changing. */
function QuestionAnd() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = ['Timed', 'Full screen', 'One attempt'];
  const each = 40;
  const which = Math.min(words.length - 1, Math.floor(frame / each));
  const local = frame - which * each;
  const wordIn = spring({ frame: local, fps, config: { damping: 14, stiffness: 180 } });
  const options = ['Rectangle', 'Triangle', 'Square', 'Circle'];
  const slide = spring({ frame: frame + 6, fps, config: { damping: 20, stiffness: 160 } });
  const pick = spring({ frame: frame - 84, fps, config: { damping: 10, stiffness: 200 } });
  const timer = interpolate(frame, [0, 110], [1, 0.15], clamp);
  return (
    <Screen bg={CREAM} zoom={1.03}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 46 }}>
        <div style={{ width: 620, background: PLUM, borderRadius: 16, padding: 26, color: CREAM, transform: `translateX(${(1 - slide) * -260}px)`, boxShadow: '0 22px 50px -22px rgba(59,20,42,0.6)' }}>
          <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.15)', overflow: 'hidden', opacity: which === 0 ? 1 : 0.35 }}>
            <div style={{ width: `${timer * 100}%`, height: '100%', background: timer < 0.4 ? PINK : '#34d399' }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 500, textAlign: 'center', padding: '34px 0 30px' }}>Which shape has 3 sides?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {options.map((o, i) => (
              <div key={o} style={{ background: TILES[i], color: '#fff', borderRadius: 8, padding: '46px 4px', textAlign: 'center', fontSize: 23, fontWeight: 700, transform: i === 1 ? `scale(${1 + pick * 0.08})` : 'none', outline: i === 1 ? `${pick * 5}px solid #fff` : 'none', opacity: i === 1 ? 1 : 1 - pick * 0.5 }}>{o}</div>
            ))}
          </div>
        </div>
        <div style={{ width: 440, whiteSpace: 'nowrap', fontSize: 66, fontWeight: 700, letterSpacing: -2.4, color: 'rgba(59,20,42,0.28)', opacity: wordIn, transform: `translateY(${(1 - wordIn) * 30}px)` }}>{words[which]}</div>
      </div>
    </Screen>
  );
}

/** A phrase in the middle, chips arriving all around it. */
function FairCloud() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chips: [string, number, number, LucideIcon][] = [
    ['Server timers', -360, -210, Timer],
    ['Tab switches counted', 170, -220, Eye],
    ['Full screen', -430, -120, Maximize2],
    ['One attempt each', 300, -125, RotateCcw],
    ['Answer keys stay hidden', -400, 112, Lock],
    ['Second device noticed', 250, 105, MonitorSmartphone],
    ['Unblock a student', -330, 200, Unlock],
    ['Integrity log', 150, 205, ScrollText],
    ['Shuffled questions', -110, -262, Shuffle],
    ['Auto-submit', -60, 262, ShieldCheck],
  ];

  return (
    <Screen bg={CREAM} zoom={1.04}>
      <Say text="and it stays fair" size={76} mark={3} />
      {chips.map(([label, x, y, icon], i) => {
        const s = spring({ frame: frame - 4 - i * 2, fps, config: { damping: 16, stiffness: 200 } });
        return (
          <div key={label} style={{ position: 'absolute', left: 640 + x, top: 360 + y, opacity: s, transform: `translate(-50%, -50%) scale(${0.6 + s * 0.4}) translateY(${(1 - s) * 30}px)` }}>
            <Chip label={label} icon={icon} color={PINK_DEEP} size={26} light />
          </div>
        );
      })}
    </Screen>
  );
}

/** The report: accuracy counts up, the bar fills, students arrive in rows. */
function Dashboard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pct = Math.round(interpolate(frame, [8, 50], [0, 67], { ...clamp, easing: Easing.out(Easing.cubic) }));
  const grow = interpolate(frame, [12, 56], [0, 1], { ...clamp, easing: ease });
  const bands: [number, string, string][] = [
    [18, '#e8336d', '11 need help'],
    [25, '#f7c531', '16 partly there'],
    [45, '#34c98b', '28 got it'],
    [12, '#1a73e8', '7 full marks'],
  ];
  const students: [string, number[]][] = [
    ['Asha K', [10, 20, 55, 15]],
    ['Bharath M', [15, 35, 40, 10]],
    ['Chitra R', [30, 30, 30, 10]],
  ];
  const zoom = interpolate(frame, [0, 110], [1.1, 1.04], { ...clamp, easing: ease });
  return (
    <Screen bg={CREAM}>
      <div style={{ transform: `scale(${zoom})` }}>
      <Window title="OpenQZ | Report" width={880}>
      <div style={{ padding: 34 }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontWeight: 700 }}>
          Overview
          <span style={{ marginLeft: 'auto', background: PINK_DEEP, color: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 20 }}>Excel</span>
        </div>
        <div style={{ fontSize: 96, fontWeight: 700, color: '#e8601c', letterSpacing: -3, lineHeight: 1.05, marginTop: 8 }}>{pct}%</div>
        <div style={{ fontSize: 20, color: 'rgba(59,20,42,0.6)' }}>average marks obtained</div>
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', marginTop: 16, width: `${grow * 100}%` }}>
          {bands.map(([w, c]) => (
            <div key={c} style={{ width: `${w}%`, background: c }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 14, fontSize: 19, fontWeight: 600 }}>
          {bands.map(([, c, label], i) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: interpolate(frame, [40 + i * 5, 50 + i * 5], [0, 1], clamp) }}>
              <i style={{ width: 8, height: 22, borderRadius: 4, background: c, display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 26, display: 'grid', gap: 16 }}>
          {students.map(([name, parts], r) => {
            const s = spring({ frame: frame - 58 - r * 8, fps, config: { damping: 14, stiffness: 140 } });
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 18, opacity: s, transform: `translateX(${(1 - s) * 50}px)` }}>
                <span style={{ width: 150, fontSize: 21, fontWeight: 600 }}>{name}</span>
                <div style={{ flex: 1, display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', width: `${s * 100}%` }}>
                  {parts.map((w, i) => (
                    <div key={i} style={{ width: `${w * s}%`, background: bands[i][1] }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </Window>
      </div>
    </Screen>
  );
}

/** Who built it: two numbers, then the credit. */
function Credits() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tiles: [number, string, string, string][] = [
    [10, '', 'developers', PLUM],
    [50, '+', 'hours of building', PINK_DEEP],
  ];
  const line = spring({ frame: frame - 26, fps, config: { damping: 18, stiffness: 170 } });
  const line2 = spring({ frame: frame - 38, fps, config: { damping: 18, stiffness: 170 } });
  return (
    <Screen bg={CREAM} zoom={1.02}>
      <div style={{ display: 'flex', gap: 26 }}>
        {tiles.map(([to, suffix, label, bg], i) => {
          const s = spring({ frame: frame + 4 - i * 5, fps, config: { damping: 16, stiffness: 200 } });
          return (
            <div key={label} style={{ width: 400, padding: '30px 20px', borderRadius: 18, background: bg, color: i ? '#fff' : CREAM, textAlign: 'center', opacity: s, transform: `translateY(${(1 - s) * 80}px) rotate(${(1 - s) * (i ? 7 : -7)}deg)` }}>
              <div style={{ fontSize: 150, fontWeight: 700, lineHeight: 1, letterSpacing: -5 }}>
                <Roll value={to} delay={i * 5} suffix={suffix} />
              </div>
              <div style={{ fontSize: 34, fontWeight: 600, marginTop: 4 }}>{label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 44, fontSize: 48, fontWeight: 700, letterSpacing: -1.4, opacity: line, transform: `translateY(${(1 - line) * 26}px)` }}>
        Built by the <span style={{ color: PINK_DEEP }}>Open Source Students Club</span>, DBIT
      </div>
      <div style={{ marginTop: 10, fontSize: 30, fontWeight: 500, opacity: line2 * 0.85, transform: `translateY(${(1 - line2) * 18}px)` }}>Maintained by the students and faculty of Don Bosco Institute of Technology</div>
    </Screen>
  );
}

function Outro() {
  const logo = useS(-4, 16, 190);
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [0, 90], [0.3, 1], clamp);
  return (
    <Screen bg={PLUM} style={{ background: `linear-gradient(180deg, ${PLUM} 50%, rgba(163,51,111,${glow}) 140%)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, transform: `scale(${logo})` }}>
        <div style={{ width: 112, height: 112, borderRadius: 28, background: PINK_DEEP, display: 'grid', placeItems: 'center' }}>
          <svg width={68} height={68} viewBox="0 0 64 64">
            <circle cx={28} cy={28} r={16} fill="none" stroke="#fff" strokeWidth={8} />
            <path d="M40 40l14 14" stroke="#fff" strokeWidth={8} strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ fontSize: 124, fontWeight: 700, letterSpacing: -4 }}>
          Open<span style={{ color: PINK }}>QZ</span>
        </div>
      </div>
      <div style={{ marginTop: 34 }}>
        <Say text="Quizzes that play like a game." size={58} delay={10} gap={2} />
        <Say text="Marks that count." size={58} delay={26} gap={2} color={PINK} />
      </div>
      {[ListChecks, ClipboardList, PieChart, Layers, Play, ShieldCheck, Timer, Star].map((Icon, k, all) => {
        const radius = 500;
        const angle = (k / all.length) * Math.PI * 2 + frame * 0.011;
        const inS = spring({ frame: frame + 2 - k * 2, fps: 30, config: { damping: 18, stiffness: 140 } });
        const colors = ['#22c55e', '#f7931e', '#e8336d', '#1a73e8', '#8b5cf6', '#12b5a6', '#e8481c', '#f7c531'];
        return (
          <div key={k} style={{ position: 'absolute', left: 640 + Math.cos(angle) * radius * inS, top: 360 + Math.sin(angle) * radius * 0.56 * inS, width: 92, height: 92, marginLeft: -46, marginTop: -46, borderRadius: 22, background: colors[k], color: '#fff', display: 'grid', placeItems: 'center', opacity: inS * (0.55 + 0.45 * (Math.sin(angle) * 0.5 + 0.5)), transform: `scale(${0.7 + 0.3 * (Math.sin(angle) * 0.5 + 0.5)})`, boxShadow: '0 14px 30px -12px rgba(0,0,0,0.5)' }}>
            <Icon size={48} strokeWidth={2.4} />
          </div>
        );
      })}
    </Screen>
  );
}

// ---------------------------------------------------------------- the cut

// Lengths are in beats (15 frames each); music.py has the same list.
const CUT: [number, () => ReactNode][] = [
  [5, () => <Kinds />],
  [3, () => <Count to={6} label="question types" />],
  [3, () => <ChipStack />],
  [5, () => <ChipWall />],
  [2, () => <Screen bg={CREAM}><Say text="Or import a Google Form" size={92} mark={3} /></Screen>],
  [6, () => <ImportForm />],
  [6, () => <HostRoom />],
  [2, () => <Screen bg={PLUM}><Say text="One activity" size={130} /></Screen>],
  [3, () => <Screen bg={PLUM}><Say text="Fair for every student." size={92} mark={0} /></Screen>],
  [8, () => <QuestionAnd />],
  [5, () => <FairCloud />],
  [2, () => <Screen bg={CREAM}><Say text="See who got it" size={120} /></Screen>],
  [2, () => <Screen bg={PLUM}><Say text="And who didn't" size={120} color={PINK} /></Screen>],
  [8, () => <Dashboard />],
  [8, () => <Credits />],
  [8, () => <Outro />],
];

export const INTRO_FRAMES = CUT.reduce((a, [n]) => a + n, 0) * BEAT;

export function Intro() {
  return (
    <AbsoluteFill style={{ background: PLUM }}>
      <Series>
        {CUT.map(([beats, render], i) => (
          <Series.Sequence key={i} durationInFrames={beats * BEAT}>
            <SceneIndex.Provider value={i}>{render()}</SceneIndex.Provider>
          </Series.Sequence>
        ))}
      </Series>
      <Audio src={staticFile('music.wav')} />
    </AbsoluteFill>
  );
}
