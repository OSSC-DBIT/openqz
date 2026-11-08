import { ChevronDown, Home, KeyRound, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { cx } from '../components/ui';
import { Logo } from './AppShell';

/** Students get a top bar (no sidebar), with "enter code" always at hand, like Wayground. */
export function StudentShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const d = code.replace(/\D/g, '').slice(0, 6);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
          <Link to="/student" aria-label="OpenQZ home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden sm:block">
            <NavLink
              to="/student"
              end
              className={({ isActive }) =>
                cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold', isActive ? 'bg-brand-100 text-brand-700 dark:text-brand-200' : 'text-muted hover:text-ink')
              }
            >
              <Home className="h-4 w-4" aria-hidden /> Home
            </NavLink>
          </nav>
          <form
            className="ml-auto hidden items-center gap-1 rounded-xl border border-line bg-surface p-1 md:flex"
            onSubmit={(e) => {
              e.preventDefault();
              if (d.length === 6) {
                setCode('');
                nav(`/join/${d}`);
              }
            }}
          >
            <input
              inputMode="numeric"
              aria-label="Enter a join code"
              placeholder="Enter code"
              value={d}
              onChange={(e) => setCode(e.target.value)}
              className="w-28 bg-transparent px-2 text-sm font-bold tracking-widest outline-none placeholder:font-semibold placeholder:tracking-normal"
            />
            <button type="submit" disabled={d.length !== 6} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
              Join
            </button>
          </form>
          <Link to="/join" className="ml-auto rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white md:hidden">
            Enter code
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
              className="flex items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-brand-50"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white" aria-hidden>
                {user?.full_name.slice(0, 1).toUpperCase()}
              </span>
              <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-12 w-64 overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
                <div className="border-b border-line px-4 py-3">
                  <p className="truncate text-sm font-bold">{user?.full_name}</p>
                  <p className="truncate text-xs text-muted">{user?.email}</p>
                </div>
                <Link role="menuitem" to="/account/password" onClick={() => setMenu(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold hover:bg-brand-50">
                  <KeyRound className="h-4 w-4" aria-hidden /> Change password
                </Link>
                <button role="menuitem" onClick={() => void logout()} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold hover:bg-brand-50">
                  <LogOut className="h-4 w-4" aria-hidden /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
