import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Clock,
  Compass,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  LogIn,
  Maximize2,
  Menu,
  RotateCcw,
  Shield,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { cx } from '../components/ui';
import './landing.css';

/* =========================================================
   Static Data
   ========================================================= */

const heroFeatures: { icon: LucideIcon; title: string }[] = [
  { icon: Zap, title: 'Interactive Quizzes' },
  { icon: ShieldCheck, title: 'Secure Examinations' },
  { icon: BarChart3, title: 'Live Analytics' },
  { icon: Users, title: 'Built for Institutions' },
];

const howItWorksSteps = [
  {
    number: '01',
    title: 'Import and Access',
    body: 'The college imports students and faculty, and everyone signs in with their college email or Google.',
  },
  {
    number: '02',
    title: 'Create and Assign',
    body: 'Faculty build a quiz, assignment, poll or flashcards, pick branch, semesters and sections, then assign it or host a room with a 6-digit code.',
  },
  {
    number: '03',
    title: 'Attempt and Review',
    body: 'Students take it on their phone or laptop, one question at a time, and see their marks obtained.',
  },
];

const roleCards = [
  {
    role: 'For students',
    icon: GraduationCap,
    description:
      'Join with a code, link or QR, timed one-question-at-a-time player, instant feedback when allowed, review marks.',
    guideUrl: '/guides/student.html',
    guideLabel: 'Read the student guide',
  },
  {
    role: 'For faculty',
    icon: LayoutGrid,
    description:
      '6 question types, rubrics, marking queue, overview grid, Excel and CSV export, unblock.',
    guideUrl: '/guides/faculty.html',
    guideLabel: 'Read the faculty guide',
  },
  {
    role: 'For admins and clubs',
    icon: Shield,
    description:
      'Import sheets, accounts, audit and integrity logs; clubs host rooms for events.',
    guideUrl: '/guides/admin.html',
    guideLabel: 'Read the admin guide',
  },
];

const integrityList = [
  {
    title: 'Full screen required',
    desc: 'The player requires full-screen mode per assignment before questions appear.',
    icon: Maximize2,
  },
  {
    title: 'Integrity monitoring',
    desc: 'Tab or app switches, Back and reloads are counted by the server with auto-submit at the teacher limit.',
    icon: ShieldCheck,
  },
  {
    title: 'Server-enforced timers',
    desc: 'Deadlines and question timers are calculated on the server with a network grace window.',
    icon: Clock,
  },
  {
    title: 'Single attempt rule',
    desc: 'One attempt per student guarantees fair assessment and clean marks distribution.',
    icon: RotateCcw,
  },
  {
    title: 'Protected answer keys',
    desc: 'Answer keys and rubrics are kept on the server and never sent early to students.',
    icon: KeyRound,
  },
];

const collegePillars = [
  {
    title: 'Branches, semesters and sections',
    desc: 'Faculty pick classes they teach across departments with granular section assignment.',
    icon: Compass,
  },
  {
    title: 'Imports from office sheets',
    desc: 'Admins import students, faculty and subject mappings directly from CSV or Excel spreadsheets.',
    icon: UploadCloud,
  },
  {
    title: 'Installable on phones (PWA)',
    desc: 'Students can install OpenQZ as a lightweight progressive web app on Android, iOS or laptop.',
    icon: Smartphone,
  },
];

/* Helper to generate deterministic shiny star dots across any section */
function generateDots(count: number, seed: number) {
  return Array.from({ length: count }, (_, i) => {
    const rawX = (i * 137.508 + seed * 31.7) % 1440;
    const rawY = (i * 73.31 + seed * 47.9) % 720;
    const isSpecial = i % 7 === 0;
    const isMedium = i % 3 === 0;
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
      r: isSpecial ? 1.8 : isMedium ? 1.2 : 0.7,
      color: isSpecial ? '#c4b5fd' : isMedium ? '#ddd6fe' : '#ffffff',
      opacity: 0.2 + ((i * 19 + seed * 13) % 60) / 100,
      className:
        isSpecial
          ? 'lp-twinkle-pulse'
          : i % 2 === 0
            ? 'lp-twinkle-slow'
            : 'lp-twinkle-fast',
    };
  });
}

