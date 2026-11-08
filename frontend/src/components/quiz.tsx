import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ActivityKind, QuestionType } from '../api/types';

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  true_false: 'True / False',
  fill_blank: 'Fill in the blanks',
  multi_select: 'Multi-select',
  justify: 'Justify your answer',
  open_ended: 'Open ended',
};

export const KIND_LABEL: Record<ActivityKind, string> = {
  quiz: 'Quiz',
  assignment: 'Assignment',
  poll: 'Poll',
  flashcards: 'Flashcards',
};

export const TYPES_FOR: Record<ActivityKind, QuestionType[]> = {
  quiz: ['mcq', 'true_false', 'multi_select', 'fill_blank', 'justify', 'open_ended'],
  assignment: ['mcq', 'true_false', 'multi_select', 'fill_blank', 'justify', 'open_ended'],
  poll: ['mcq', 'multi_select', 'open_ended'],
  flashcards: ['open_ended'],
};

/** Wayground-style timer presets. */
export const TIMER_PRESETS = [5, 10, 20, 30, 45, 60, 90, 120, 180, 300, 600];
export const MARK_PRESETS = [0, 0.5, 1, 2, 3, 4, 5, 10];

export function fmtSeconds(s: number | null | undefined): string {
  if (!s) return 'No timer';
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** Answer tile colours (option order), like the quiz games teachers know. */
export const TILE_COLORS = ['#2d6cdf', '#0d9488', '#d97706', '#e0336b', '#7c3aed', '#0891b2', '#c2410c', '#4d7c0f'];

/** <img> for protected media: fetched with the auth header, shown as a blob URL. */
export function AuthImage({ id, className, alt = '' }: { id: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    api<Response>(`/media/${id}`, { raw: true })
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      })
      .catch(() => setUrl(null));
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [id]);
  if (!url) return <div className={`animate-pulse bg-line ${className ?? ''}`} style={{ minHeight: 80 }} />;
  return <img src={url} alt={alt} className={className} draggable={false} />;
}

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await api<{ id: string }>('/media', { method: 'POST', body: fd });
  return r.id;
}

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
