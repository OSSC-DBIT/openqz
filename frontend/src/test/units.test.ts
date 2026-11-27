import { describe, expect, it } from 'vitest';
import { amount, MARKS, POINTS, unitOf } from '../components/units';
import { boardScore, scoringLabel } from '../live/api';

describe('marks for teachers, points for clubs', () => {
  it('picks the word from the activity', () => {
    expect(unitOf(true)).toBe(POINTS);
    expect(unitOf(false)).toBe(MARKS);
    expect(unitOf(undefined)).toBe(MARKS);
    expect(amount(1, POINTS)).toBe('1 point');
    expect(amount(10, POINTS)).toBe('10 points');
    expect(amount(2.5, MARKS)).toBe('2.5 marks');
  });

  it("shows a club's points on the live leaderboard, speed points otherwise", () => {
    const row = { points: 875, marks: '8.75' };
    expect(boardScore(row, true)).toBe(8.75);
    expect(boardScore(row, false)).toBe(875);
    expect(scoringLabel('marks', true)).toBe('Points per question');
    expect(scoringLabel('marks_speed', true)).toMatch(/faster answers keep more/);
    expect(scoringLabel('marks_speed', false)).toBe('Marks + speed bonus');
  });
});
