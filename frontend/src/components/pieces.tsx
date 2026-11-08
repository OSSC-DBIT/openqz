import { useState } from 'react';
import {
  AlignLeft,
  BookOpenCheck,
  CheckCheck,
  CheckSquare,
  ClipboardList,
  Layers,
  ListChecks,
  MessageSquareQuote,
  TextCursorInput,
  ToggleLeft,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityKind, MyClasses, QuestionType } from '../api/types';
import { TYPE_LABEL } from './quiz';
import { Modal, cx } from './ui';

export const KIND_STYLE: Record<ActivityKind, { icon: LucideIcon; from: string; to: string }> = {
  quiz: { icon: ListChecks, from: '#6d4fe0', to: '#9b7bff' },
  assignment: { icon: ClipboardList, from: '#0e7490', to: '#22b8cf' },
  poll: { icon: BookOpenCheck, from: '#c2410c', to: '#f59e0b' },
  flashcards: { icon: Layers, from: '#15803d', to: '#4ade80' },
};

/** Coloured cover strip for an activity card. */
export function KindCover({ kind, className, children }: { kind: ActivityKind; className?: string; children?: React.ReactNode }) {
  const st = KIND_STYLE[kind];
  const Icon = st.icon;
  return (
    <div className={cx('relative flex items-center justify-center overflow-hidden', className)} style={{ background: `linear-gradient(135deg, ${st.from}, ${st.to})` }}>
      <Icon className="h-10 w-10 text-white/90" aria-hidden />
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10" aria-hidden />
      <div className="absolute -bottom-8 -left-4 h-24 w-24 rounded-full bg-white/10" aria-hidden />
      {children}
    </div>
  );
}

export const TYPE_ICON: Record<QuestionType, LucideIcon> = {
  mcq: CheckSquare,
  true_false: ToggleLeft,
  multi_select: CheckCheck,
  fill_blank: TextCursorInput,
  justify: MessageSquareQuote,
  open_ended: AlignLeft,
};

const TYPE_HELP: Record<QuestionType, string> = {
  mcq: 'One correct answer',
  true_false: 'True or false',
  multi_select: 'Several correct answers',
  fill_blank: 'Type the missing words',
  justify: 'Pick an answer and explain why',
  open_ended: 'Free written answer',
};

/** Grid of question types, shown when adding a question. */
export function TypePicker({ types, open, onClose, onPick }: { types: QuestionType[]; open: boolean; onClose: () => void; onPick: (t: QuestionType) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a question">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-line p-4 text-center transition hover:border-brand-500 hover:bg-brand-50"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:text-brand-200">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="text-sm font-semibold">{TYPE_LABEL[t]}</span>
              <span className="text-xs text-muted">{TYPE_HELP[t]}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Pick classes: Branch first, then any number of sections grouped by semester.
 * Only sections the teacher teaches are listed; picks can span branches and semesters.
 */
export function ClassPicker({ data, value, onChange }: { data: MyClasses | undefined; value: number[]; onChange: (ids: number[]) => void }) {
  const classes = data?.classes ?? [];
  const branches = data?.branches?.length ? data.branches : [...new Map(classes.map((c) => [c.department_id, { id: c.department_id, code: c.department_code ?? '?', name: c.department_code ?? '?' }])).values()];
  const firstPicked = classes.find((c) => value.includes(c.section_id))?.department_id;
  const [branch, setBranch] = useState<number | null>(firstPicked ?? data?.department?.id ?? branches[0]?.id ?? null);
  if (!data) return null;
  if (!data.can_use_sections) return <p className="text-sm text-muted">Club activities are shared with a join code, so no class is needed.</p>;
  if (!classes.length) return <p className="text-sm text-amber-700">You are not mapped to any class yet. Ask the admin; you can still create it and pick classes later.</p>;
  const current = branches.some((b) => b.id === branch) ? branch : branches[0]?.id;
  const shown = classes.filter((c) => c.department_id === current);
  const sems = [...new Set(shown.map((c) => c.semester))].sort((a, b) => a - b);
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const pickedIn = (deptId: number) => classes.filter((c) => c.department_id === deptId && value.includes(c.section_id)).length;
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Branch</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Branch">
          {branches.map((b) => {
            const on = b.id === current;
            const n = pickedIn(b.id);
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                onClick={() => setBranch(b.id)}
                title={b.name}
                className={cx('rounded-xl border-2 px-3 py-1.5 text-sm font-bold', on ? 'border-brand-600 bg-brand-50 text-brand-700 dark:text-brand-200' : 'border-line text-muted hover:border-brand-500')}
              >
                {b.code}
                {n > 0 && <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-xs text-white">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Semester and sections</div>
        <div className="space-y-2" role="group" aria-label="Classes">
          {sems.map((sem) => {
            const inSem = shown.filter((c) => c.semester === sem);
            const allOn = inSem.every((c) => value.includes(c.section_id));
            return (
              <div key={sem} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(allOn ? value.filter((x) => !inSem.some((c) => c.section_id === x)) : [...new Set([...value, ...inSem.map((c) => c.section_id)])])}
                  className="w-16 text-left text-xs font-bold uppercase text-muted hover:text-ink"
                  aria-label={`Sem ${sem}: ${allOn ? 'clear all' : 'select all'}`}
                  title={allOn ? 'Clear this semester' : 'Select the whole semester'}
                >
                  Sem {sem}
                </button>
                {inSem.map((c) => {
                  const on = value.includes(c.section_id);
                  return (
                    <button
                      key={c.section_id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(c.section_id)}
                      className={cx('rounded-full border px-3 py-1 text-sm', on ? 'border-brand-600 bg-brand-600 font-semibold text-white' : 'border-line hover:border-brand-500')}
                    >
                      {c.department_code} {c.section}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {value.length > 0 && (
        <p className="text-xs text-muted" aria-live="polite">
          Selected:{' '}
          {classes
            .filter((c) => value.includes(c.section_id))
            .map((c) => c.label)
            .join(', ')}
        </p>
      )}
    </div>
  );
}

export function Pill({ children, tone = 'line' }: { children: React.ReactNode; tone?: 'line' | 'brand' }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tone === 'brand' ? 'bg-brand-100 text-brand-700 dark:text-brand-200' : 'bg-line text-ink')}>
      {children}
    </span>
  );
}
