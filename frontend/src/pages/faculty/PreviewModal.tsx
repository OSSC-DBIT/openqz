import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import type { Activity } from '../../api/types';
import { AuthImage, TILE_COLORS, TYPE_LABEL, fmtSeconds } from '../../components/quiz';
import { Button } from '../../components/ui';

/** "Preview as student": the questions as the player shows them. Nothing is saved. */
export function PreviewModal({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const q = activity.questions[i];
  if (!q) return null;
  const blanks = ((q.answer.blanks as string[][] | undefined) ?? []).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1e1640] text-white" role="dialog" aria-modal="true" aria-label="Student preview">
      <header className="flex items-center gap-3 px-4 py-3">
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
          {i + 1} / {activity.questions.length}
        </span>
        <span className="text-sm text-white/70">
          Preview | {TYPE_LABEL[q.type]}
          {q.time_limit_seconds ? ` | ${fmtSeconds(q.time_limit_seconds)}` : ''}
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> Show answers
        </label>
        <button className="rounded-full bg-white/10 p-1.5" onClick={onClose} aria-label="Close preview">
          <X className="h-5 w-5" />
        </button>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-4 pb-4">
        <div className="my-4 flex min-h-[28vh] flex-col items-center justify-center rounded-3xl bg-white/5 p-5 text-center">
          {q.stem_image_id && <AuthImage id={q.stem_image_id} className="mb-3 max-h-56 rounded-xl" />}
          <p className="whitespace-pre-wrap text-xl font-semibold sm:text-2xl">{q.stem || '(empty question)'}</p>
        </div>
        {q.options.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {q.options.map((o, j) => (
              <div
                key={j}
                className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl p-4 text-center text-lg font-semibold ${showKey && o.correct ? 'ring-4 ring-emerald-300' : ''}`}
                style={{ background: TILE_COLORS[j % TILE_COLORS.length] }}
              >
                {o.image_id && <AuthImage id={o.image_id} className="max-h-28 rounded-lg" />}
                <span>{o.text}</span>
              </div>
            ))}
          </div>
        )}
        {q.type === 'true_false' && (
          <div className="grid grid-cols-2 gap-3">
            {['True', 'False'].map((label, j) => (
              <div
                key={label}
                className={`rounded-2xl p-6 text-center text-lg font-bold ${showKey && (q.answer.value === true) === (label === 'True') ? 'ring-4 ring-emerald-300' : ''}`}
                style={{ background: TILE_COLORS[j] }}
              >
                {label}
              </div>
            ))}
          </div>
        )}
        {q.type === 'fill_blank' &&
          Array.from({ length: blanks }, (_, j) => (
            <div key={j} className="mb-2 rounded-2xl bg-white px-4 py-3 text-ink">
              {showKey ? (q.answer.blanks as string[][])[j].join(' / ') : `Blank ${j + 1}`}
            </div>
          ))}
        {(q.type === 'open_ended' || q.type === 'justify') && <div className="mt-3 h-32 rounded-2xl bg-white/90 p-4 text-muted">Student types here</div>}
        {showKey && q.explanation && <p className="mt-4 rounded-2xl bg-white/10 p-3 text-sm">{q.explanation}</p>}
      </main>
      <footer className="flex justify-between px-4 py-3">
        <Button variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <Button disabled={i >= activity.questions.length - 1} onClick={() => setI(i + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </footer>
    </div>
  );
}
