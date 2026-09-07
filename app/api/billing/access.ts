import type { Action, Actor } from '../../../domain/shared';
import { canActor, hasRole } from '../../../domain/shared';

/**
 * Who may do each of billing's actions.
 *
 * `domain/shared/actor.ts` is the shared zone and this worktree does not own
 * it. The eight actions these routes need are asked for in
 * `docs/CHANGE-REQUESTS/billing-03.md` and are landing on the trunk
 * (`shared-zone-round-15`, pull request 43), which merges after this one.
 * So each wrapper below asks for its own action **by name when the trunk
 * knows it**, and falls back to the action of the same audience that exists
 * today when it does not. Whichever of the two pull requests merges first,
 * the audience is identical — `tests/billing/access.test.ts` asserts every
 * wrapper against every role and does not care which branch it took.
 *
 * When 43 has merged, `named` and the fallbacks go and each body becomes a
 * single `canActor` call. The wrappers themselves stay: a route should name
 * what it is doing, not the permission that happens to cover it.
 *
 * Nine wrappers, eight actions: extending a programme rides on the waiver's
 * action on purpose. Both are the same decision — a coordinator forgiving a
 * charge the practice's own policy had already made — and inventing a ninth
 * name for it would be inventing a distinction nobody has asked for.
 */

/**
 * Whether `domain/shared`'s `canActor` knows an action by this name.
 *
 * Two probes, because one is not safe. An owner is allowed every billing
 * action, so a known action answers `true`; an unknown one falls through
 * `canActor`'s exhaustiveness branch, which returns the action itself —
 * truthy, and so indistinguishable from a permission if it were only tested
 * for truth. A client contact with no clients in context is refused every
 * action here, so a known action answers exactly `false` for the second
 * probe. An unknown action cannot answer both.
 */
const OWNER_PROBE: Actor = { userId: '', tenantId: '', roles: ['owner'], capabilities: [] };
const CONTACT_PROBE: Actor = {
  userId: '',
  tenantId: '',
  roles: ['client_contact'],
  capabilities: [],
};
const known = new Map<string, boolean>();

function named(type: string, extra: Record<string, unknown> = {}): Action | null {
  const action = { type, ...extra } as unknown as Action;
  const remembered = known.get(type);
  if (remembered === false) {
    return null;
  }
  if (remembered === undefined) {
    const epoch = new Date(0);
    const supported =
      canActor(OWNER_PROBE, action, {}, epoch) === true &&
      canActor(CONTACT_PROBE, action, {}, epoch) === false;
    known.set(type, supported);
    if (!supported) {
      return null;
    }
  }
  return action;
}

/** True when the actor may do `type`, or — until the trunk knows it — `fallback`. */
function may(actor: Actor, type: string, fallback: Action, now: Date): boolean {
  const action = named(type);
  return canActor(actor, action ?? fallback, {}, now);
}

const PRICE_READ: Action = { type: 'billing.price.read' };
const PRICE_WRITE: Action = { type: 'billing.price.write' };

/** The bundle catalogue: the same audience the price list has. */
export function mayReadCatalogue(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.package.read', PRICE_READ, now);
}

/** Adding a bundle or a bundle price: the same audience that sets a price. */
export function mayWriteCatalogue(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.package.write', PRICE_WRITE, now);
}

/**
 * Selling a package to a client, recording a payment, waiving a late
 * cancellation, extending a programme. Four different actions with one
 * audience — the owner, an admin and finance — each with its own name, so a
 * future arrangement can separate them without touching a route.
 */
export function maySell(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.sale.write', PRICE_WRITE, now);
}

export function mayRecordPayment(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.payment.write', PRICE_WRITE, now);
}

export function mayWaive(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.waiver.write', PRICE_WRITE, now);
}

/**
 * Extending a programme's expiry. The founder's decision of 2026-09-03 puts
 * this at the coordinator's discretion, and a coordinator here is one of the
 * three money roles: an extension gives away sessions the practice has been
 * paid for, which is a commercial decision even when it is an obviously kind
 * one.
 */
export function mayExtend(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.waiver.write', PRICE_WRITE, now);
}

/**
 * Giving an extra discount at a sale: the owner, an admin or finance, and
 * nobody else (docs/SPEC/billing.md section 2.4). The same three roles
 * migration 408 lets forgive a call-out fee, for the same reason — a discount
 * and a waiver are both money the practice decides not to collect.
 *
 * The fallback names the three roles outright rather than borrowing
 * `billing.price.write` as the wrappers above do. Setting a price and giving
 * one family a discount are different acts, and a future widening of who may
 * publish a price should not quietly widen who may hand money back. The
 * audience is pinned in tests/billing/access.test.ts beside every other
 * wrapper's either way.
 */
export function mayDiscount(actor: Actor, now: Date): boolean {
  const action = named('billing.discount.write');
  if (action) {
    return canActor(actor, action, {}, now);
  }
  return hasRole(actor, 'owner', 'admin', 'finance');
}

/** Invoices: read by everyone who reads the price list. */
export function mayReadInvoices(actor: Actor, now: Date): boolean {
  return may(actor, 'billing.invoice.read', PRICE_READ, now);
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
  return may(actor, 'billing.refund.read', PRICE_READ, now);
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
  const action = named('billing.balance.read', { clientId });
  if (action) {
    return canActor(actor, action, ctx, now);
  }
  if (canActor(actor, PRICE_READ, {}, now)) {
    return true;
  }
  if (hasRole(actor, 'practitioner')) {
    return true;
  }
  return hasRole(actor, 'client_contact') && (ctx.clientIds ?? []).includes(clientId);
}
