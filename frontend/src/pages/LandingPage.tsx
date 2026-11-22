import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, Compass, GraduationCap, Volume2, VolumeX, KeyRound, LayoutGrid, Maximize2, Menu, Play, RotateCcw, Shield, ShieldCheck, Smartphone, UploadCloud, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { cx } from '../components/ui';
import { Logo } from '../layouts/AppShell';

/* The public front page, laid out the way Wayground lays out its own: a plum header and hero
   with a centred headline and the product video, then cream sections. OpenQZ's own words,
   logo and features. Sections fade in as they are reached ("reduce motion" turns that off). */

const CREAM = 'text-[#f3efda]';

const steps = [
  { title: 'The college', body: 'imports students and faculty, and everyone signs in with their college email or Google.' },
  { title: 'A teacher or club', body: 'builds a quiz, assignment, poll or flashcards, then assigns it to sections or hosts a room with a 6-digit code.' },
  { title: 'Every student', body: 'takes it on a phone or laptop, one question at a time, on a server-kept timer.' },
  { title: 'Marks and reports', body: 'are ready at once: marks obtained, a marking queue, a participant tracker, Excel and CSV.' },
];

const numbers = [
  { value: '10', label: 'developers' },
  { value: '50+', label: 'hours of building' },
  { value: '6', label: 'question types' },
  { value: '100%', label: 'open source' },
];

const features: { title: string; body: string; points: string[] }[] = [
  { title: 'One activity, many ways to run it', body: 'Assign it to your sections with a deadline, open it as a room with a join code, or run it as a live game on the projector.', points: ['Quiz, assignment, poll, flashcards', 'Six question types with rubrics', 'Import from Google Forms or a sheet'] },
  { title: 'Marks you can trust', body: 'One attempt per student, timers kept by the server and answer keys that never leave it early.', points: ['Leaving the quiz is counted', 'Full screen when you ask for it', 'Unblock a student in one click'] },
];

const roles: { role: string; icon: LucideIcon; description: string; guideUrl: string; guideLabel: string }[] = [
  { role: 'For students', icon: GraduationCap, description: 'Join with a code, link or QR. A timed player shows one question at a time, with instant feedback when the teacher allows it, and a review of your marks.', guideUrl: '/guides/student.html', guideLabel: 'Read the student guide' },
  { role: 'For faculty', icon: LayoutGrid, description: 'Six question types, rubrics, a marking queue, an overview grid, Excel and CSV export, import from Google Forms, and a tracker of every participant.', guideUrl: '/guides/faculty.html', guideLabel: 'Read the faculty guide' },
  { role: 'For admins and clubs', icon: Shield, description: 'Import office sheets, manage accounts, read the audit and integrity logs. Clubs host rooms and live games for events and track who took part.', guideUrl: '/guides/admin.html', guideLabel: 'Read the admin guide' },
];

const fair: { title: string; desc: string; icon: LucideIcon }[] = [
  { title: 'Full screen required', desc: 'Questions stay hidden until the student is in full screen, when the teacher asks for it.', icon: Maximize2 },
  { title: 'Leaving is counted', desc: 'Tab or app switches, Back, reloads and a second device are counted by the server, with auto-submit at the teacher limit.', icon: ShieldCheck },
  { title: 'Timers run on the server', desc: 'Deadlines and question timers are kept by the server, with a short allowance for slow networks.', icon: Clock },
  { title: 'One attempt each', desc: 'One attempt per student keeps the assessment fair and the marks clean.', icon: RotateCcw },
  { title: 'Answer keys stay put', desc: 'Keys and rubrics stay on the server and are never sent to students early.', icon: KeyRound },
];

const college: { title: string; desc: string; icon: LucideIcon }[] = [
  { title: 'Branches, semesters, sections', desc: 'Faculty pick the classes they teach, across departments, down to the section.', icon: Compass },
  { title: 'Imports from office sheets', desc: 'Admins bring in students, faculty and subject mappings from CSV or Excel.', icon: UploadCloud },
  { title: 'Installs on phones', desc: 'OpenQZ installs as a light app on Android, iPhone or a laptop. No app store needed.', icon: Smartphone },
];

