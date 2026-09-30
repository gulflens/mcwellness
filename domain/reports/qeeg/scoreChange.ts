/**
 * Rule 8 (docs/SPEC/reports-qeeg.md section 16): whether a score in a
 * follow-up is higher, lower or steady beside the score it had before.
 *
 * **The rule is the practice's to set, and this file is where it is set.** A
 * score out of ten is a practitioner's own whole-number judgement, made on two
 * different days. Whether six and then seven is a change, or the same
 * judgement made twice, is a question about how she scores and not about
 * arithmetic, so it is hers to answer. It was put to the practice on the
 * wording sheet of 29 September 2026 as three choices:
 *
 * 1. **Any difference counts.** Six to seven is higher.
 * 2. **A difference of two or more counts.** Six to seven is steady; six to
 *    eight is higher.
 * 3. **Only a move into another tier counts.** Four to five is higher,
 *    because the wording printed beneath the score changes with it (`tierOf`
 *    in `catalogue/ids.ts`); five to seven is steady.
 *
 * Until she answers, the first stands: it says the least, adding nothing to
 * what the two figures already show side by side.
 *
 * **What it answers with is a name, never a word.** The page marks a score
 * that moved with a shape, and what the movement means is said in her summary
 * (section 10, point 7). Nothing here is printed.
 *
 * `scoreChange.test.ts` holds what is true of any rule in one block, and the
 * rule as it stands in another. Changing the rule means changing the second
 * block, which is how it is changed on purpose and never in passing.
 */

export type ScoreMovement = 'higher' | 'lower' | 'steady';

function isScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

export function classifyScoreChange(earlier: number, later: number): ScoreMovement {
  if (!isScore(earlier) || !isScore(later)) {
    throw new RangeError('A score is a whole number from 0 to 10.');
  }

  // THE PRACTICE'S RULE. Everything above this line holds for any rule;
  // everything below it is the rule itself. As it stands: any difference counts.
  if (later > earlier) return 'higher';
  if (later < earlier) return 'lower';
  return 'steady';
}
