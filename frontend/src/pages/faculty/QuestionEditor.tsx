import { CheckCircle2, Circle, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { ActivityKind, QOption, QuestionData, QuestionType, RubricItem } from '../../api/types';
import { Button, Input, Select } from '../../components/ui';
import {
  AuthImage,
  MARK_PRESETS,
  TILE_COLORS,
  TIMER_PRESETS,
  TYPES_FOR,
  TYPE_LABEL,
  fmtSeconds,
  uploadImage,
} from '../../components/quiz';

export function blankQuestion(type: QuestionType, kind: ActivityKind): QuestionData {
  const options: QOption[] =
    type === 'mcq' || type === 'justify' || type === 'multi_select'
      ? [{ text: '' }, { text: '' }, { text: '' }, { text: '' }]
      : [];
  return {
    type,
    stem: '',
    stem_image_id: null,
    options,
    answer: type === 'true_false' ? { value: true } : type === 'fill_blank' ? { blanks: [['']], case_sensitive: false } : {},
    marks: kind === 'poll' || kind === 'flashcards' ? 0 : 1,
    partial_credit: true,
    explanation: '',
    tags: [],
    time_limit_seconds: kind === 'quiz' ? 30 : null,
    rubric: [],
  };
}

function ImageButton({ value, onChange, label }: { value?: string | null; onChange: (id: string | null) => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (value) {
    return (
      <div className="relative inline-block">
        <AuthImage id={value} className="max-h-40 rounded-lg" />
        <button type="button" onClick={() => onChange(null)} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white" title="Remove image">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted hover:text-ink" title={label}>
      <ImagePlus className="h-4 w-4" /> {busy ? 'Uploading...' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          setErr(null);
          try {
            onChange(await uploadImage(f));
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Upload failed');
          } finally {
            setBusy(false);
          }
        }}
      />
      {err && <span className="text-red-600">{err}</span>}
    </label>
  );
}

/** Type, timer and marks: shown in the editor's top bar, like Wayground. */
export function QuestionToolbar({ kind, value, onChange }: { kind: ActivityKind; value: QuestionData; onChange: (q: QuestionData) => void }) {
  const q = value;
  const set = (patch: Partial<QuestionData>) => onChange({ ...q, ...patch });
  const graded = kind === 'quiz' || kind === 'assignment';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="!w-auto"
        value={q.type}
        onChange={(e) => {
          const t = e.target.value as QuestionType;
          const fresh = blankQuestion(t, kind);
          onChange({ ...fresh, stem: q.stem, stem_image_id: q.stem_image_id, explanation: q.explanation, marks: q.marks, time_limit_seconds: q.time_limit_seconds, tags: q.tags, rubric: t === 'open_ended' || t === 'justify' ? q.rubric : [] });
        }}
        aria-label="Question type"
      >
        {TYPES_FOR[kind].map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      {kind !== 'flashcards' && (
        <Select
          className="!w-auto"
          aria-label="Timer"
          value={q.time_limit_seconds ?? ''}
          onChange={(e) => set({ time_limit_seconds: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">No timer</option>
          {[...new Set([...TIMER_PRESETS, ...(q.time_limit_seconds ? [q.time_limit_seconds] : [])])]
            .sort((a, b) => a - b)
            .map((s) => (
              <option key={s} value={s}>
                {fmtSeconds(s)}
              </option>
            ))}
        </Select>
      )}
      {kind !== 'flashcards' && (
        <Input
          className="!w-28"
          type="number"
          min={5}
          max={3600}
          placeholder="Custom s"
          aria-label="Custom timer seconds"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= 5 && v <= 3600) set({ time_limit_seconds: v });
            e.target.value = '';
          }}
        />
      )}
      {graded && (
        <Select className="!w-auto" aria-label="Marks" value={String(Number(q.marks))} onChange={(e) => set({ marks: Number(e.target.value) })}>
          {[...new Set([...MARK_PRESETS, Number(q.marks)])]
            .sort((a, b) => a - b)
            .map((p) => (
              <option key={p} value={p}>
                {p} {p === 1 ? 'mark' : 'marks'}
              </option>
            ))}
        </Select>
      )}
    </div>
  );
}

export function QuestionEditor({
  kind,
  value,
  onChange,
}: {
  kind: ActivityKind;
  value: QuestionData;
  onChange: (q: QuestionData) => void;
}) {
  const q = value;
  const set = (patch: Partial<QuestionData>) => onChange({ ...q, ...patch });
  const graded = kind === 'quiz' || kind === 'assignment';
  const hasOptions = q.type === 'mcq' || q.type === 'justify' || q.type === 'multi_select';
  const single = q.type === 'mcq' || q.type === 'justify';
  const blanks = ((q.answer.blanks as string[][] | undefined) ?? [['']]).map((b) => b.join(' | '));

  const setOption = (i: number, patch: Partial<QOption>) => {
    const options = q.options.map((o, j) => {
      if (j === i) return { ...o, ...patch };
      if (patch.correct && single) return { ...o, correct: false };
      return o;
    });
    set({ options });
  };

  return (
    <div className="space-y-4">
      {/* stem */}
      <div className="rounded-2xl bg-[#2b2257] p-5 text-white shadow-[inset_0_-4px_0_rgba(0,0,0,0.25)] sm:p-8">
        <textarea
          className="min-h-32 w-full resize-y bg-transparent text-center text-xl font-bold outline-none placeholder:text-white/70 sm:text-2xl"
          rows={3}
          placeholder={
            kind === 'flashcards' ? 'Front of the card' : q.type === 'fill_blank' ? 'Type the question, use ___ for each blank' : 'Type your question here'
          }
          value={q.stem}
          onChange={(e) => set({ stem: e.target.value })}
          aria-label="Question"
        />
        <div className="mt-2 flex justify-center [&_*]:text-white/85">
          <ImageButton label="Add image" value={q.stem_image_id} onChange={(id) => set({ stem_image_id: id })} />
        </div>
      </div>

      {/* answers */}
      {hasOptions && (
        <div>
          <div className={`grid gap-3 sm:grid-cols-2 ${q.options.length >= 4 ? 'lg:grid-cols-4' : q.options.length === 3 ? 'lg:grid-cols-3' : ''}`}>
            {q.options.map((o, i) => (
              <div
                key={i}
                className={`flex min-h-44 flex-col rounded-2xl p-3 text-white shadow-[inset_0_-6px_0_rgba(0,0,0,0.22)] ${o.correct ? 'outline outline-4 outline-offset-2 outline-emerald-400' : ''}`}
                style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  {q.options.length > 2 ? (
                    <button type="button" onClick={() => set({ options: q.options.filter((_, j) => j !== i) })} title="Remove option" aria-label={`Remove option ${i + 1}`} className="rounded-lg bg-black/20 p-1.5 hover:bg-black/30">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <span />
                  )}
                  {kind !== 'poll' ? (
                    <button
                      type="button"
                      onClick={() => setOption(i, { correct: !o.correct })}
                      className={`grid h-8 w-8 place-items-center rounded-full border-2 border-white ${o.correct ? 'bg-emerald-500' : 'bg-black/15 hover:bg-black/25'}`}
                      aria-label={`Mark option ${i + 1} correct`}
                      aria-pressed={!!o.correct}
                      title={o.correct ? 'Correct answer' : 'Mark as correct'}
                    >
                      {o.correct ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-4 w-4 opacity-0" />}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold opacity-90">Option {i + 1}</span>
                  )}
                </div>
                <textarea
                  rows={3}
                  className="w-full flex-1 resize-none bg-transparent text-center text-lg font-bold outline-none placeholder:text-white/80"
                  placeholder="Type an answer option"
                  value={o.text}
                  onChange={(e) => setOption(i, { text: e.target.value })}
                  aria-label={`Option ${i + 1}`}
                />
                <div className="flex justify-center [&_*]:text-white/90">
                  <ImageButton label="Image" value={o.image_id} onChange={(id) => setOption(i, { image_id: id })} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {q.options.length < 8 && (
              <Button variant="secondary" type="button" onClick={() => set({ options: [...q.options, { text: '' }] })}>
                <Plus className="h-4 w-4" /> Add option
              </Button>
            )}
            {kind !== 'poll' && (
              <span className="text-sm text-muted">{q.type === 'multi_select' ? 'Tick every correct answer.' : 'Tick the correct answer.'}</span>
            )}
            {q.type === 'multi_select' && graded && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={q.partial_credit} onChange={(e) => set({ partial_credit: e.target.checked })} />
                Partial credit
              </label>
            )}
          </div>
        </div>
      )}

      {q.type === 'true_false' && (
        <div className="grid grid-cols-2 gap-3">
          {[true, false].map((v, i) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => set({ answer: { value: v } })}
              aria-pressed={q.answer.value === v}
              className={`flex min-h-40 items-center justify-center gap-2 rounded-2xl p-6 text-2xl font-bold text-white shadow-[inset_0_-6px_0_rgba(0,0,0,0.22)] ${q.answer.value === v ? 'outline outline-4 outline-offset-2 outline-emerald-400' : ''}`}
              style={{ background: TILE_COLORS[i] }}
            >
              {q.answer.value === v ? <CheckCircle2 className="h-6 w-6" /> : <Circle className="h-6 w-6 opacity-70" />}
              {v ? 'True' : 'False'}
            </button>
          ))}
        </div>
      )}

      {q.type === 'fill_blank' && (
        <div className="space-y-2">
          <p className="text-sm text-muted">Accepted answers for each blank. Separate alternatives with |, e.g. "colour | color".</p>
          {blanks.map((b, i) => (
            <div key={i} className="flex gap-2">
              <span className="mt-2.5 w-16 shrink-0 text-sm font-semibold">Blank {i + 1}</span>
              <Input
                value={b}
                onChange={(e) => {
                  const next = [...blanks];
                  next[i] = e.target.value;
                  set({ answer: { ...q.answer, blanks: next.map((x) => x.split('|').map((s) => s.trim())) } });
                }}
                aria-label={`Blank ${i + 1} answers`}
              />
              {blanks.length > 1 && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => set({ answer: { ...q.answer, blanks: blanks.filter((_, j) => j !== i).map((x) => x.split('|').map((s) => s.trim())) } })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => set({ answer: { ...q.answer, blanks: [...blanks.map((x) => x.split('|').map((s) => s.trim())), ['']] } })}
            >
              <Plus className="h-4 w-4" /> Add blank
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(q.answer.case_sensitive)}
                onChange={(e) => set({ answer: { ...q.answer, case_sensitive: e.target.checked } })}
              />
              Case sensitive
            </label>
          </div>
        </div>
      )}

      {q.type === 'open_ended' && kind !== 'flashcards' && (
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-muted">
          {kind === 'poll' ? 'Students type a free answer.' : 'Students type an answer; you grade it from the report.'}
        </p>
      )}
      {q.type === 'justify' && <p className="text-sm text-muted">Students pick an option and explain why. You grade the explanation.</p>}

      {graded && (q.type === 'open_ended' || q.type === 'justify') && <RubricEditor q={q} set={set} />}

      {/* explanation / back of card, tags */}
      <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
        <label htmlFor="q-explanation" className="text-sm font-semibold">
          {kind === 'flashcards' ? 'Back of the card' : 'Answer explanation (shown after answering)'}
        </label>
        <textarea
          id="q-explanation"
          rows={2}
          className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
          value={q.explanation ?? ''}
          onChange={(e) => set({ explanation: e.target.value })}
        />
        <Input
          key={q.tags.join(',')}
          placeholder="Tags, comma separated (e.g. unit2, recursion)"
          defaultValue={q.tags.join(', ')}
          onBlur={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          aria-label="Tags"
        />
      </div>
    </div>
  );
}

function RubricEditor({ q, set }: { q: QuestionData; set: (patch: Partial<QuestionData>) => void }) {
  const rows = q.rubric ?? [];
  const total = rows.reduce((t, r) => t + (Number(r.max) || 0), 0);
  const marks = Number(q.marks);
  const update = (i: number, patch: Partial<RubricItem>) => set({ rubric: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Rubric (optional)</span>
        {rows.length > 0 && (
          <span className={total === marks ? 'text-xs text-emerald-600' : 'text-xs text-red-600'}>
            {total} of {marks} marks
            {total !== marks && (
              <button type="button" className="ml-2 underline" onClick={() => set({ marks: total })}>
                use {total} as marks
              </button>
            )}
          </span>
        )}
      </div>
      {rows.length === 0 && <p className="mb-2 text-xs text-muted">Split the marks into criteria (e.g. Accuracy 3, Clarity 2) to grade consistently.</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input placeholder="Criterion, e.g. Correct concept" value={r.criterion} onChange={(e) => update(i, { criterion: e.target.value })} aria-label={`Criterion ${i + 1}`} />
            <Input className="!w-24" type="number" min={0.5} step={0.5} value={r.max} onChange={(e) => update(i, { max: e.target.value })} aria-label={`Criterion ${i + 1} marks`} />
            <Button variant="ghost" type="button" title="Remove criterion" onClick={() => set({ rubric: rows.filter((_, j) => j !== i) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="secondary" type="button" className="mt-2" onClick={() => set({ rubric: [...rows, { criterion: '', max: 1 }] })}>
        <Plus className="h-4 w-4" /> Add criterion
      </Button>
    </div>
  );
}
