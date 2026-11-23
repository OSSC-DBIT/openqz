import { ChevronDown, Home, KeyRound, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { cx } from '../components/ui';
import { Avatar, Logo } from './AppShell';

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
    <div className="paper flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-plum text-[#f3efda]">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 min-[360px]:px-4 sm:gap-5 sm:px-6 2xl:max-w-7xl">
          <Link to="/student" aria-label="OpenQZ home">
            <Logo light />
          </Link>
          <nav aria-label="Main" className="hidden sm:block">
            <NavLink
              to="/student"
              end
              className={({ isActive }) =>
                cx('flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-sm font-bold', isActive ? 'border-transparent bg-white/15 text-white' : 'border-transparent text-[#f3efda]/85 hover:text-white')
              }
            >
              <Home className="h-4 w-4" aria-hidden /> Home
            </NavLink>
          </nav>
          <form
            className="ml-auto hidden items-center gap-1 rounded-md bg-[#f3efda] p-1 text-[#3b142a] md:flex"
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
              className="w-28 bg-transparent px-2 text-sm font-bold tracking-widest outline-none placeholder:font-semibold placeholder:tracking-normal placeholder:text-[#3b142a]/60"
            />
            <button type="submit" disabled={d.length !== 6} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-extrabold text-white disabled:opacity-50">
              Join
            </button>
          </form>
          <Link to="/join" className="sticker-sm press ml-auto whitespace-nowrap rounded-xl bg-brand-600 px-3 py-2 text-sm font-extrabold text-white md:hidden">
            Enter code
          </Link>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
              className="flex items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-white/10"
            >
              <Avatar name={user?.full_name} />
              <ChevronDown className="h-4 w-4 text-[#f3efda]/80" aria-hidden />
            </button>
            {menu && (
              <div role="menu" className="sticker text-ink absolute right-0 top-12 w-64 max-w-[calc(100vw-1.5rem)] animate-rise overflow-hidden rounded-2xl bg-card">
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
      <main className="mx-auto w-full max-w-6xl flex-1 animate-rise px-3 py-5 min-[360px]:px-4 sm:px-6 sm:py-8 2xl:max-w-7xl">
        <Outlet />
      </main>
    </div>
  );
}
