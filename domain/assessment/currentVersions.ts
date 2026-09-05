import type { Assessment } from './types';

/**
 * Which measurement stands, and what it replaced (docs/SPEC/assessment.md
 * section 5, rule 4).
 *
 * A figure entered wrongly is corrected by recording a new version of the old
 * one, with a reason, and both stay (CLAUDE.md rule 7). So a measurement is a
 * chain, and the current one is the one nothing supersedes. The table shows
 * the current version, with the versions it replaced beneath it, quiet, each
 * with its reason (section 3.1).
 *
 * Pure and total: it reads the rows it is given and nothing else. A row whose
 * `supersedesId` names something not in the list simply ends the chain there —
 * which is what a page of results does when the row it replaced is older than
 * the window — and a chain that somehow points back at itself stops rather
 * than looping.
 */
export type VersionChain = {
  /** The version that stands: nothing in this list supersedes it. */
  current: Assessment;
  /** What it replaced, newest first. Empty for a measurement recorded once. */
  superseded: readonly Assessment[];
};

export function currentVersions(assessments: readonly Assessment[]): readonly VersionChain[] {
  const byId = new Map(assessments.map((a) => [a.id, a]));
  const replaced = new Set<string>();
  for (const assessment of assessments) {
    if (assessment.supersedesId !== null && byId.has(assessment.supersedesId)) {
      replaced.add(assessment.supersedesId);
    }
  }

  const chains: VersionChain[] = [];
  for (const assessment of assessments) {
    if (replaced.has(assessment.id)) continue;
    const superseded: Assessment[] = [];
    const walked = new Set<string>([assessment.id]);
    let step = assessment.supersedesId;
    while (step !== null && !walked.has(step)) {
      const earlier = byId.get(step);
      if (earlier === undefined) break;
      walked.add(earlier.id);
      superseded.push(earlier);
      step = earlier.supersedesId;
    }
    chains.push({ current: assessment, superseded });
  }

  // Newest measurement first, and a stable tie-break so two readers of the
  // same page see the same order: the day it was taken, then the version, then
  // the id.
  return [...chains].sort((a, b) => {
    if (a.current.performedAt !== b.current.performedAt) {
      return a.current.performedAt < b.current.performedAt ? 1 : -1;
    }
    if (a.current.version !== b.current.version) {
      return b.current.version - a.current.version;
    }
    return a.current.id < b.current.id ? -1 : a.current.id > b.current.id ? 1 : 0;
  });
}
