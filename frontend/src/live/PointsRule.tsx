import { cx } from '../components/ui';
import type { LiveScoring } from './api';

const C_LINE = 'how right the answer is. 1 when right, 0 when wrong. Multi-select with partial credit: (right options picked - wrong options picked) / number of right options, never below 0; without partial credit, 1 only when exactly right.';
const T_LINES = (
  <>
    <li>
      <b>t</b>: seconds from the question opening (after the 3-second get ready) until the answer arrives, at most T.
    </li>
    <li>
      <b>T</b>: the question's timer (20 seconds when it has none).
    </li>
  </>
);

/**
 * How a live game counts and orders the players, with the formula. It describes
 * live_service.answer, points_for, speed_factor and ranked on the server: change them together.
 * A club's game (`usesPoints`) counts the points set on each question.
 */
export function PointsRule({ scoring, usesPoints = false, poll = false, className }: { scoring: LiveScoring; usesPoints?: boolean; poll?: boolean; className?: string }) {
  const box = cx('space-y-2 text-xs text-muted', className);
  if (poll) return <p className={cx('text-xs text-muted', className)}>A poll has no right answer, so nobody earns {usesPoints ? 'points' : 'marks or points'}. The big screen shows how many players chose each option.</p>;
  if (usesPoints) {
    const speed = scoring === 'marks_speed';
    return (
      <div className={box}>
        <p>
          <b>Points for each question:</b> <code className="whitespace-nowrap font-mono">{speed ? 'points = P x C x (1 - 0.5 x t / T)' : 'points = P x C'}</code>
        </p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>
            <b>P</b>: the points you set on the question in the editor.
          </li>
          <li>
            <b>C</b>: {C_LINE}
          </li>
          {speed && T_LINES}
        </ul>
        <p>
          {speed
            ? 'A right answer keeps all of P when instant and half of it at the last second. Example: a 10-point question answered right after 5 seconds of 20: 10 x 1 x (1 - 0.5 x 5 / 20) = 8.75 points.'
            : 'A right answer earns all of P, however fast. Example: a 10-point question answered right: 10 points; wrong or no answer: 0.'}{' '}
          <b>Order:</b> total points; equal points, less total answer time first, then by name.
        </p>
      </div>
    );
  }
  return (
    <div className={box}>
      {scoring === 'marks' ? (
        <p>
          <b>Order:</b> marks obtained (each question's marks; a partly right multi-select gets its share). Equal marks: less total answer time first, then by name. Points are worked out as below and shown too, but marks decide the order.
        </p>
      ) : (
        <p>
          <b>Order:</b> total points. Equal points: less total answer time first, then by name. {scoring === 'fun' ? 'Nothing is saved as marks; a poll has no right answer, so it earns no points.' : 'Marks obtained are saved as usual.'}
        </p>
      )}
      <p>
        <b>Points for each question:</b> <code className="whitespace-nowrap font-mono">points = 1000 x C x (1 - 0.5 x t / T)</code>
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>
          <b>C</b>: {C_LINE}
        </li>
        {T_LINES}
      </ul>
      <p>
        A right answer earns 500 to 1000 points: 1000 at once, 500 at the last second. A wrong or missing answer earns 0. Example: right after 5 seconds of a 20-second question: 1000 x 1 x (1 - 0.5 x 5 / 20) = 875 points.
      </p>
    </div>
  );
}
