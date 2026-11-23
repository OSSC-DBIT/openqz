import { LogOut, Menu, MoreHorizontal, Plus, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
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
      <span className={cx('text-lg font-bold tracking-tight max-[279px]:sr-only', light && 'text-white')}>
        Open<span className={light ? 'text-[#ff5cb0]' : 'text-brand-ink'}>QZ</span>
      </span>
    </div>
  );
}

/** Disc with the initial of the signed-in person. */
export function Avatar({ name, className }: { name: string | undefined; className?: string }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-full bg-brand-600 font-bold text-white', className ?? 'h-9 w-9 text-sm')} aria-hidden>
      {(name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

const primaryCta = 'flex items-center justify-center gap-2 rounded-md bg-primary font-bold text-white transition-colors duration-150 hover:bg-brand-700';

/**
 * Staff shell. Wide screens: a left rail with the primary action (Create). Phones and
 * tablets: a frosted top bar and a thumb-reach tab bar at the bottom; "More" opens the full menu.
 */
export function AppShell({ nav, action, wrap }: { nav: NavItem[]; action?: { to: string; label: string }; wrap?: (children: ReactNode) => ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const links = (
    <nav className="space-y-0.5" aria-label="Main">
      {nav.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-brand-600 font-bold text-white' : 'text-[#f3efda]/85 hover:bg-white/10 hover:text-[#f3efda]',
            )
          }
        >
          <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className="truncate">{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  const primary = action && (
    <Link to={action.to} onClick={() => setOpen(false)} className={cx(primaryCta, 'px-4 py-2.5')}>
      <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden /> {action.label}
    </Link>
  );

  const userBox = (
    <div className="rounded-lg border border-white/15 bg-white/5 p-3 text-[#f3efda]">
      <div className="flex items-center gap-3">
        <Avatar name={user?.full_name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.full_name}</p>
          <p className="truncate text-xs capitalize text-[#f3efda]/75">{user?.role === 'admin' && user.is_superadmin ? 'super admin' : user?.role}</p>
        </div>
      </div>
      <button onClick={() => void logout()} className="mt-3 flex w-full items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-[#f3efda]/80 transition-colors hover:text-white">
        <LogOut className="h-4 w-4" aria-hidden /> Log out
      </button>
    </div>
  );

  const main = (
    <main className="mx-auto w-full max-w-6xl animate-rise px-3 pb-28 pt-5 min-[360px]:px-4 sm:px-8 sm:pt-8 lg:pb-10 2xl:max-w-7xl">
      <Outlet />
    </main>
  );

  // Phones: the first tabs that fit, the rest behind "More".
  const tabs = nav.slice(0, nav.length > 4 ? 3 : 4);

  return (
    <div className="paper flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col justify-between gap-4 overflow-y-auto bg-plum p-4 lg:flex">
        <div className="space-y-5">
          <Link to={nav[0]?.to ?? '/'} aria-label="OpenQZ home" className="block px-1 pt-1">
            <Logo light />
          </Link>
          {primary}
          {links}
        </div>
        {userBox}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-plum px-3 py-2.5 min-[360px]:px-4 lg:hidden">
          <Logo light />
          <div className="flex items-center gap-2">
            {action && (
              <Link to={action.to} className={cx(primaryCta, 'px-3 py-2 text-sm')}>
                <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden /> {action.label}
              </Link>
            )}
            <button aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="rounded-md border border-white/20 p-2 text-[#f3efda]">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>
        {wrap ? wrap(main) : main}
      </div>

      {/* thumb-reach tabs on phones and tablets */}
      <nav aria-label="Quick links" className="glass fixed inset-x-0 bottom-0 z-30 border-t border-edge pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-xl">
          {tabs.map((n) => (
            <li key={n.to} className="min-w-0 flex-1">
              <NavLink to={n.to} end={n.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-semibold transition-colors', isActive ? 'text-brand-ink' : 'text-muted')}>
                {({ isActive }) => (
                  <>
                    <span className={cx('grid h-7 w-12 place-items-center rounded-md transition-colors', isActive && 'bg-brand-100')}>
                      <n.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="max-w-full truncate">{n.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className="min-w-0 flex-1">
            <button type="button" onClick={() => setOpen(true)} className="flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-semibold text-muted">
              <span className="grid h-7 w-12 place-items-center rounded-full">
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Menu" className="flex h-full w-72 max-w-[88vw] animate-rise flex-col justify-between gap-4 overflow-y-auto bg-plum p-4 shadow-pop-lg" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <Logo light />
                <button aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md border border-white/20 p-2 text-[#f3efda]">
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
