import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Badge as UiBadge } from './shadcn/badge';
import { Button as UiButton } from './shadcn/button';
import { Card as UiCard } from './shadcn/card';
import { Input as UiInput, NativeSelect, Textarea as UiTextarea } from './shadcn/input';
import { Skeleton } from './shadcn/skeleton';

/*
  The app's own component kit. Each piece is a shadcn/ui component (src/components/shadcn)
  with the props OpenQZ pages already use, so screens stay short and look the same everywhere.
*/

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive' } as const;

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    // `disabled` after `rest`: a caller's own `disabled` must never re-enable a button that is saving
    <UiButton variant={VARIANT[variant]} className={className} {...rest} disabled={loading || rest.disabled} aria-busy={loading || undefined}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </UiButton>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <UiInput className={className} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <UiTextarea className={className} {...rest} />;
}

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string };

export function PasswordInput({ label, className, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <Input type={visible ? 'text' : 'password'} className={cx('pr-11', className)} {...rest} aria-label={label} />
      <button
        type="button"
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted hover:text-ink"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </span>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <NativeSelect className={className} {...rest}>
      {children}
    </NativeSelect>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold text-ink">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <UiCard className={cx('p-4 sm:p-5', className)}>{children}</UiCard>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'red' | 'amber' | 'brand'; children: ReactNode }) {
  return <UiBadge variant={tone}>{children}</UiBadge>;
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-7 w-7 text-brand-ink')}
    />
  );
}

/**
 * Loading placeholders in the shape of what is coming, so the page does not jump when the
 * data arrives. `rows` for lists and tables, `cards` for grids of activity cards, `stats` for
 * a row of number tiles. Screen readers hear "Loading" once.
 */
export function Loading({ kind = 'rows', count }: { kind?: 'rows' | 'cards' | 'stats' | 'page'; count?: number }) {
  const n = count ?? (kind === 'cards' ? 6 : kind === 'stats' ? 4 : 5);
  const items = Array.from({ length: n }, (_, i) => i);
  return (
    <div role="status" aria-label="Loading" className="animate-rise">
      {kind === 'page' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-9 w-56 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}
      {kind === 'stats' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {items.map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      {kind === 'cards' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-edge bg-card">
              <Skeleton className="h-28 rounded-none" />
              <div className="space-y-2.5 p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          ))}
        </div>
      )}
      {kind === 'rows' && (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-edge bg-card">
          {items.map((i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4" style={{ width: `${70 - (i % 3) * 14}%` }} />
                <Skeleton className="h-3" style={{ width: `${44 - (i % 2) * 10}%` }} />
              </div>
              <Skeleton className="hidden h-8 w-20 sm:block" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-200">
      {msg}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-edge bg-card/60 px-6 py-12 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/**
 * `cols` gives per-column classes (e.g. 'hidden md:table-cell' to drop a column on phones; use the
 * same class on that column's <Td>). `compact` drops the 560 px minimum for tables built to fit phones.
 */
export function Table({ head, children, cols, compact }: { head: ReactNode[]; children: ReactNode; cols?: (string | undefined)[]; compact?: boolean }) {
  return (
    // tabIndex: a table wider than its box scrolls sideways, and keyboard users must reach it
    <div tabIndex={0} className="sticker overflow-x-auto rounded-xl bg-card">
      <table className={cx('w-full text-left text-sm', !compact && 'min-w-[560px]')}>
        <thead className="border-b border-line bg-surface/70 text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cx('px-3 py-3 font-semibold sm:px-4', cols?.[i])}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('px-3 py-3 align-top sm:px-4', className)}>{children}</td>;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // Keyboard users: focus moves into the dialog when it opens and back to where it was on close.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    // an input with autoFocus inside the dialog keeps the focus it already took
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => before?.focus?.();
  }, [open]);
  // Escape closes, like every dialog.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  if (!open) return null;
  // Rendered at the end of <body>: a page wrapper with a transform (the entrance animation) would
  // otherwise trap the dialog under the phone tab bar and the header.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full max-w-lg animate-rise overflow-y-auto rounded-t-2xl border border-edge bg-card p-5 shadow-pop-lg outline-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Tab stays inside the dialog
          if (e.key !== 'Tab' || !box.current) return;
          const items = box.current.querySelectorAll<HTMLElement>(FOCUSABLE);
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          const at = document.activeElement;
          if (e.shiftKey && (at === first || at === box.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && at === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export { cx };