const heroDots = generateDots(75, 1);
const howItWorksDots = generateDots(50, 2);
const rolesDots = generateDots(50, 3);
const integrityDots = generateDots(50, 4);
const pillarsDots = generateDots(50, 5);
const footerDots = generateDots(30, 6);

/* =========================================================
   Visual Components
   ========================================================= */

function PlanetLogo() {
  return (
    <svg viewBox="0 0 40 40" className="h-8 w-8 shrink-0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lp-planet-fill" x1="8" y1="8" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ddd6fe" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="8.5" fill="url(#lp-planet-fill)" />
      <ellipse
        cx="20"
        cy="20"
        rx="17"
        ry="5.5"
        fill="none"
        stroke="#a78bfa"
        strokeWidth="2"
        transform="rotate(-20 20 20)"
      />
      <circle cx="32" cy="9" r="1.6" fill="#ddd6fe" />
    </svg>
  );
}

function StarDots({ dots }: { dots: ReturnType<typeof generateDots> }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        className="h-full w-full"
        viewBox="0 0 1440 720"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        {dots.map((d, idx) => (
          <circle
            key={idx}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={d.color}
            opacity={d.opacity}
            className={d.className}
          />
        ))}
      </svg>
    </div>
  );
}

/* =========================================================
   Main Landing Page
   ========================================================= */

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  return (
    <div className="lp-page-ambient min-h-dvh text-slate-100">
      <a href="#main-content" className="lp-skip-link">
        Skip to content
      </a>

      {/* =====================================================
          STICKY TOP BAR
          ===================================================== */}
      <header
        className={cx(
          'sticky top-0 z-50 transition-colors duration-300',
          scrolled || menuOpen
            ? 'border-b border-violet-500/15 bg-[#05020a]/90 backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="relative mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            aria-label="OpenQZ home"
          >
            <PlanetLogo />
            <span className="lp-font-display text-xl font-extrabold tracking-tight text-white">
              OpenQZ
            </span>
          </Link>

          <nav
            className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 md:flex"
            aria-label="Main"
          >
            <Link
              to="/"
              aria-current="page"
              className="relative py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a]"
            >
              Home
              <span aria-hidden="true" className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-violet-400" />
            </Link>
            <a
              href="#how-to-use"
              className="py-2 text-sm font-medium text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a]"
            >
              How to Use
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="inline-flex rounded-full border border-violet-300/60 px-5 py-2 text-sm font-semibold text-white transition hover:border-violet-300 hover:bg-violet-600/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a] sm:px-6"
            >
              Login
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a] md:hidden"
            >
              {menuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div
            id="mobile-menu"
            className="border-t border-violet-500/20 bg-[#05020a]/98 px-5 py-4 backdrop-blur-xl md:hidden"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              <Link
                to="/"
                aria-current="page"
                onClick={closeMenu}
                className="rounded-xl bg-violet-500/15 px-4 py-3 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                Home
              </Link>
              <a
                href="#how-to-use"
                onClick={closeMenu}
                className="rounded-xl px-4 py-3 text-base font-medium text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                How to Use
              </a>
              <Link
                to="/login"
                onClick={closeMenu}
                className="mt-2 rounded-xl bg-violet-600 px-4 py-3 text-center text-base font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                Login
              </Link>
            </nav>
          </div>
        )}
      </header>

      <main id="main-content">

        {/* =================================================
            HERO SECTION
            hero.webp at center bottom:
            - Astronaut at bottom-left sits clearly visible on the rocks
            - Black hole on the right
            - Soft scrim behind top-left headline text for AA contrast
            ================================================= */}
        <section className="relative isolate overflow-hidden lp-hero-bg">
          <StarDots dots={heroDots} />

          <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-5rem)] max-w-7xl flex-col justify-between px-5 pb-12 pt-14 sm:px-8 sm:pt-20 lg:min-h-[780px]">
            {/* Top-left content block */}
            <div className="max-w-[42rem]">
              {/* Eyebrow */}
              <p className="lp-font-eyebrow flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-bold uppercase text-violet-300">
                <span>EXPLORE</span>
                <span aria-hidden="true" className="text-violet-400/50">|</span>
                <span>LEARN</span>
                <span aria-hidden="true" className="text-violet-400/50">|</span>
                <span>COMPETE</span>
              </p>

              {/* Headline */}
              <h1 className="lp-font-display mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.6)] sm:text-5xl lg:text-6xl">
                <span className="block">
                  Discover a{' '}
                  <span className="bg-gradient-to-r from-violet-300 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent drop-shadow-[0_0_24px_rgba(168,85,247,0.45)]">
                    New Dimension
                  </span>
                </span>
                <span className="block">of Learning.</span>
              </h1>

              {/* Subtitle */}
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-lg">
                Experience smarter quizzes and examinations with OpenQZ. A modern platform built to
                make learning, assessment, and academic participation seamless.
              </p>

              {/* CTA buttons */}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a]"
                >
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Login to OpenQZ
                </Link>
                <a
                  href="#how-to-use"
                  className="inline-flex items-center gap-2 rounded-full border border-violet-300/50 bg-[#05020a]/40 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:border-violet-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a]"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  How to Use
                </a>
              </div>
            </div>

            {/* Bottom-right feature tiles */}
            <div className="mt-16 w-full self-end lg:mt-0 lg:w-[58%]">
              <ul className="grid grid-cols-2 overflow-hidden rounded-2xl border border-violet-400/25 bg-[#05020a]/70 backdrop-blur-md sm:grid-cols-4">
                {heroFeatures.map(({ icon: Icon, title }, idx) => (
                  <li
                    key={title}
                    className={cx(
                      'lp-feature-tile flex flex-col items-center px-4 py-6 text-center',
                      idx > 0 ? 'border-l border-white/10' : '',
                      idx >= 2 ? 'border-t border-white/10 sm:border-t-0' : '',
                    )}
                  >
                    <span className="lp-glow-box grid h-12 w-12 place-items-center rounded-2xl border border-violet-400/50 bg-violet-500/15 text-violet-300">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="lp-font-display mt-3 text-sm font-semibold leading-tight text-white">
                      {title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* =================================================
            HOW TO USE
            Shiny dots continue down through this section
            ================================================= */}
        <section id="how-to-use" className="relative z-10 scroll-mt-24">
          <hr className="lp-divider-glow" />
          <StarDots dots={howItWorksDots} />

          <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-2xl">
              <p className="lp-font-eyebrow text-xs font-bold uppercase text-violet-300">
                How to Use
              </p>
              <h2 className="lp-font-display mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Three steps from sign-in to your marks.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                OpenQZ brings the assessment workflow into a clean three-step sequence for teachers
                and students alike.
              </p>
            </div>

            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {howItWorksSteps.map((step) => (
                <li
                  key={step.title}
                  className="lp-card-hover rounded-2xl border border-violet-500/20 bg-[#0c051a]/60 p-7 backdrop-blur-sm"
                >
                  <span className="inline-block rounded-lg border border-violet-400/30 bg-violet-500/20 px-3 py-1 font-mono text-xs font-bold tracking-widest text-violet-300">
                    Step {step.number}
                  </span>
                  <h3 className="lp-font-display mt-4 text-xl font-bold text-white">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{step.body}</p>
                </li>
              ))}
            </ol>

            {/* Join room banner */}
            <div className="mt-10 flex flex-col items-start justify-between gap-5 rounded-2xl border border-violet-400/30 bg-gradient-to-r from-violet-950/40 via-purple-950/30 to-[#0c051a]/60 p-6 backdrop-blur-sm sm:flex-row sm:items-center sm:p-8">
              <div>
                <h3 className="lp-font-display text-lg font-bold text-white">
                  Have a join code? Join a room
                </h3>
                <p className="mt-1 text-sm text-slate-300">
                  Students can enter the 6-digit code from their teacher or club organizer to jump
                  straight into a live session.
                </p>
              </div>
              <Link
                to="/join"
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05020a]"
              >
                Join a room
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* =================================================
            ROLE CARDS
            Shiny dots continue down through this section
            ================================================= */}
        <section className="relative z-10">
          <hr className="lp-divider-glow" />
          <StarDots dots={rolesDots} />

          <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-2xl">
              <p className="lp-font-eyebrow text-xs font-bold uppercase text-violet-300">
                Roles
              </p>
              <h2 className="lp-font-display mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Tailored experiences for every campus user.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Each role gets an interface designed for their specific academic tasks.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {roleCards.map((c) => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.role}
                    className="lp-card-hover flex flex-col rounded-2xl border border-violet-500/20 bg-[#0c051a]/60 p-7 backdrop-blur-sm"
                  >
                    <div className="lp-glow-box grid h-12 w-12 place-items-center rounded-2xl border border-violet-400/40 bg-violet-500/10 text-violet-300">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <h3 className="lp-font-display mt-5 text-xl font-bold text-white">{c.role}</h3>
                    <p className="mt-3 flex-1 text-sm leading-6 text-slate-300">{c.description}</p>
                    <div className="mt-6 border-t border-white/10 pt-4">
                      <a
                        href={c.guideUrl}
                        className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-violet-300 hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                      >
                        {c.guideLabel}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* =================================================
            FAIR BY DESIGN (Integrity)
            Shiny dots continue down through this section
            ================================================= */}
        <section className="relative z-10">
          <hr className="lp-divider-glow" />
          <StarDots dots={integrityDots} />

          <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-2xl">
              <p className="lp-font-eyebrow text-xs font-bold uppercase text-violet-300">
                Integrity
              </p>
              <h2 className="lp-font-display mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Fair by design.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Automated checks protect assessment integrity transparently, with no intrusive camera
                proctoring or fragile workarounds.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {integrityList.map((pt) => {
                const Icon = pt.icon;
                return (
                  <div
                    key={pt.title}
                    className="lp-card-hover rounded-2xl border border-violet-500/20 bg-[#0c051a]/60 p-6 backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-400/30 bg-violet-500/10 text-violet-300">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <h3 className="lp-font-display text-base font-bold text-white">{pt.title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{pt.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* =================================================
            BUILT FOR COLLEGES (Architecture)
            Shiny dots continue down through this section
            ================================================= */}
        <section className="relative z-10">
          <hr className="lp-divider-glow" />
          <StarDots dots={pillarsDots} />

          <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-2xl">
              <p className="lp-font-eyebrow text-xs font-bold uppercase text-violet-300">
                Architecture
              </p>
              <h2 className="lp-font-display mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Built for colleges.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                Engineered around institutional hierarchies, existing spreadsheets, and low-latency
                local hosting.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {collegePillars.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.title}
                    className="lp-card-hover rounded-2xl border border-violet-500/20 bg-[#0c051a]/60 p-7 backdrop-blur-sm"
                  >
                    <span className="lp-glow-box grid h-12 w-12 place-items-center rounded-2xl border border-violet-400/30 bg-violet-500/10 text-violet-300">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <h3 className="lp-font-display mt-5 text-xl font-bold text-white">{p.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{p.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* =================================================
          FOOTER
          Shiny dots continue right into the footer
          ================================================= */}
      <footer className="relative z-10 pb-12 pt-6 text-sm text-slate-400">
        <hr className="lp-divider-glow" />
        <StarDots dots={footerDots} />

        <div className="relative mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-5 pt-10 sm:flex-row sm:px-8">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <div className="flex items-center gap-2 text-base font-extrabold text-white">
              <PlanetLogo />
              <span className="lp-font-display">OpenQZ</span>
            </div>
            <p className="text-xs text-slate-500">
              Open source, MIT license | Built by OSSC DBIT
            </p>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6" aria-label="Footer">
            <a
              href="/guides/student.html"
              className="rounded text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              Student guide
            </a>
            <a
              href="/guides/faculty.html"
              className="rounded text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              Faculty guide
            </a>
            <a
              href="/guides/admin.html"
              className="rounded text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              Admin guide
            </a>
            <Link
              to="/login"
              className="rounded text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              Login
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
