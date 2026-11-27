import { useEffect, useRef, useState } from 'react';
import { api, type RequestOptions } from '../api/client';

/** Live (Kahoot-style) games: the host's screen shows the question, phones show only the options. */
export type LiveStatus = 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'ended';
export type LiveScoring = 'marks_speed' | 'marks' | 'fun';

export const SCORING_LABEL: Record<LiveScoring, string> = {
  marks_speed: 'Marks + speed bonus',
  marks: 'Marks only',
  fun: 'Just for fun (no marks)',
};

/** A club's game counts the points set per question; clubs choose with or without speed. */
export const CLUB_SCORING_LABEL: Record<Exclude<LiveScoring, 'fun'>, string> = {
  marks: 'Points per question',
  marks_speed: 'Points per question, faster answers keep more',
};

export const scoringLabel = (scoring: LiveScoring, usesPoints: boolean) =>
  usesPoints ? (scoring === 'fun' ? 'Poll (no points)' : CLUB_SCORING_LABEL[scoring]) : SCORING_LABEL[scoring];

/**
 * The number a leaderboard row shows: speed points in a teacher's game; in a club's game the
 * points the club set per question (kept in `marks`).
 */
export function boardScore(row: { points: number; marks?: string }, usesPoints: boolean): number {
  return usesPoints ? Number(row.marks ?? 0) : row.points;
}

export interface LiveOption {
  id: string;
  text: string;
  correct?: boolean;
}

export interface BoardRow {
  rank: number;
  nickname: string;
  points: number;
  guest: boolean;
  marks?: string;
}

export interface HostView {
  id: string;
  title: string;
  code: string;
  status: LiveStatus;
  scoring: LiveScoring;
  /** A club's game: counted in the points set per question (with an optional speed factor). */
  uses_points: boolean;
  /** Rules or instructions; phones show them while they wait in the lobby. */
  instructions: string | null;
  allow_guests: boolean;
  accepting_joins: boolean;
  index: number;
  total: number;
  version: number;
  server_now: string;
  players: { id: string; nickname: string; guest: boolean }[];
  question: {
    index: number;
    type: string;
    stem: string;
    stem_image_id: string | null;
    seconds: number;
    starts_at: string;
    ends_at: string;
    /** When this screen shows the answer by itself: time up, or 2 s after the last player answered. */
    reveal_at: string;
    options: LiveOption[];
  } | null;
  answered: number;
  counts?: Record<string, number>;
  leaderboard: BoardRow[];
}

export interface PlayerState {
  game_id: string;
  title: string;
  status: LiveStatus;
  scoring: LiveScoring;
  index: number;
  total: number;
  version: number;
  server_now: string;
  uses_points: boolean;
  instructions: string | null;
  me: { nickname: string; points: number; marks?: string; rank?: number; of?: number };
  question: {
    index: number;
    type: string;
    options: LiveOption[];
    seconds: number;
    starts_at: string;
    ends_at: string;
    select_count?: number | null;
    correct_ids?: string[];
  } | null;
  my_answer: { response: { choice?: string; choices?: string[] }; correct?: boolean; points?: number; marks?: string } | null;
  podium?: BoardRow[];
}

export interface LivePreview {
  game_id: string;
  title: string;
  host: string | null;
  questions: number;
  status: LiveStatus;
  open: boolean;
  allow_guests: boolean;
  signed_in: boolean;
  /** A club's game: signed-in players pick a name or team name too. */
  ask_name: boolean;
  uses_points: boolean;
  instructions: string | null;
}

export interface LiveGameRow {
  id: string;
  title: string;
  code: string;
  status: LiveStatus;
  scoring: LiveScoring;
  uses_points: boolean;
  players: number;
  created_at: string;
}

const tokenKey = (gameId: string) => `openqz-live-${gameId}`;

/** Guests get a player token when they join; it lives only in this tab. */
export function setPlayerToken(gameId: string, token: string) {
  try {
    sessionStorage.setItem(tokenKey(gameId), token);
  } catch {
    /* private mode: the token is lost on reload, the guest can rejoin */
  }
}

export function playerToken(gameId: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(gameId));
  } catch {
    return null;
  }
}

/** API call as a player: signed-in users use their session, guests their player token. */
export function playerApi<T>(gameId: string, path: string, opts: RequestOptions = {}) {
  const token = playerToken(gameId);
  return api<T>(path, { ...opts, headers: { ...(token ? { 'X-Live-Player': token } : {}) } });
}

/** Server-synced clock: re-renders a few times a second while a timer runs. */
export function useServerClock(serverNow: string | undefined, running: boolean) {
  const offset = useRef(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (serverNow) offset.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, [running]);
  return () => Date.now() + offset.current;
}

export const TILE_SHAPES = ['triangle', 'diamond', 'circle', 'square', 'star', 'hexagon', 'pentagon', 'heart'] as const;

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
