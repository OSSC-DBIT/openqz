/**
 * The word for what a question is worth. Teachers' work counts in marks; a club's activity
 * (`uses_points` from the API) counts in points: the same numbers, another word.
 */
export interface Unit {
  one: string;
  many: string;
  Many: string;
  /** "marks obtained" / "points" */
  obtained: string;
  Obtained: string;
}

export const MARKS: Unit = { one: 'mark', many: 'marks', Many: 'Marks', obtained: 'marks obtained', Obtained: 'Marks obtained' };
export const POINTS: Unit = { one: 'point', many: 'points', Many: 'Points', obtained: 'points', Obtained: 'Points' };

export const unitOf = (usesPoints: boolean | undefined | null): Unit => (usesPoints ? POINTS : MARKS);

/** "1 mark", "2.5 marks", "10 points". */
export const amount = (n: number, u: Unit) => `${n} ${n === 1 ? u.one : u.many}`;

/** What a club can give one question (teachers pick from MARK_PRESETS). */
export const POINT_PRESETS = [0, 1, 2, 5, 10, 15, 20, 25, 50, 100];
