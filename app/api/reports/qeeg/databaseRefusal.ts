import { FIGURE_SENTENCES, type FigureRefusalCode } from './figureSchema';

/**
 * What the picture doors answer when a database function of migration 604
 * refuses, by the SQLSTATE it raised (fix round 1).
 *
 * The routes ask every question before they call a function, so these are the
 * answers to what changed in between or to where the route and the database
 * read a rule differently: a practitioner at the edge of a schedule, an
 * erased client, a report signed on another tab, a ninth picture from a
 * second tab. Each is an answer with a sentence the form can show, never a
 * 500. Anything else is left to the error handler, which logs its class and
 * nothing of its message.
 */

export type DatabaseRefusal = {
  status: 403 | 404 | 422;
  body: { error: string; code: FigureRefusalCode; sentence: string };
};

const BY_STATE: Readonly<
  Record<string, { status: DatabaseRefusal['status']; code: FigureRefusalCode }>
> = {
  // Who is asking: app.may_touch_report_figures.
  '42501': { status: 403, code: 'not_permitted' },
  // The report has left draft: the functions and the guard.
  '23001': { status: 422, code: 'not_a_draft' },
  // The ninth picture.
  '54000': { status: 422, code: 'too_many_maps' },
  // A rule of the link or the report: a kind, a digest, a size.
  '23514': { status: 422, code: 'not_accepted' },
  // No such report, or no such map on it.
  P0002: { status: 404, code: 'no_such_map' },
};

const ERROR_WORD: Readonly<Record<DatabaseRefusal['status'], string>> = {
  403: 'forbidden',
  404: 'not_found',
  422: 'unprocessable',
};

export function databaseRefusal(error: unknown): DatabaseRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code } = error as { code?: unknown };
  if (typeof code !== 'string' || !Object.hasOwn(BY_STATE, code)) return null;
  const known = BY_STATE[code];
  if (!known) return null;
  return {
    status: known.status,
    body: {
      error: ERROR_WORD[known.status],
      code: known.code,
      sentence: FIGURE_SENTENCES[known.code],
    },
  };
}
