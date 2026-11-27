import { useState, type FormEvent } from 'react';
import { Button, Field, Input, Modal, cx } from './ui';
import { amount, type Unit } from './units';

/** The most a club can give one question (teachers: 100 marks). Keep it equal to the API's. */
export const POINTS_MAX = 1000;
export const MARKS_MAX = 100;

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

/** Type any value for one question: whole numbers or up to two decimals, 0 to `max`. */
export function CustomPoints({ unit, initial, max, onSet, onClose }: { unit: Unit; initial: number | null; max: number; onSet: (v: number) => void; onClose: () => void }) {
  const [text, setText] = useState(initial === null ? '' : String(initial));
  const v = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= max && twoDecimals(v);
  return (
    <Modal open onClose={onClose} title={`Custom ${unit.many}`}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) onSet(v);
        }}
      >
        <Field label={`${unit.Many} for a right answer`} hint={`Any number from 0 to ${max}, for example 15, 250 or 2.5.`}>
          <Input type="number" inputMode="decimal" min={0} max={max} step="any" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {text.trim() !== '' && !valid && (
          <p role="alert" className="mt-2 text-sm font-semibold text-red-600 dark:text-red-400">
            Choose a number from 0 to {max}, with at most two decimals.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Set {unit.many}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Marks / points drop-down: the presets plus the current value, and (when `custom`) a
 * "Custom..." choice that opens a box for any value. `value` is the number as text, or one of
 * the `head` choices (for example "keep").
 */
export function PointsSelect({
  value,
  onChange,
  unit,
  presets,
  custom = false,
  max = MARKS_MAX,
  head = [],
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  unit: Unit;
  presets: number[];
  custom?: boolean;
  max?: number;
  head?: [string, string][];
  className?: string;
  'aria-label': string;
}) {
  const [open, setOpen] = useState(false);
  const current = value !== '' && !head.some(([v]) => v === value) && Number.isFinite(Number(value)) ? Number(value) : null;
  const choices = [...new Set([...presets, ...(current === null ? [] : [current])])].sort((a, b) => a - b);
  return (
    <>
      <select
        {...rest}
        className={cx(className)}
        value={value}
        onChange={(e) => {
          // "Custom..." is a command, not a value: the drop-down keeps what it had until one is set.
          if (e.target.value === 'custom') setOpen(true);
          else onChange(e.target.value);
        }}
      >
        {head.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        {choices.map((m) => (
          <option key={m} value={String(m)}>
            {amount(m, unit)}
          </option>
        ))}
        {custom && <option value="custom">Custom...</option>}
      </select>
      {open && (
        <CustomPoints
          unit={unit}
          initial={current}
          max={max}
          onClose={() => setOpen(false)}
          onSet={(v) => {
            setOpen(false);
            onChange(String(v));
          }}
        />
      )}
    </>
  );
}
