import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { TIMER_PRESETS, fmtSeconds } from './quiz';
import { Button, Modal, cx } from './ui';

export const TIMER_MIN = 5;
export const TIMER_MAX = 3600;

const two = (n: number) => String(n).padStart(2, '0');

/** One half of the clock (minutes or seconds): a big number with up and down buttons. */
function Wheel({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  const wrap = (v: number) => (v > max ? 0 : v < 0 ? max : v);
  const arrow = 'grid h-9 w-full place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white';
  return (
    <div className="flex w-24 flex-col items-center gap-1">
      <button type="button" className={arrow} aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(wrap(value + 1))}>
        <ChevronUp className="h-5 w-5" aria-hidden />
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={two(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, '').slice(-2));
          onChange(Math.min(max, Number.isFinite(n) ? n : 0));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(wrap(value + 1));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(wrap(value - 1));
          }
        }}
        className="w-full rounded-xl bg-black/40 py-2 text-center font-mono text-5xl font-bold tabular-nums text-emerald-300 outline-none focus:ring-2 focus:ring-emerald-300/60"
      />
      <button type="button" className={arrow} aria-label={`Less ${label.toLowerCase()}`} onClick={() => onChange(wrap(value - 1))}>
        <ChevronDown className="h-5 w-5" aria-hidden />
      </button>
      <span className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</span>
    </div>
  );
}

/** A digital clock (minutes : seconds) for a timer of any length from 5 seconds to 60 minutes. */
export function TimerClock({ initial, onSet, onClose }: { initial: number | null; onSet: (seconds: number) => void; onClose: () => void }) {
  const start = initial && initial >= TIMER_MIN ? Math.min(initial, TIMER_MAX) : 30;
  const [min, setMin] = useState(Math.floor(start / 60));
  const [sec, setSec] = useState(start % 60);
  const total = min * 60 + sec;
  const valid = total >= TIMER_MIN && total <= TIMER_MAX;
  const add = (s: number) => {
    const next = Math.min(TIMER_MAX, Math.max(0, total + s));
    setMin(Math.floor(next / 60));
    setSec(next % 60);
  };
  return (
    <Modal open onClose={onClose} title="Custom time">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) onSet(total);
        }}
      >
        <div className="rounded-2xl bg-[#15122b] p-5">
          <div className="flex items-center justify-center gap-2">
            <Wheel label="Minutes" value={min} max={60} onChange={setMin} />
            <span className="pb-6 font-mono text-5xl font-bold text-emerald-300" aria-hidden>
              :
            </span>
            <Wheel label="Seconds" value={sec} max={59} onChange={setSec} />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {[
              ['+10 s', 10],
              ['+30 s', 30],
              ['+1 min', 60],
              ['+5 min', 300],
            ].map(([label, s]) => (
              <button key={label} type="button" onClick={() => add(Number(s))} className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white hover:bg-white/20">
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setMin(0);
                setSec(0);
              }}
              className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white hover:bg-white/20"
            >
              Clear
            </button>
          </div>
        </div>
        <p role={valid ? undefined : 'alert'} className={cx('mt-3 text-sm', valid ? 'text-muted' : 'font-semibold text-red-600 dark:text-red-400')}>
          {valid ? `Each student gets ${fmtSeconds(total)} for the question.` : 'Choose a time from 5 seconds to 60 minutes.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Set timer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Timer drop-down: the presets, plus "Custom..." which opens the clock. `value` is seconds as
 * text, or one of the `head` choices (for example "" = no timer).
 */
export function TimerSelect({
  value,
  onChange,
  head = [['', 'No timer']],
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  head?: [string, string][];
  className?: string;
  'aria-label': string;
}) {
  const [clock, setClock] = useState(false);
  const seconds = /^\d+$/.test(value) ? Number(value) : null;
  const times = [...new Set([...TIMER_PRESETS, ...(seconds ? [seconds] : [])])].sort((a, b) => a - b);
  return (
    <>
      <select
        {...rest}
        className={className}
        value={value}
        onChange={(e) => {
          // "Custom..." is a command, not a value: the drop-down keeps what it had until a time is set.
          if (e.target.value === 'custom') setClock(true);
          else onChange(e.target.value);
        }}
      >
        {head.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        {times.map((s) => (
          <option key={s} value={s}>
            {fmtSeconds(s)}
          </option>
        ))}
        <option value="custom">Custom...</option>
      </select>
      {clock && (
        <TimerClock
          initial={seconds}
          onClose={() => setClock(false)}
          onSet={(s) => {
            setClock(false);
            onChange(String(s));
          }}
        />
      )}
    </>
  );
}