/** Fades its children up the first time they scroll into view. */
function Reveal({ children, delay = 0, className, as: Tag = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' | 'article' }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={cx('reveal', seen && 'is-seen', className)} style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

/** The walkthrough video, rendered with Remotion from the `video/` folder (`pnpm render`).
 * Null shows a placeholder frame instead. */
const INTRO_VIDEO_URL: string | null = '/landing/intro-v6.mp4';

/** The product video under the headline. A framed placeholder until the video is added. */
function IntroVideo() {
  // People who ask for less motion get a still frame with a play button, not a moving video.
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const video = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    const on = !sound;
    v.muted = !on;
    if (on) {
      v.volume = 0.7;
      void v.play().catch(() => undefined);
    }
    setSound(on);
    wake();
  };
  // The sound button shows like a video player's controls: on touch, mouse movement or scroll,
  // then fades out when nothing happens for a moment (it stays while it has keyboard focus).
  const [awake, setAwake] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const wake = () => {
    setAwake(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAwake(false), 2500);
  };
  useEffect(() => {
    if (reduced) return;
    timer.current = window.setTimeout(() => setAwake(false), 3500);
    const opts = { passive: true } as const;
    window.addEventListener('scroll', wake, opts);
    window.addEventListener('touchstart', wake, opts);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, [reduced]);
  return (
    <div onPointerMove={wake} onPointerDown={wake} className="relative mx-auto max-w-5xl rounded-t-lg border-4 border-b-0 border-[#592643] bg-[#3b142a]">
      {INTRO_VIDEO_URL ? (
        <>
          <video
            ref={video}
            className="aspect-video w-full rounded-t-[2px] bg-[#3b142a]"
            src={INTRO_VIDEO_URL}
            poster="/landing/intro-v6-poster.jpg"
            autoPlay={!reduced}
            muted
            loop
            playsInline
            controls={reduced}
            preload="metadata"
            aria-label="A short walkthrough of OpenQZ with music: pick a kind of activity, import or build questions, host a room with a code, students answer on coloured tiles, and marks appear as they submit"
          />
          {!reduced && (
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={sound}
              onFocus={() => {
                window.clearTimeout(timer.current);
                setAwake(true);
              }}
              onBlur={wake}
              className={cx(
                'absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-md bg-[#f3efda] px-2.5 py-1.5 text-xs font-bold text-[#3b142a] shadow-pop-lg transition-[opacity,background-color] duration-300 hover:bg-white sm:bottom-4 sm:right-4 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm',
                awake ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              {sound ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
              {sound ? 'Sound on' : 'Turn sound on'}
            </button>
          )}
        </>
      ) : (
        <div className="grid aspect-video w-full place-items-center px-4 text-center" role="img" aria-label="Video placeholder: a walkthrough of OpenQZ will be added here">
          <div className={CREAM}>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-600 text-white sm:h-20 sm:w-20">
              <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" aria-hidden />
            </span>
            <p className="mt-5 text-2xl font-bold tracking-tight sm:text-4xl">See OpenQZ in two minutes</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface Person {
  login: string;
  name: string;
  avatar: string | null;
  url: string;
  contributions: number;
}

/** The people who built OpenQZ, from the repository (the server refreshes the list twice a
 * day and keeps the pictures, so this page never calls GitHub). */
function Contributors() {
  const q = useQuery({ queryKey: ['site', 'contributors'], queryFn: () => api<{ people: Person[] }>('/site/contributors'), staleTime: 3_600_000, retry: false });
  const people = q.data?.people ?? [];
  return (
    <section id="contributors" aria-labelledby="contributors-title" className="scroll-mt-20 border-t border-line bg-card">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="contributors-title" className="text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Built by our contributors
          </h2>
          <p className="mt-4 text-lg text-muted">OpenQZ is open source, built and maintained by the Open Source Students Club, DBIT. These are the people who wrote it.</p>
        </Reveal>
        {people.length > 0 ? (
          <ul className="mt-10 flex flex-wrap justify-center gap-4">
            {people.map((p, i) => (
              <Reveal as="li" key={p.login} delay={Math.min(i, 12) * 50}>
                <a href={p.url} target="_blank" rel="noreferrer" className="flex w-40 flex-col items-center rounded-lg border border-edge bg-surface p-5 text-center transition-colors duration-200 hover:border-brand-600 sm:w-44">
                  {p.avatar ? (
                    <img src={p.avatar} alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-full" />
                  ) : (
                    <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-brand-600 text-2xl font-bold text-white" aria-hidden>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="mt-3 w-full truncate font-bold">{p.name}</span>
                  <span className="w-full truncate text-sm text-muted">@{p.login}</span>
                </a>
              </Reveal>
            ))}
          </ul>
        ) : (
          <p className="mt-8 text-center text-muted">{q.isLoading ? 'Loading the list...' : 'The list of contributors will appear here shortly.'}</p>
        )}
      </div>
    </section>
  );
}

const navLink = 'rounded px-3 py-2 text-base font-bold text-[#f3efda] transition-colors hover:text-[#ff5cb0]';
const btnPink = 'inline-flex items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2.5 font-bold text-white transition-colors hover:bg-brand-700';
const btnCream = 'inline-flex items-center justify-center gap-2 rounded-md bg-[#f3efda] px-4 py-2.5 font-bold text-[#3b142a] transition-colors hover:bg-white';

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const nav = useNavigate();
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const enterCode = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    // A live game opens at once (guests welcome); anything else is a room, which asks the
    // student to sign in first.
    api(`/live/join/${code}`)
      .then(() => nav(`/live/${code}`))
      .catch(() => nav(`/join/${code}`));
  };
  const joinInput = useRef<HTMLInputElement>(null);
  /** "Have a code?" lands on the join box of this page, with the cursor already in it. */
  const toJoin = () => {
    setMenuOpen(false);
    setTimeout(() => joinInput.current?.focus({ preventScroll: true }), 450);
  };
  const links: [string, string][] = [
    ['#how-to-use', 'How to use'],
    ['#for-you', 'Guides'],
    ['#fair', 'Fair exams'],
    ['#contributors', 'Contributors'],
  ];

  return (
    <div className="min-h-dvh overflow-x-clip bg-surface">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:font-bold focus:text-white">
        Skip to content
      </a>

      <header className="sticky top-0 z-50 bg-[#3b142a]">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-6">
            <Link to="/" aria-label="OpenQZ home" className="rounded">
              <Logo light />
            </Link>
            <nav className="hidden items-center lg:flex" aria-label="Main">
              {links.map(([href, label]) => (
                <a key={href} href={href} className={navLink}>
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <form onSubmit={enterCode} className="hidden items-center gap-1 sm:flex">
              <input
                inputMode="numeric"
                aria-label="Enter a join code"
                placeholder="Enter code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                className="w-28 rounded-md border border-[#f3efda]/40 bg-transparent px-3 py-2 text-base font-bold tracking-widest text-[#f3efda] outline-none placeholder:tracking-normal placeholder:text-[#f3efda]/75 focus:border-[#f3efda]"
              />
              <button type="submit" disabled={code.length !== 6} className={cx(btnCream, 'px-3 disabled:opacity-60')}>
                Join
              </button>
            </form>
            <Link to="/login" className={btnPink}>
              Login
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              onClick={() => setMenuOpen((o) => !o)}
              className="rounded-md border border-[#f3efda]/40 p-2 text-[#f3efda] lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="landing-menu" aria-label="Menu" className="border-t border-[#592643] px-4 py-3 lg:hidden">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={closeMenu} className="block rounded px-3 py-2.5 font-bold text-[#f3efda] hover:bg-white/10">
                {label}
              </a>
            ))}
            <a href="#join" onClick={toJoin} className="block rounded px-3 py-2.5 font-bold text-[#ff5cb0] hover:bg-white/10 sm:hidden">
              Enter a join code
            </a>
          </nav>
        )}
      </header>

      <main id="main-content">
        {/* hero: plum, centred, the video rising out of the bottom edge */}
        <section className={cx('stage', CREAM)}>
          <div className="mx-auto max-w-7xl px-4 pt-14 text-center sm:px-8 sm:pt-24">
            <div className="animate-rise">
              <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-[0.98] tracking-tight min-[400px]:text-5xl sm:text-6xl lg:text-[4rem]">
                Quizzes that play like a game. Marks that count.
              </h1>
              <p className="mx-auto mt-6 max-w-3xl text-lg leading-snug text-[#f3efda]/95 sm:text-[1.375rem]">
                OpenQZ turns anything you teach at Don Bosco Institute of Technology into a timed quiz, an assignment, a poll or a live game that every student can take on their own phone, then shows you exactly how each one did.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-4">
                <Link to="/login" className="w-full rounded-md bg-brand-600 px-6 py-3 text-left transition-colors hover:bg-brand-700 min-[420px]:w-48">
                  <span className="block text-sm font-bold uppercase text-white">Faculty and students</span>
                  <span className="block text-lg font-bold text-white">Login</span>
                </Link>
                <a href="#join" onClick={toJoin} className="w-full rounded-md bg-[#f3efda] px-6 py-3 text-left text-[#3b142a] transition-colors hover:bg-white min-[420px]:w-48">
                  <span className="block text-sm font-medium uppercase">Have a code?</span>
                  <span className="block text-lg font-bold">Join a room</span>
                </a>
              </div>
            </div>
            <div className="mt-14 sm:mt-16">
              <IntroVideo />
            </div>
          </div>
        </section>

        {/* join with a code: the first thing under the hero */}
        <section id="join" aria-labelledby="join-title" className="scroll-mt-24 border-b border-line bg-card">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-12 text-center sm:px-8 md:flex-row md:justify-between md:text-left">
            <div className="min-w-0">
              <h2 id="join-title" className="text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl">
                Got a 6-digit code?
              </h2>
              <p className="mt-2 text-lg text-muted">Type the code from your teacher or club. Guests need no account for live games that allow them.</p>
            </div>
            <form onSubmit={enterCode} className="flex w-full max-w-sm shrink-0 items-stretch gap-2">
              <input
                ref={joinInput}
                inputMode="numeric"
                aria-label="Join code"
                placeholder="123 456"
                value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                className="min-w-0 flex-1 rounded-md border-2 border-[#3b142a] bg-white px-3 py-3 text-center text-3xl font-bold tracking-[0.2em] text-[#3b142a] outline-none placeholder:text-[#3b142a]/40 focus:border-brand-600"
              />
              <button type="submit" disabled={code.length !== 6} className={cx(btnPink, 'px-6 text-xl disabled:opacity-60')}>
                Join
              </button>
            </form>
          </div>
        </section>

        {/* the numbers */}
        <section aria-label="OpenQZ in numbers" className="mx-auto max-w-7xl px-4 pt-16 sm:px-8 sm:pt-24">
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {numbers.map((n, i) => (
              <Reveal key={n.label} delay={i * 80} className={cx('rounded-lg p-6 text-center', i % 2 === 0 ? 'bg-[#3b142a] text-[#f3efda]' : 'bg-brand-600 text-white')}>
                <dd className="text-5xl font-bold tracking-tight sm:text-6xl">{n.value}</dd>
                <dt className="mt-1 text-base font-medium sm:text-lg">{n.label}</dt>
              </Reveal>
            ))}
          </dl>
          <Reveal>
            <p className="mt-6 text-center text-lg font-medium">
              Built and maintained by the <b className="text-brand-ink">Open Source Students Club (OSSC)</b>, Don Bosco Institute of Technology.
            </p>
          </Reveal>
        </section>

        {/* how it works: numbered plum cards on cream */}
        <section id="how-to-use" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">From the office sheet to the marks, in one place</h2>
          </Reveal>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 90}>
                <div className="relative flex h-full min-h-56 flex-col overflow-hidden rounded-lg bg-[linear-gradient(180deg,#3b142a_55%,#6e1f4c_130%)] p-6 text-[#f3efda]">
                  <p className="text-lg leading-snug">
                    <b>{s.title}</b> {s.body}
                  </p>
                  <span className="pointer-events-none mt-auto select-none self-end text-8xl font-bold italic leading-[0.7] text-[#f3efda]/35" aria-hidden>
                    {i + 1}
                  </span>
                </div>
              </Reveal>
            ))}
          </ol>
          <Reveal className="mt-8">
            <p className="rounded-md border-l-4 border-brand-600 bg-[#e4dfc8] px-4 py-4 text-lg dark:bg-brand-50">Admins, teachers, clubs and students work from the same lists and the same results, and nobody spends an evening copying marks into a spreadsheet.</p>
          </Reveal>
        </section>

        {/* two feature cards */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-8 sm:pb-24">
          <Reveal>
            <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Class tests, club events and everything in between</h2>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {features.map((f, i) => (
              <Reveal as="article" key={f.title} delay={i * 100}>
                <div className="h-full rounded-lg border border-edge bg-card p-6 sm:p-8">
                  <h3 className="text-2xl font-bold tracking-tight">{f.title}</h3>
                  <p className="mt-3 text-lg text-muted">{f.body}</p>
                  <ul className="mt-5 space-y-2">
                    {f.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2 font-medium">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden /> {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-6">
            <div className="flex flex-col items-start gap-4 rounded-lg bg-[#3b142a] p-6 text-[#f3efda] sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div className="min-w-0">
                <h3 className="text-2xl font-bold tracking-tight">Got a 6-digit code from your teacher or club?</h3>
                <p className="mt-1 text-[#f3efda]/90">Enter it, or scan the QR code on the screen. Guests need no account for live games that allow them.</p>
              </div>
              <a href="#join" onClick={toJoin} className={cx(btnPink, 'shrink-0 px-5 py-3 text-lg')}>
                Enter a code <ArrowRight className="h-5 w-5" aria-hidden />
              </a>
            </div>
          </Reveal>
        </section>

        {/* fair exams: plum */}
        <section id="fair" className="scroll-mt-20 bg-[#3b142a] text-[#f3efda]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
            <Reveal className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">The server keeps the rules, so every student gets the same exam</h2>
            </Reveal>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fair.map((f, i) => (
                <Reveal as="li" key={f.title} delay={i * 70}>
                  <div className="h-full rounded-lg border border-[#592643] bg-[#4a1a35] p-6">
                    <f.icon className="h-7 w-7 text-[#ff5cb0]" aria-hidden />
                    <h3 className="mt-4 text-xl font-bold">{f.title}</h3>
                    <p className="mt-2 text-[#f3efda]/85">{f.desc}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* guides */}
        <section id="for-you" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Made for everyone on campus</h2>
            <p className="mt-4 text-center text-lg text-muted">Each guide opens without signing in.</p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {roles.map((c, i) => (
              <Reveal as="article" key={c.role} delay={i * 90}>
                <div className="flex h-full flex-col rounded-lg border border-edge bg-card p-6">
                  <c.icon className="h-8 w-8 text-brand-ink" aria-hidden />
                  <h3 className="mt-4 text-2xl font-bold tracking-tight">{c.role}</h3>
                  <p className="mt-2 flex-1 text-muted">{c.description}</p>
                  <a href={c.guideUrl} className="mt-5 inline-flex items-center gap-1.5 font-bold text-brand-ink underline underline-offset-4">
                    {c.guideLabel} <ArrowRight className="h-4 w-4" aria-hidden />
                  </a>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {college.map((p, i) => (
              <Reveal as="article" key={p.title} delay={i * 90}>
                <div className="h-full rounded-lg border border-edge bg-card p-6">
                  <p.icon className="h-7 w-7 text-brand-ink" aria-hidden />
                  <h3 className="mt-3 text-xl font-bold">{p.title}</h3>
                  <p className="mt-2 text-muted">{p.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <Contributors />

        {/* closing call */}
        <section className={cx('stage', CREAM)}>
          <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 sm:py-24">
            <h2 className="text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Ready when your class is</h2>
            <p className="mt-4 text-lg text-[#f3efda]/90">Sign in with the email your college registered for you.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/login" className={cx(btnPink, 'px-6 py-3 text-lg')}>
                Login to OpenQZ
              </Link>
              <a href="#join" onClick={toJoin} className={cx(btnCream, 'px-6 py-3 text-lg')}>
                I have a join code
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#2b0e1e] text-[#f3efda]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <Logo light />
              <p className="mt-3 max-w-md text-sm text-[#f3efda]/85">Open source. Built and maintained by the Open Source Students Club (OSSC), Don Bosco Institute of Technology, Bangalore.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <a href="https://dbit.edu.in/" target="_blank" rel="noreferrer" className="rounded-lg bg-[#f3efda] px-4 py-3 transition-colors hover:bg-white" aria-label="Don Bosco Institute of Technology, Bangalore (opens the college site)">
                <img src="/landing/dbit-logo.png" alt="Don Bosco Institute of Technology, Bangalore" width={726} height={180} className="h-12 w-auto sm:h-14" />
              </a>
              <a href="https://github.com/OSSC-DBIT" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-[#592643] px-3 py-2 transition-colors hover:border-[#ff5cb0]" aria-label="Open Source Students Club, DBIT (opens GitHub)">
                <img src="/landing/ossc-logo.jpg" alt="" width={200} height={200} className="h-12 w-12 rounded-md sm:h-14 sm:w-14" />
                <span className="text-sm font-bold leading-tight">
                  Open Source
                  <br />
                  Students Club
                </span>
              </a>
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-4 border-t border-[#592643] pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#f3efda]/75">An OSSC DBIT project.</p>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 font-bold">
              <a href="/guides/student.html" className="hover:text-[#ff5cb0]">
                Student guide
              </a>
              <a href="/guides/faculty.html" className="hover:text-[#ff5cb0]">
                Faculty guide
              </a>
              <a href="/guides/admin.html" className="hover:text-[#ff5cb0]">
                Admin guide
              </a>
              <a href="https://github.com/OSSC-DBIT/openqz" target="_blank" rel="noreferrer" className="hover:text-[#ff5cb0]">
                GitHub
              </a>
              <Link to="/privacy" className="hover:text-[#ff5cb0]">
                Privacy Policy
              </Link>
              <a href="mailto:osscdbit@gmail.com" className="hover:text-[#ff5cb0]">
                osscdbit@gmail.com
              </a>
              <Link to="/login" className="text-[#ff8cc8] hover:text-white">
                Login
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
