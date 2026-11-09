import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Monitor } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api, downloadFile } from '../api/client';
import { Badge, Button, Card, ErrorText, PageHeader, Spinner, Table, Td } from '../components/ui';
import { SCORING_LABEL, type LiveScoring, type LiveStatus } from './api';

interface Results {
  id: string;
  title: string;
  status: LiveStatus;
  scoring: LiveScoring;
  created_at: string;
  total_marks: number | null;
  players: { rank: number; nickname: string; usn: string | null; guest: boolean; points: number; marks?: string; answered: number; correct: number }[];
  questions: { index: number; stem: string; answered: number; correct: number; avg_ms: number | null }[];
}

/** After (or during) a live game: ranking with marks obtained, per-question stats, CSV export. */
export default function LiveResultsPage() {
  const { gameId } = useParams();
  const r = useQuery({ queryKey: ['live-results', gameId], queryFn: () => api<Results>(`/live/games/${gameId}/results`) });
  const d = r.data;
  const fun = d?.scoring === 'fun';
  return (
    <>
      <Link to="/faculty/reports" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All reports
      </Link>
      <ErrorText error={r.error} />
      {!d ? (
        <Spinner />
      ) : (
        <>
          <PageHeader
            title={d.title}
            subtitle={`Live game | ${SCORING_LABEL[d.scoring]} | ${new Date(d.created_at).toLocaleString()}`}
            actions={
              <div className="flex flex-wrap gap-2">
                {d.status !== 'ended' && (
                  <Link to={`/live/host/${d.id}`}>
                    <Button variant="secondary">
                      <Monitor className="h-4 w-4" /> Back to the game
                    </Button>
                  </Link>
                )}
                <Button variant="secondary" onClick={() => void downloadFile(`/live/games/${d.id}/results.csv`, `${d.title}_live.csv`)}>
                  <Download className="h-4 w-4" /> CSV
                </Button>
              </div>
            }
          />
          <h2 className="mb-2 font-bold">Players</h2>
          <Table
            head={['#', 'Player', 'Points', fun ? '' : 'Marks obtained', 'Correct']}
            cols={[undefined, undefined, undefined, fun ? 'hidden' : undefined, 'hidden sm:table-cell']}
            compact
          >
            {d.players.map((p) => (
              <tr key={p.rank + p.nickname}>
                <Td className="font-bold">{p.rank}</Td>
                <Td>
                  <div className="break-all font-semibold">{p.nickname}</div>
                  <div className="text-xs text-muted">{p.guest ? <Badge>guest</Badge> : p.usn}</div>
                </Td>
                <Td className="tabular-nums">{p.points}</Td>
                <Td className={fun ? 'hidden' : 'whitespace-nowrap'}>
                  {Number(p.marks)} / {d.total_marks}
                </Td>
                <Td className="hidden sm:table-cell">
                  {p.correct} / {d.questions.length}
                </Td>
              </tr>
            ))}
          </Table>
          <h2 className="mb-2 mt-8 font-bold">Questions</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {d.questions.map((q) => (
              <Card key={q.index} className="!p-4">
                <div className="text-xs font-bold text-muted">Question {q.index + 1}</div>
                <div className="mt-1 font-semibold">{q.stem}</div>
                <div className="mt-2 text-sm text-muted">
                  {q.correct} of {q.answered} correct{q.avg_ms !== null ? ` | average ${(q.avg_ms / 1000).toFixed(1)} s` : ''}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
