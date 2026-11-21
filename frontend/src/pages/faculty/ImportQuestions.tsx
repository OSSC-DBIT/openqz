import { useMutation } from '@tanstack/react-query';
import { Check, ClipboardPaste, FileSpreadsheet, FormInput, TriangleAlert, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { Activity, QuestionData } from '../../api/types';
import { TILE_COLORS, TYPES_FOR, TYPE_LABEL } from '../../components/quiz';
import { Badge, Button, ErrorText, Input, Textarea, cx } from '../../components/ui';

type Found = QuestionData & { needs_key?: boolean };
interface Preview {
  title: string | null;
  questions: Found[];
  skipped: { title: string; reason: string }[];
}
type Source = 'form' | 'sheet' | 'text';

const SOURCES: { id: Source; label: string; icon: typeof FormInput; help: string }[] = [
  { id: 'form', label: 'Google Form', icon: FormInput, help: 'Paste the link of a form' },
  { id: 'sheet', label: 'Spreadsheet', icon: FileSpreadsheet, help: 'Upload a .csv or .xlsx' },
  { id: 'text', label: 'Paste text', icon: ClipboardPaste, help: 'Type or paste questions' },
];

const SAMPLE_CSV = [
  'Question,Type,Option A,Option B,Option C,Option D,Correct,Marks,Time,Explanation',
  'What is the capital of France?,mcq,London,Paris,Rome,Berlin,B,1,30,Paris has been the capital since 987.',
  '"Which of these are prime numbers?",multi,2,4,3,9,"A, C",2,45,',
  'The Earth goes around the Sun.,true false,,,,,TRUE,1,20,',
  'Water boils at ___ degrees Celsius.,fill,,,,,100 | hundred,1,30,',
  'Explain why the sky is blue.,open,,,,,,5,,',
].join('\n');

const SAMPLE_TEXT = `1. What is the capital of France?
A) London
*B) Paris
C) Rome

2. Which of these are prime numbers?
A) 2
B) 4
C) 3
Answer: A, C

3. The Earth goes around the Sun.
Answer: true`;

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'openqz-questions-sample.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Why a question cannot be added yet, or null when it is ready. */
function problem(q: Found, kind: Activity['kind']): string | null {
  if (!TYPES_FOR[kind].includes(q.type)) return `${TYPE_LABEL[q.type]} questions are not used in this kind of activity`;
  if (kind === 'flashcards' && !(q.explanation ?? '').trim()) return 'A flashcard needs a back side (the Explanation column)';
  if (kind === 'quiz' || kind === 'assignment') {
    const right = q.options.filter((o) => o.correct).length;
    if ((q.type === 'mcq' || q.type === 'justify') && right !== 1) return 'Tap the correct answer';
    if (q.type === 'multi_select' && right === 0) return 'Tap every correct answer';
    if (q.type === 'true_false' && typeof q.answer.value !== 'boolean') return 'Tap True or False';
  }
  return null;
}

/**
 * Import questions from outside: a Google Form link, a spreadsheet, or pasted text.
 * Step 1 reads the source; step 2 is a review where the teacher marks the correct answers
 * (a Google Form never gives its key away) and picks what to keep. No AI is involved.
 */
export function ImportQuestions({ activity, onClose, onDone }: { activity: Activity; onClose: () => void; onDone: (a: Activity) => void }) {
  const [source, setSource] = useState<Source>('form');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<{ q: Found; keep: boolean }[] | null>(null);
  const [skipped, setSkipped] = useState<Preview['skipped']>([]);
  const kind = activity.kind;
  const graded = kind === 'quiz' || kind === 'assignment';

  const read = useMutation({
    mutationFn: async () => {
      if (source === 'form') return api<Preview>('/question-import/google-form', { method: 'POST', json: { url: url.trim() } });
      if (source === 'text') return api<Preview>('/question-import/text', { method: 'POST', json: { text } });
      const fd = new FormData();
      fd.append('file', file!);
      return api<Preview>('/question-import/file', { method: 'POST', body: fd });
    },
    onSuccess: (p) => {
      setSkipped(p.skipped);
      setItems(
        p.questions.map((q) => {
          // ungraded kinds carry no key and no marks
          const clean: Found = graded ? q : { ...q, marks: 0, options: q.options.map((o) => ({ ...o, correct: false })) };
          if (kind !== 'quiz') clean.time_limit_seconds = clean.time_limit_seconds ?? null;
          else clean.time_limit_seconds = clean.time_limit_seconds ?? 30;
          return { q: clean, keep: TYPES_FOR[kind].includes(q.type) };
        }),
      );
    },
  });

  const chosen = useMemo(() => (items ?? []).filter((x) => x.keep), [items]);
  const ready = chosen.filter((x) => !problem(x.q, kind));
  const waiting = chosen.length - ready.length;

  const add = useMutation({
    mutationFn: () =>
      api<Activity>(`/activities/${activity.id}/questions/bulk`, {
        method: 'POST',
        json: {
          questions: ready.map(({ q }) => {
            const { needs_key: _n, ...rest } = q;
            void _n;
            return { ...rest, marks: Number(rest.marks) };
          }),
        },
      }),
    onSuccess: onDone,
  });

  const patch = (i: number, q: Found) => setItems((cur) => (cur ? cur.map((x, j) => (j === i ? { ...x, q } : x)) : cur));
  const tap = (i: number, optIndex: number) => {
    const q = items![i].q;
    const single = q.type !== 'multi_select';
    patch(i, { ...q, options: q.options.map((o, j) => (j === optIndex ? { ...o, correct: single ? true : !o.correct } : single ? { ...o, correct: false } : o)) });
  };

  const canRead = source === 'form' ? url.trim().length > 10 : source === 'text' ? text.trim().length > 0 : !!file;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label="Import questions">
      <div className="border-b border-edge bg-card px-3 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <button onClick={onClose} className="rounded-xl border border-edge p-1.5 hover:bg-brand-50" aria-label="Close import">
            <X className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-extrabold">Import questions</h2>
          {items && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setItems(null)}>
                Back
              </Button>
              <Button loading={add.isPending} disabled={ready.length === 0} onClick={() => add.mutate()}>
                Add {ready.length} {ready.length === 1 ? 'question' : 'questions'}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {!items ? (
            <>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3" role="tablist" aria-label="Where from">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={source === s.id}
                    onClick={() => setSource(s.id)}
                    className={cx('press rounded-xl border p-3 text-left', source === s.id ? 'border-brand-500 bg-brand-50 shadow-pop ring-2 ring-brand-500/20' : 'border-edge bg-card shadow-pop-sm')}
                  >
                    <s.icon className="h-6 w-6 text-brand-ink" aria-hidden />
                    <span className="mt-2 block text-base font-semibold">{s.label}</span>
                    <span className="block text-xs text-muted">{s.help}</span>
                  </button>
                ))}
              </div>

              <div className="sticker rounded-xl bg-card p-4 sm:p-5">
                {source === 'form' && (
                  <div className="space-y-3">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-bold">Link of the Google Form</span>
                      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/forms/d/e/.../viewform" inputMode="url" autoFocus />
                    </label>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                      <li>The form must be open to anyone with the link (no sign-in to respond).</li>
                      <li>Multiple choice, dropdown, checkbox, scale, short answer and paragraph questions come across.</li>
                      <li>Google does not share the answer key, so you mark the correct answers in the next step.</li>
                    </ul>
                  </div>
                )}
                {source === 'sheet' && (
                  <div className="space-y-3">
                    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-edge px-4 py-8 text-center hover:bg-brand-50">
                      <Upload className="h-7 w-7 text-brand-ink" aria-hidden />
                      <span className="font-bold">{file ? file.name : 'Choose a .csv or .xlsx file'}</span>
                      <span className="text-xs text-muted">One question per row, 2 MB at most</span>
                      <input type="file" accept=".csv,.xlsx,.tsv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Spreadsheet file" />
                    </label>
                    <p className="text-sm text-muted">
                      Columns: <b>Question</b>, Type, Option A to Option J, Correct, Marks, Time, Explanation. Only Question is required.{' '}
                      <button type="button" onClick={downloadSample} className="font-bold text-brand-ink underline">
                        Download a sample sheet
                      </button>
                    </p>
                  </div>
                )}
                {source === 'text' && (
                  <div className="space-y-3">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-bold">Questions</span>
                      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={SAMPLE_TEXT} className="font-mono" />
                    </label>
                    <p className="text-sm text-muted">
                      Leave an empty line between questions. Put a star before the correct option, or add a line like "Answer: B".{' '}
                      <button type="button" onClick={() => setText(SAMPLE_TEXT)} className="font-bold text-brand-ink underline">
                        Fill in an example
                      </button>
                    </p>
                  </div>
                )}
                <div className="mt-4 space-y-3">
                  <ErrorText error={read.error} />
                  <Button loading={read.isPending} disabled={!canRead} onClick={() => read.mutate()}>
                    Read questions
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                <Badge tone="green">{ready.length} ready</Badge>
                {waiting > 0 && <Badge tone="amber">{waiting} need an answer</Badge>}
                {skipped.length > 0 && <Badge tone="neutral">{skipped.length} left out</Badge>}
                <span className="text-sm text-muted">Tap a tile to mark it correct. Untick a question to leave it out.</span>
              </div>
              <ErrorText error={add.error} />
              {items.length === 0 && <p className="sticker rounded-xl bg-card p-6 text-center font-bold">Nothing here could be imported.</p>}
              <ol className="space-y-3">
                {items.map(({ q, keep }, i) => {
                  const why = problem(q, kind);
                  const usable = TYPES_FOR[kind].includes(q.type);
                  return (
                    <li key={i} className={cx('sticker rounded-xl bg-card p-3 sm:p-4', !keep && 'opacity-60')}>
                      <div className="flex flex-wrap items-start gap-3">
                        <label className="flex items-center gap-2 text-sm font-extrabold">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-[var(--color-brand-600)]"
                            checked={keep}
                            disabled={!usable}
                            onChange={(e) => setItems((cur) => cur!.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                            aria-label={`Include question ${i + 1}`}
                          />
                          Q{i + 1}
                        </label>
                        <span className="text-xs font-bold uppercase tracking-wide text-muted">{TYPE_LABEL[q.type]}</span>
                        {keep &&
                          (why ? (
                            <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                              <TriangleAlert className="h-4 w-4" aria-hidden /> {why}
                            </span>
                          ) : (
                            <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                              <Check className="h-4 w-4" aria-hidden /> Ready
                            </span>
                          ))}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap font-semibold">{q.stem}</p>
                      {q.type !== 'true_false' && q.options.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {q.options.map((o, j) => (
                            <button
                              key={j}
                              type="button"
                              disabled={!graded || !keep}
                              aria-pressed={!!o.correct}
                              aria-label={`Question ${i + 1}, option ${o.text}${o.correct ? ', correct' : ''}`}
                              onClick={() => tap(i, j)}
                              style={{ background: TILE_COLORS[j % TILE_COLORS.length] }}
                              className={cx(
                                'flex min-h-12 items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-xl font-bold text-white transition',
                                o.correct ? 'border-white shadow-pop ring-2 ring-emerald-400' : 'border-transparent',
                              )}
                            >
                              <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-white', o.correct && 'bg-white text-emerald-700')}>{o.correct && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}</span>
                              <span className="min-w-0 break-words">{o.text}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {q.type === 'true_false' && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {[true, false].map((v, j) => {
                            const on = q.answer.value === v;
                            return (
                              <button
                                key={String(v)}
                                type="button"
                                disabled={!keep}
                                aria-pressed={on}
                                onClick={() => patch(i, { ...q, answer: { value: v }, options: q.options.map((o) => ({ ...o, correct: o.id === String(v) })) })}
                                style={{ background: TILE_COLORS[j] }}
                                className={cx('min-h-12 rounded-xl border-2 px-3 py-2 text-xl font-bold text-white', on ? 'border-white shadow-pop ring-2 ring-emerald-400' : 'border-transparent')}
                              >
                                {v ? 'True' : 'False'}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {q.type === 'fill_blank' && <p className="mt-2 text-sm text-muted">Answers: {((q.answer.blanks as string[][]) ?? []).map((b) => b.join(' / ')).join(' ; ')}</p>}
                    </li>
                  );
                })}
              </ol>
              {skipped.length > 0 && (
                <details className="sticker-sm rounded-xl bg-card p-4">
                  <summary className="cursor-pointer font-bold">Left out ({skipped.length})</summary>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {skipped.map((s, i) => (
                      <li key={i}>
                        <b className="text-ink">{s.title}</b>: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
