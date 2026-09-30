/**
 * What the brain-map form asks of the report's rules while she fills it in.
 *
 * **One rule, one home** (CLAUDE.md rule 4). The form holds a half-typed
 * figure or number of sessions on screen until it is one the report can
 * keep. Whether it is, is the shape's answer (`TypedFigureShape`,
 * `SessionCountShape`), asked here, so the form keeps no copy of a limit that
 * could drift from the one the route enforces.
 *
 * **Choosing the brain map alone clears the approach.** The shape refuses a
 * training approach beside "Not applicable / QEEG only" and the page prints
 * neither (docs/SPEC/reports-qeeg.md section 4), so choosing it returns a
 * plan with no approach. A follow-up comes after training and has no such
 * choice: asked for one, it is returned unchanged.
 *
 * **A figure in words comes from the wording.** "about 25% higher" is the
 * report's own `figure.about`, `figure.about_range`, `figure.higher`,
 * `figure.lower` and `figure.none`, put together here and nowhere else.
 *
 * Pure. Each function returns a new value and changes nothing it is given.
 */

import { QEEG_ONLY, type QeegOnly } from './catalogue/ids';
import { SessionCountShape, TypedFigureShape } from './shape';
import type { ChangeFigure, Locale, QeegContent, TypedFigure } from './types';
import { fill, phrase } from './wording';

/**
 * Her estimate as a typed figure, or null while it is not one the report
 * takes: a percentage with no number yet, a number outside the shape's
 * range, or a range whose top is not above its bottom.
 */
export function typedFigure(
  direction: 'increase' | 'decrease' | 'none',
  low: number | null,
  high: number | null,
): TypedFigure | null {
  const candidate =
    direction === 'none'
      ? { kind: 'no_appreciable_change', source: 'typed', basis: null }
      : { kind: 'percent', direction, low, high, source: 'typed', basis: null };
  const parsed = TypedFigureShape.safeParse(candidate);
  return parsed.success ? (parsed.data as TypedFigure) : null;
}

/** Whether a typed number of sessions is one the report takes. */
export function isSessionCount(count: number): boolean {
  return SessionCountShape.safeParse(count).success;
}

/** The content with its number of sessions chosen, and what that choice clears. */
export function chooseSessions<C extends QeegContent>(
  content: C,
  sessions: number | QeegOnly | null,
): C {
  if (content.edition === 'initial') {
    const approach = sessions === QEEG_ONLY ? null : content.plan.approach;
    return { ...content, plan: { sessions, approach } };
  }
  if (sessions === QEEG_ONLY) return content;
  return { ...content, plan: { ...content.plan, sessions } };
}

/**
 * A change figure in words, typed or calculated alike: the form's line and
 * the page of what has changed (`figureWords`) both say it through this, so
 * the wording of a figure has one home. Where a figure came from is the
 * note's to say, never these words'.
 */
export function figureText(figure: ChangeFigure, locale: Locale): string {
  const say = (key: string) => phrase(key, 'follow-up', locale);
  if (figure.kind === 'no_appreciable_change') return say('figure.none');
  const amount =
    figure.high === null
      ? fill(say('figure.about'), { value: figure.low })
      : fill(say('figure.about_range'), { low: figure.low, high: figure.high });
  return `${amount} ${say(figure.direction === 'increase' ? 'figure.higher' : 'figure.lower')}`;
}
