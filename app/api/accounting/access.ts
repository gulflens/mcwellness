import type { Actor } from '../../../domain/shared';
import { canActor } from '../../../domain/shared';

/**
 * Who may do each of the books' actions (docs/SPEC/accounting.md sections 3
 * and 10). Each wrapper names what a route is doing and asks `canActor` for
 * the action of that name; the audiences live once, in domain/shared/actor.ts.
 * tests/accounting/access.test.ts pins every wrapper against every role.
 */

/** Reading the journal, the chart, the years, the settings and every statement. */
export function mayReadBooks(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.read' }, {}, now);
}

/** Running the poster, posting a manual or opening entry, reversing, adding or amending an account. */
export function mayWriteBooks(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.write' }, {}, now);
}

/** Closing or reopening a financial year. */
export function mayCloseYear(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.year.close' }, {}, now);
}

/** The books' settings and the lock date. */
export function mayChangeBooksSettings(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'accounting.settings.write' }, {}, now);
}
