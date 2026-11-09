import { useState } from 'react';
import { PageHeader } from '../components/ui';

const THEME_KEY = 'openqz-theme';
type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
}

export default function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  function selectTheme(next: Theme) {
    setTheme(next);
    if (next === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-1 py-2 sm:px-2 sm:py-4">
      <PageHeader title="Settings" subtitle="Manage your OpenQZ preferences." />
      <section aria-labelledby="appearance-title" className="mt-10 max-w-2xl border-t border-line pt-8 sm:mt-12 sm:pt-10">
        <div className="space-y-2">
          <h2 id="appearance-title" className="text-xl font-bold tracking-tight">Appearance</h2>
          <p className="text-sm leading-6 text-muted">Choose how OpenQZ looks on this device.</p>
        </div>
        <fieldset className="mt-6 space-y-3">
          <legend className="sr-only">Theme</legend>
          {(['light', 'dark'] as const).map((option) => (
            <label key={option} className="flex w-fit cursor-pointer items-center gap-3 rounded-lg py-1 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={theme === option}
                onChange={() => selectTheme(theme === option ? 'system' : option)}
                className="h-4 w-4 shrink-0 accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              />
              <span>{option === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
            </label>
          ))}
        </fieldset>
      </section>
    </div>
  );
}
