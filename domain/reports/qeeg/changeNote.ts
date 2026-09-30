/**
 * The note printed beneath a follow-up's page of what has changed.
 *
 * **The note follows from the figures, never from a setting.** A typed figure
 * is the practitioner's own estimate read from the maps; a calculated one is
 * arithmetic on two recorded assessments. A household is told which it is
 * looking at, and the words for that are chosen here from the sources
 * actually on the page, so a page of estimates can never carry the note for
 * calculated figures, or the other way about. A page with no figure prints
 * no note at all.
 *
 * `figuresOf` gives the figures in the order the page prints them: the
 * headline tiles first, then the table's rows in their places, eyes open
 * before eyes closed.
 */

import type { ChangeFigure, ChangeSection } from './types';

export type FigureNoteKey = 'note.figures.typed' | 'note.figures.calculated' | 'note.figures.both';

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export function figuresOf(change: ChangeSection): ChangeFigure[] {
  const tiles = Object.values(change.tiles)
    .slice()
    .sort(byPosition)
    .map((tile) => tile.figure);
  const rows = Object.values(change.table)
    .filter((row) => row !== undefined)
    .sort(byPosition)
    .flatMap((row) => [row.eyesOpen, row.eyesClosed])
    .filter((figure): figure is ChangeFigure => figure !== null);
  return [...tiles, ...rows];
}

export function changeNoteKey(change: ChangeSection): FigureNoteKey | null {
  const sources = new Set(figuresOf(change).map((figure) => figure.source));
  if (sources.size === 0) return null;
  if (sources.size > 1) return 'note.figures.both';
  return sources.has('calculated') ? 'note.figures.calculated' : 'note.figures.typed';
}
