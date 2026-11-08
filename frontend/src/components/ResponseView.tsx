import { Check, X } from 'lucide-react';
import type { QuestionType } from '../api/types';

/** Read-only rendering of a student's answer (and optionally the right one). */
export function ResponseView({
  type,
  response,
  options,
  showCorrect,
  keyChoices,
  keyBlanks,
}: {
  type: QuestionType;
  response: Record<string, unknown> | null;
  options: { id: string; text: string; correct?: boolean }[];
  showCorrect?: boolean;
  keyChoices?: string[];
  keyBlanks?: string[];
}) {
  if (!response) return <span className="italic text-muted">No answer</span>;
  const chosen = new Set<string>([
    ...((response.choices as string[] | undefined) ?? []),
    ...(response.choice ? [String(response.choice)] : []),
  ]);
  const correctIds = new Set(keyChoices ?? options.filter((o) => o.correct).map((o) => o.id));
  const text = response.text ? String(response.text) : '';

  return (
    <div className="space-y-1.5">
      {options.length > 0 && (
        <ul className="space-y-1">
          {options.map((o) => {
            const picked = chosen.has(o.id);
            const right = (showCorrect || keyChoices) && correctIds.has(o.id);
            if (!picked && !right) return null;
            return (
              <li key={o.id} className="flex items-center gap-1.5">
                {picked ? (right || !(showCorrect || keyChoices) ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-red-600" />) : <Check className="h-4 w-4 text-emerald-600 opacity-50" />}
                <span className={picked ? 'font-semibold' : 'text-muted'}>
                  {o.text || '(image)'} {!picked && right ? '(correct answer)' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {type === 'fill_blank' && (
        <div>
          {((response.blanks as string[] | undefined) ?? []).map((b, i) => (
            <span key={i} className="mr-2 inline-block rounded-md bg-card px-2 py-0.5 font-mono text-sm">
              {b || '_'}
              {keyBlanks?.[i] !== undefined && <span className="ml-1 text-xs text-muted">(answer: {keyBlanks[i]})</span>}
            </span>
          ))}
        </div>
      )}
      {text && <p className="whitespace-pre-wrap">{text}</p>}
    </div>
  );
}
