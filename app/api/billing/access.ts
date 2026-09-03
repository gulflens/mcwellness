import type { Actor } from '../../../domain/shared';
import { canActor, hasRole } from '../../../domain/shared';

/**
 * Who may do each of this pull request's billing actions.
 *
 * `domain/shared/actor.ts` is the shared zone and this worktree does not own
 * it, so the eight actions these routes need are asked for in
 * `docs/CHANGE-REQUESTS/billing-03.md` and, until the trunk applies them,
 * composed here from the two that already exist. Each function below is a
 * thin wrapper over `canActor`, in the shape `app/api/clients/access.ts` and
 * `app/shell/adminAccess.ts` already use — never a role list restated loosely
 * enough to drift from the rule it is meant to mirror.
 *
 * When billing-03 lands, every body here becomes a single `canActor` call
 * with its own action, and the wrappers stay: the routes name the thing they
 * are doing, not the permission that happens to cover it today.
 */

/** The bundle catalogue: the same audience the price list has. */
export function mayReadCatalogue(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.read' }, {}, now);
}

/** Adding a bundle or a bundle price: the same audience that sets a price. */
export function mayWriteCatalogue(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.write' }, {}, now);
}

/**
 * Selling a package to a client, recording a payment, waiving a late
 * cancellation. Three different actions with one audience today — the owner,
 * an admin and finance — and billing-03 gives each its own name so a future
 * arrangement can separate them without touching a route.
 */
export function maySell(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.write' }, {}, now);
}

export function mayRecordPayment(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.write' }, {}, now);
}

export function mayWaive(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.write' }, {}, now);
}

/** Invoices: read by everyone who reads the price list. */
export function mayReadInvoices(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.read' }, {}, now);
}

/**
 * Quoting what a family would be owed if they left the programme today. The
 * same audience as the invoice book, and deliberately not narrower: a refund
 * quote is arithmetic over a purchase and its credits, rows the lead
 * practitioner may already read under `ledger_readers`
 * (db/policies/billing/ledger.sql). A route stricter than the row security
 * beneath it would be a courtesy pretending to be a boundary.
 */
export function mayQuoteRefund(actor: Actor, now: Date): boolean {
  return canActor(actor, { type: 'billing.price.read' }, {}, now);
}

/**
 * A client's balance reaches further than the price list does, and this is
 * the one place the two genuinely differ.
 *
 * A practitioner needs it: the stop card says "Session 3 of 15" and what is
 * owed at the door, and the person driving there is the one who needs both.
 * Their reach is not decided here — row security scopes every row they can
 * read to a client on their own schedule
 * (201_client_visible_to_practitioner.sql), so this only says the role is
 * allowed to ask.
 *
 * A client contact reads their own household's, and `clientIds` is the
 * route's to resolve for that contact and nobody else, exactly as
 * `canActor`'s own `client.read` treats it. No route in this pull request
 * passes it: the portal is another stream's, and until it exists a contact
 * asking is refused rather than quietly given someone's figures.
 */
export function mayReadBalance(
  actor: Actor,
  clientId: string,
  ctx: { clientIds?: readonly string[] },
  now: Date,
): boolean {
  if (canActor(actor, { type: 'billing.price.read' }, {}, now)) {
    return true;
  }
  if (hasRole(actor, 'practitioner')) {
    return true;
  }
  return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(clientId);
}
