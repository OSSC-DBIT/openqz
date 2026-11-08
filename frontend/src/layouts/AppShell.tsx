import { LogOut, Menu, Plus, X, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { cx } from '../components/ui';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className={cx('text-lg font-extrabold tracking-tight', light && 'text-white')}>OpenQZ</span>
    </div>
  );
}

/** Left navigation with a prominent primary action (Create / Join), like the quiz tools teachers know. */
export function AppShell({ nav, action, wrap }: { nav: NavItem[]; action?: { to: string; label: string }; wrap?: (children: ReactNode) => ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="space-y-1" aria-label="Main">
      {nav.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
              isActive ? 'bg-brand-100 text-brand-700 dark:text-brand-200' : 'text-muted hover:bg-brand-50 hover:text-ink',
            )
          }
        >
          <n.icon className="h-5 w-5" aria-hidden />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );

  const primary = action && (
    <Link
      to={action.to}
      onClick={() => setOpen(false)}
      className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 font-bold text-white shadow-md shadow-brand-600/30 transition hover:bg-brand-700"
    >
      <Plus className="h-5 w-5" aria-hidden /> {action.label}
    </Link>
  );

  const userBox = (
    <div className="border-t border-line pt-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white" aria-hidden>
          {user?.full_name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.full_name}</p>
          <p className="truncate text-xs capitalize text-muted">{user?.role}</p>
        </div>
      </div>
      <button onClick={() => void logout()} className="mt-3 flex items-center gap-2 text-sm font-medium text-muted hover:text-ink">
        <LogOut className="h-4 w-4" aria-hidden /> Log out
      </button>
    </div>
  );

  const main = (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <Outlet />
    </main>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col justify-between border-r border-line bg-card p-4 lg:flex">
        <div className="space-y-5">
          <Logo />
          {primary}
          {links}
        </div>
        {userBox}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-card/90 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <div className="flex items-center gap-2">
            {action && (
              <Link to={action.to} className="flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white">
                <Plus className="h-4 w-4" aria-hidden /> {action.label}
              </Link>
            )}
            <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-brand-50">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>
        {wrap ? wrap(main) : main}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="flex h-full w-72 max-w-[85vw] flex-col justify-between bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <Logo />
                <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-brand-50">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {primary}
              {links}
            </div>
            {userBox}
          </div>
        </div>
      )}
    </div>
  );
}
