import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-card text-ink border border-line hover:bg-brand-50',
    ghost: 'text-muted hover:bg-brand-50 hover:text-ink',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-200',
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-200',
        className,
      )}
      {...rest}
    />
  );
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
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-200"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </span>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('min-w-0 rounded-2xl border border-line bg-card p-5 shadow-sm', className)}>{children}</div>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'red' | 'amber' | 'brand'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-line text-ink',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    brand: 'bg-brand-100 text-brand-700 dark:text-brand-200',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
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
    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
      {msg}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
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
    <div tabIndex={0} className="overflow-x-auto rounded-2xl border border-line bg-card outline-none focus-visible:ring-2 focus-visible:ring-brand-200">
      <table className={cx('w-full text-left text-sm', !compact && 'min-w-[560px]')}>
        <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-t-2xl bg-card p-5 shadow-xl outline-none sm:rounded-2xl"
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
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export { cx };
