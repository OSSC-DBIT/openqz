import { ArrowLeft, Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../layouts/AppShell';

/* The privacy policy everyone agrees to at sign-in. Keep PRIVACY_VERSION in
   backend/app/core/privacy.py equal to VERSION below: changing it asks everyone to agree again. */

export const PRIVACY_CONTACT = 'osscdbit@gmail.com';
const VERSION = '2026-11-22';
const UPDATED = '22 November 2026';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-6">
      <h2 id={id} className="mt-10 text-xl font-extrabold tracking-tight sm:text-2xl">
        {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  const mail = (
    <a className="font-semibold text-brand-ink underline" href={`mailto:${PRIVACY_CONTACT}`}>
      {PRIVACY_CONTACT}
    </a>
  );
  return (
    <div className="min-h-dvh paper">
      <header className="bg-plum">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" aria-label="OpenQZ home">
            <Logo light />
          </Link>
          <Link to="/login" className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-bold text-[#f3efda] hover:bg-white/10">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-sm font-bold uppercase tracking-wide text-brand-ink">OpenQZ</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted">
          Last updated {UPDATED} | Version {VERSION}
        </p>

        <div className="mt-6 sticker rounded-lg bg-card p-5 leading-relaxed">
          <p>
            OpenQZ is the quiz and assignment platform of Don Bosco Institute of Technology (DBIT), Bangalore, built and run by the <b>Open Source Students Club (OSSC), DBIT</b>. This page says what we collect when you use it, why, how we protect it and what you can ask us to do. In short: we collect only what teaching and marking need, we never sell it or show ads, and we keep your contact details encrypted.
          </p>
          <p className="mt-3">
            Questions or requests: {mail}.
          </p>
        </div>

        <Section id="what" title="1. What we collect">
          <p>
            <b>Your account</b>, set up by the college office or an OpenQZ admin:
          </p>
          <List
            items={[
              'your name and your USN or employee ID;',
              'your college email address (it is how you sign in);',
              'a phone number and a designation, only if the admin adds them;',
              'your department, and for students your semester and section;',
              'your password, stored only as a one-way hash (nobody, not even an admin, can read it).',
            ]}
          />
          <p>
            <b>Your work in OpenQZ</b>: the answers you give, your marks, the time you take, teacher feedback, and the activities and questions teachers and clubs create (including any images they upload).
          </p>
          <p>
            <b>Fair-exam events</b> during quizzes and assignments: leaving full screen, switching tabs or apps, going Back, reloading, and opening the same attempt on a second device. They are counted so the teacher can see them; OpenQZ does not record your screen, camera or microphone.
          </p>
          <p>
            <b>Security records</b>: when you sign in, failed sign-ins, password resets and important admin actions, with the network address they came from.
          </p>
          <p>
            <b>Live game guests</b> (no account) give only a nickname, which is kept with that game's results.
          </p>
          <p>
            <b>Your agreement to this policy</b>: when you ticked the box at sign-in, and which version.
          </p>
        </Section>

        <Section id="why" title="2. Why we use it">
          <List
            items={[
              'to sign you in and keep your account safe;',
              'to give you the quizzes, assignments, rooms and live games meant for you;',
              'to mark your work and show marks and feedback to you and your teachers;',
              'to keep exams fair (the events above) and to look into problems;',
              'to send emails you need, such as a password reset or a new assignment (only if email is switched on).',
            ]}
          />
          <p>We do not use your data for advertising, we do not sell or rent it, and we do not build profiles of you for anyone else.</p>
        </Section>

        <Section id="who" title="3. Who can see it">
          <List
            items={[
              <>
                <b>You</b> see your own work, marks and feedback (marks when your teacher releases them).
              </>,
              <>
                <b>Your teachers</b> see the work of students in the classes they teach, and of students who join their rooms.
              </>,
              <>
                <b>Club organisers</b> see only the people who join their rooms and games, never class lists.
              </>,
              <>
                <b>OpenQZ admins</b> at DBIT manage accounts, classes and imports, and see reports to support teaching.
              </>,
              <>
                <b>Other students</b> see only what a live game shows on the big screen: nicknames or first names on the leaderboard.
              </>,
            ]}
          />
          <p>
            <b>Services we use</b>: if you choose <b>Sign in with Google</b>, Google confirms your identity to us (Google&apos;s own privacy policy applies to your Google account). Emails go out through the email server OSSC runs for OpenQZ. The site may be reached through Cloudflare, which passes the traffic on without storing your OpenQZ data. Nothing else on OpenQZ talks to outside services: no analytics, no trackers, no ads.
          </p>
          <p>We share data outside DBIT only if the law requires it.</p>
        </Section>

        <Section id="protect" title="4. How we protect it">
          <List
            items={[
              'Email addresses, phone numbers and uploaded people lists are stored encrypted (AES-256).',
              'Passwords are stored only as Argon2id hashes; accounts lock after repeated wrong passwords.',
              'Everything travels over HTTPS.',
              'Every request is checked: you reach only what your role and your classes allow, and these checks are tested.',
              'Answer keys stay on the server until the review rules allow you to see them.',
              'Uploaded images are cleaned of hidden photo data (such as the location a photo was taken).',
              'The server is run by OSSC for DBIT; backups are kept under the same care.',
            ]}
          />
          <p>No system is perfectly safe. If we learn of a breach that affects you, we will tell you and the college as soon as we can.</p>
        </Section>

        <Section id="cookies" title="5. Cookies and storage in your browser">
          <p>
            OpenQZ sets <b>one cookie</b>, to keep you signed in. Scripts on the page cannot read it, and it is never sent to other sites. Your browser also remembers a few settings on your device (for example that you dismissed the &quot;Install OpenQZ&quot; card), and the installed app keeps its own files for faster loading. There are no advertising or tracking cookies.
          </p>
        </Section>

        <Section id="keep" title="6. How long we keep it">
          <p>
            Your account and work are kept while you study or work at DBIT, so marks and records stay available to you and the college. When an account is no longer needed, an admin can switch it off or, on request, remove it with its work for good. Security records are kept as long as needed to protect accounts and look into problems.
          </p>
        </Section>

        <Section id="rights" title="7. Your choices and rights">
          <p>You can ask us to:</p>
          <List
            items={[
              'tell you what personal data OpenQZ holds about you, and give you a copy;',
              'correct details that are wrong (your name, email or phone);',
              'remove your data when it is no longer needed for your course or the college records;',
              'explain how a decision about you (such as an auto-submitted exam) was made.',
            ]}
          />
          <p>
            Write to {mail} from your college email, or ask your class teacher or the OpenQZ admin. We answer within 30 days. If you are not satisfied, you can raise it with the DBIT administration. We follow the spirit of India&apos;s Digital Personal Data Protection Act, 2023.
          </p>
        </Section>

        <Section id="changes" title="8. Changes to this policy">
          <p>
            When this policy changes in a way that matters, we update the version and date above, and OpenQZ asks everyone to read and agree again at their next sign-in. Your agreement (date and version) is saved with your account.
          </p>
        </Section>

        <Section id="contact" title="9. Contact">
          <p className="flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-brand-ink" aria-hidden /> Open Source Students Club, Don Bosco Institute of Technology, Bangalore: {mail}
          </p>
        </Section>

        <p className="mt-12 border-t border-line pt-6 text-sm text-muted">
          <Link to="/login" className="font-semibold text-brand-ink underline">
            Back to sign in
          </Link>{' '}
          | <Link to="/" className="underline">OpenQZ home</Link>
        </p>
      </main>
    </div>
  );
}
