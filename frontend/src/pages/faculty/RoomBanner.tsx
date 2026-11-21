import { createPortal } from 'react-dom';
import { useConfirm } from '../../components/Confirm';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Monitor, RefreshCw, UserCheck, UserX, Users, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { AssignmentInfo } from '../../api/types';
import { Badge, Button, Loading, Modal } from '../../components/ui';

/** Big join code for the host: copy link, QR, stop/allow joins, new code. */
export function RoomBanner({ a, joined, players, onChange }: { a: AssignmentInfo; joined: number; players: string[]; onChange: () => void }) {
  const [present, setPresent] = useState(false);
  const [managing, setManaging] = useState(false);
  const link = `${window.location.origin}/join/${a.join_code}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: '#3b142a', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [link]);
  const toggle = useMutation({
    mutationFn: () => api(`/activity-assignments/${a.id}`, { method: 'PATCH', json: { accepting_joins: !a.accepting_joins } }),
    onSuccess: onChange,
  });
  const regen = useMutation({ mutationFn: () => api(`/activity-assignments/${a.id}/new-code`, { method: 'POST' }), onSuccess: onChange });
  const code = a.join_code ?? '';
  const [ask, confirmDialog] = useConfirm();

  return (
    <div className="mb-6 overflow-hidden rounded-3xl banner sticker shadow-glow p-5 text-white">
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <div className="flex-1 text-center sm:text-left">
          <div className="text-sm font-semibold text-white/80">Join at {window.location.host}/join with code</div>
          <div className="mt-1 text-5xl font-extrabold tracking-[0.15em] sm:text-6xl" aria-label={`Join code ${code.split('').join(' ')}`}>
            {code.slice(0, 3)} {code.slice(3)}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate()}>
              {a.accepting_joins ? 'Stop new joins' : 'Allow joins'}
            </Button>
            <Button variant="secondary" onClick={() => setPresent(true)}>
              <Monitor className="h-4 w-4" /> Present
            </Button>
            <Button variant="secondary" onClick={() => setManaging(true)}>
              <Users className="h-4 w-4" /> Players
            </Button>
            <Button variant="secondary" loading={regen.isPending} onClick={() => void ask({ title: 'Make a new code?', body: 'The old code stops working. Students who already joined keep access.', action: 'New code' }).then((ok) => ok && regen.mutate())}>
              <RefreshCw className="h-4 w-4" /> New code
            </Button>
          </div>
          <div className="mt-3 text-sm text-white/80" aria-live="polite">
            {joined} joined | {a.submitted_count} finished | {a.accepting_joins ? 'open for new players' : 'closed to new players'}
          </div>
        </div>
        {qr && <img src={qr} alt={`QR code for ${link}`} className="h-44 w-44 rounded-2xl bg-white p-2" />}
      </div>
      {present && <Lobby a={a} link={link} qr={qr} players={players} onClose={() => setPresent(false)} />}
      {managing && <RoomPlayers a={a} onClose={() => setManaging(false)} />}
      {confirmDialog}
    </div>
  );
}

/** Full-screen lobby for the projector: where to join, the code, the QR and who is in. */
function Lobby({ a, link, qr, players, onClose }: { a: AssignmentInfo; link: string; qr: string | null; players: string[]; onClose: () => void }) {
  const code = a.join_code ?? '';
  // Once, when the lobby opens: `onClose` is a new function on every report refresh (a student
  // joined), and running this again would drop the projector out of full screen.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', esc);
    void document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      document.removeEventListener('keydown', esc);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  // on <body>, so the phone tab bar and header cannot cover it (see Modal in ui.tsx)
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Room lobby" className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#2b0e1e] text-white">
      <div className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-bold text-white/85">{a.activity_title}</span>
        <button onClick={onClose} className="flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20">
          <X className="h-4 w-4" /> Close
        </button>
      </div>
      <div className="mx-auto mt-2 flex w-full max-w-5xl flex-col items-stretch gap-4 px-6 md:flex-row">
        <div className="flex-1 rounded-3xl bg-white/10 p-6">
          <div className="text-sm font-bold uppercase tracking-wide text-white/70">1. Open</div>
          <div className="mt-1 whitespace-nowrap text-xl font-extrabold lg:text-2xl">{window.location.host}/join</div>
        </div>
        <div className="flex-[1.4] rounded-3xl bg-white p-6 text-[#2b0e1e]">
          <div className="text-sm font-bold uppercase tracking-wide text-[#5b5875]">2. Enter the code</div>
          <div className="mt-1 text-6xl font-black tracking-[0.12em] sm:text-7xl" aria-label={`Join code ${code.split('').join(' ')}`}>
            {code.slice(0, 3)} {code.slice(3)}
          </div>
        </div>
        {qr && <img src={qr} alt={`QR code for ${link}`} className="mx-auto h-44 w-44 rounded-3xl bg-white p-3 md:mx-0" />}
      </div>
      <div className="mx-auto mt-10 w-full max-w-5xl flex-1 px-6 pb-10">
        <div className="mb-4 flex items-center gap-3" aria-live="polite">
          <span className="rounded-xl bg-white/10 px-4 py-2 text-2xl font-extrabold tabular-nums">{players.length}</span>
          <span className="text-lg font-bold text-white/85">{players.length === 1 ? 'player has joined' : 'players have joined'}</span>
          {!a.accepting_joins && <span className="rounded-full bg-red-500/30 px-3 py-1 text-sm font-bold">closed to new players</span>}
        </div>
        {players.length === 0 ? (
          <p className="py-10 text-center text-xl font-semibold text-white/70">Waiting for players to join...</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {players.map((n, i) => (
              <li key={`${n}-${i}`} className="animate-[pop_0.3s_ease-out] rounded-xl bg-white/15 px-4 py-2 text-lg font-bold">
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface RoomPlayer {
  student_id: string;
  name: string;
  usn: string;
  status: 'joined' | 'in_progress' | 'finished' | 'removed';
}

const STATE: Record<RoomPlayer['status'], [string, 'neutral' | 'amber' | 'green' | 'red']> = {
  joined: ['not started', 'neutral'],
  in_progress: ['answering', 'amber'],
  finished: ['finished', 'green'],
  removed: ['removed', 'red'],
};

/** Who joined the room with the code: take someone out, or let them back in. */
function RoomPlayers({ a, onClose }: { a: AssignmentInfo; onClose: () => void }) {
  const list = useQuery({
    queryKey: ['room-players', a.id],
    queryFn: () => api<{ joined: RoomPlayer[]; removed: RoomPlayer[] }>(`/activity-assignments/${a.id}/room/players`),
    refetchInterval: 5000,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/activity-assignments/${a.id}/room/players/${id}/remove`, { method: 'POST' }) });
  const readmit = useMutation({ mutationFn: (id: string) => api(`/activity-assignments/${a.id}/room/players/${id}/readmit`, { method: 'POST' }) });
  const [ask, confirmDialog] = useConfirm();
  const take = (p: RoomPlayer) =>
    void ask({
      title: `Remove ${p.name} from this room?`,
      body: `${p.status === 'in_progress' ? 'What they have answered so far is submitted now. ' : ''}They lose access and cannot join again with the code. Finished work stays in the report, and you can let them back in later.`,
      action: 'Remove',
      danger: true,
    }).then((ok) => ok && remove.mutate(p.student_id));
  const row = (p: RoomPlayer, action: React.ReactNode) => (
    <li key={p.student_id} className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate font-semibold">{p.name}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {p.usn} <Badge tone={STATE[p.status][1]}>{STATE[p.status][0]}</Badge>
        </span>
      </span>
      {action}
    </li>
  );
  const d = list.data;
  return (
    <Modal open onClose={onClose} title="Players in this room">
      {!d ? (
        <Loading />
      ) : (
        <>
          <ul className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Joined">
            {d.joined.map((p) =>
              row(
                p,
                <Button variant="ghost" aria-label={`Remove ${p.name}`} loading={remove.isPending && remove.variables === p.student_id} onClick={() => take(p)}>
                  <UserX className="h-4 w-4" aria-hidden /> Remove
                </Button>,
              ),
            )}
            {!d.joined.length && <li className="px-3 py-4 text-sm text-muted">Nobody has joined yet.</li>}
          </ul>
          {d.removed.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-bold">Removed</h3>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line" aria-label="Removed">
                {d.removed.map((p) =>
                  row(
                    p,
                    <Button variant="secondary" aria-label={`Let ${p.name} back in`} loading={readmit.isPending && readmit.variables === p.student_id} onClick={() => readmit.mutate(p.student_id)}>
                      <UserCheck className="h-4 w-4" aria-hidden /> Let back in
                    </Button>,
                  ),
                )}
              </ul>
            </>
          )}
        </>
      )}
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
      {confirmDialog}
    </Modal>
  );
}
