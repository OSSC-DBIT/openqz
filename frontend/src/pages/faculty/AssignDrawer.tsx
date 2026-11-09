import { useMutation, useQuery } from '@tanstack/react-query';
import { DoorOpen, Radio, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { Activity, AssignmentInfo, StudentBrief } from '../../api/types';
import { ClassPicker } from '../../components/pieces';
import { Button, ErrorText, Field, Input, Modal, Select, cx } from '../../components/ui';
import { fromLocalInput, toLocalInput } from '../../components/quiz';
import { useClassOptions } from './LibraryPage';
import { SCORING_LABEL, type HostView, type LiveScoring } from '../../live/api';

/** "Assign" dialog: to classes, as a room anyone can join with a code, or as a live (host-paced) game. */
export function AssignDrawer({
  activity,
  open,
  onClose,
  onDone,
}: {
  activity: Activity;
  open: boolean;
  onClose: () => void;
  onDone: (a: AssignmentInfo) => void;
}) {
  const classes = useClassOptions(open);
  const canUseSections = classes.data?.can_use_sections !== false;
  const [mode, setMode] = useState<'classes' | 'room' | 'live'>('classes');
  const live = mode === 'live';
  const room = !live && (mode === 'room' || !canUseSections);
  const liveAllowed = activity.kind === 'quiz' || activity.kind === 'poll';
  const [scoring, setScoring] = useState<LiveScoring>('marks_speed');
  const [guests, setGuests] = useState(false);
  const nav = useNavigate();
  const startLive = useMutation({
    mutationFn: () => api<HostView>('/live/games', { method: 'POST', json: { activity_id: activity.id, scoring, allow_guests: guests } }),
    onSuccess: (g) => nav(`/live/host/${g.id}`),
  });
  const graded = activity.kind === 'quiz' || activity.kind === 'assignment';
  // Pre-select the classes the activity was created for.
  const [secIds, setSecIds] = useState<number[]>(activity.section_ids);
  const [pickStudentsFrom, setPickStudentsFrom] = useState<number | ''>('');
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [startAt, setStartAt] = useState('');
  const [dueAt, setDueAt] = useState(toLocalInput(new Date(Date.now() + 7 * 864e5).toISOString()));
  const [allowLate, setAllowLate] = useState(false);
  const [shuffleQ, setShuffleQ] = useState(false);
  const [shuffleO, setShuffleO] = useState(false);
  const [instant, setInstant] = useState(activity.kind === 'quiz');
  const [showAnswers, setShowAnswers] = useState<'never' | 'after_submit' | 'after_due'>('after_submit');
  const [release, setRelease] = useState<'immediate' | 'after_due' | 'manual'>('immediate');
  const [timer, setTimer] = useState(activity.time_limit_seconds ? String(Math.round(activity.time_limit_seconds / 60)) : '');
  const [maxViol, setMaxViol] = useState(activity.kind === 'flashcards' || activity.kind === 'poll' ? 0 : 3);
  const [notify, setNotify] = useState(true);
  const [fullscreen, setFullscreen] = useState(true);

  const students = useQuery({
    queryKey: ['section-students', pickStudentsFrom],
    queryFn: () => api<StudentBrief[]>(`/sections/${pickStudentsFrom}/students`),
    enabled: pickStudentsFrom !== '',
  });

  const assign = useMutation({
    mutationFn: () =>
      api<AssignmentInfo>(`/activities/${activity.id}/assign`, {
        method: 'POST',
        json: {
          section_ids: room ? [] : secIds,
          student_ids: room ? [] : studentIds,
          room,
          start_at: fromLocalInput(startAt),
          due_at: fromLocalInput(dueAt),
          allow_late: allowLate,
          shuffle_questions: shuffleQ,
          shuffle_options: shuffleO,
          instant_feedback: instant,
          show_answers: showAnswers,
          release_mode: release,
          time_limit_seconds: timer ? Number(timer) * 60 : null,
          max_violations: maxViol,
          require_fullscreen: fullscreen,
          notify,
        },
      }),
    onSuccess: onDone,
  });

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={value} onChange={(e) => set(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Share "${activity.title}"`}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        {(canUseSections || liveAllowed) && (
          <div className={cx('grid gap-2', canUseSections && liveAllowed ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')} role="radiogroup" aria-label="How to share">
            {(
              [
                ['classes', Users, 'Assign to classes', 'Students of the chosen sections see it in Pending'],
                ['room', DoorOpen, 'Host a room', 'Anyone with the 6-digit join code takes it at their own pace'],
                ['live', Radio, 'Live game', 'You show each question on the big screen; phones show only the answers'],
              ] as const
            )
              .filter(([m]) => (m !== 'classes' || canUseSections) && (m !== 'live' || liveAllowed))
              .map(([m, Icon, label, help]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m || (m === 'room' && room && mode !== 'room')}
                onClick={() => setMode(m)}
                className={cx('rounded-2xl border p-3 text-left', mode === m || (m === 'room' && room) ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-brand-500')}
              >
                <Icon className="h-5 w-5 text-brand-ink" aria-hidden />
                <div className="mt-1 font-bold">{label}</div>
                <div className="text-xs text-muted">{help}</div>
              </button>
            ))}
          </div>
        )}
        {live ? (
          <section className="space-y-4">
            <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
              Your screen (the projector) shows each question; students and guests answer on their phones, which show only the coloured answers. You move everyone to the next question. Uses the multiple choice, true / false and multi-select questions.
            </p>
            {activity.kind === 'quiz' && (
              <Field label="Scoring">
                <Select value={scoring} onChange={(e) => setScoring(e.target.value as LiveScoring)}>
                  {(Object.keys(SCORING_LABEL) as LiveScoring[]).map((k) => (
                    <option key={k} value={k}>
                      {SCORING_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {check('Let guests join with a nickname', guests, setGuests, 'For open events: no account needed. Off: only signed-in students can join. You can remove any player from the lobby.')}
          </section>
        ) : (
          <>
        {room ? (
          <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
            A join code is created after you press <b>Host room</b>. Share it (or the link / QR code) with the students. Any signed-in student can join.
          </p>
        ) : (
          <section className="space-y-3">
            <h3 className="text-sm font-bold">Who</h3>
            <ClassPicker data={classes.data} value={secIds} onChange={setSecIds} />
            <details>
              <summary className="cursor-pointer text-sm text-brand-ink">Or pick specific students</summary>
              <Select className="mt-2" value={pickStudentsFrom} onChange={(e) => setPickStudentsFrom(e.target.value ? Number(e.target.value) : '')} aria-label="Section to pick students from">
                <option value="">Choose a section</option>
                {(classes.data?.classes ?? []).map((c) => (
                  <option key={c.section_id} value={c.section_id}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {students.data?.map((st) => (
                  <label key={st.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={studentIds.includes(st.id)} onChange={() => setStudentIds(toggle(studentIds, st.id))} />
                    {st.full_name} <span className="text-xs text-muted">{st.username}</span>
                  </label>
                ))}
              </div>
              {studentIds.length > 0 && <p className="mt-1 text-xs text-muted">{studentIds.length} students selected</p>}
            </details>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Start (blank = now)">
            <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <Field label="Deadline">
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">{check('Allow late submissions', allowLate, setAllowLate, 'Students can still start after the deadline; marked late.')}</div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {activity.kind !== 'flashcards' && (
            <Field label="Activity timer (minutes, blank = none)">
              <Input type="number" min={1} max={360} value={timer} onChange={(e) => setTimer(e.target.value)} />
            </Field>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-bold">Settings</h3>
          {check('Shuffle questions', shuffleQ, setShuffleQ)}
          {check('Shuffle answer options', shuffleO, setShuffleO)}
          {graded && check('Show answer after each question', instant, setInstant, 'Right/wrong and the explanation appear right away; the answer then locks.')}
          {graded && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Students can review answers">
                <Select value={showAnswers} onChange={(e) => setShowAnswers(e.target.value as typeof showAnswers)}>
                  <option value="after_submit">After they finish</option>
                  <option value="after_due">After the deadline</option>
                  <option value="never">Never</option>
                </Select>
              </Field>
              <Field label="Show marks">
                <Select value={release} onChange={(e) => setRelease(e.target.value as typeof release)}>
                  <option value="immediate">Right after submitting</option>
                  <option value="after_due">After the deadline</option>
                  <option value="manual">When I release them</option>
                </Select>
              </Field>
            </div>
          )}
          {check('Email students about it', notify, setNotify, 'Sends an email when assigned and when you release marks (if email is set up).')}
          {check('Require full screen', fullscreen, setFullscreen, 'Questions stay hidden until the student is in full screen; leaving it counts as a warning. (iPhone browsers have no full screen, so it is skipped there.)')}
          <Field label="Tab switches / Back / reload allowed before auto-submit (0 = only record)">
            <Input type="number" min={0} max={50} value={maxViol} onChange={(e) => setMaxViol(Number(e.target.value))} />
          </Field>
        </section>

          </>
        )}
        <ErrorText error={assign.error || startLive.error} />
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {live ? (
          <Button loading={startLive.isPending} onClick={() => startLive.mutate()}>
            Start live game
          </Button>
        ) : (
          <Button loading={assign.isPending} disabled={!room && !secIds.length && !studentIds.length} onClick={() => assign.mutate()}>
            {room ? 'Host room' : 'Assign'}
          </Button>
        )}
      </div>
    </Modal>
  );
}
