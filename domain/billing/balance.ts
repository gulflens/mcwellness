/**
 * What a client has left, read off the entitlement ledger
 * (docs/SPEC/billing.md section 1: everything is an entitlement ledger, and
 * a balance is derived from it, never stored). This is the arithmetic behind
 * "Session 3 of 15" on a stop card and behind the client record's own money
 * panel.
 *
 * Pure: no I/O, and "today" is always an argument (.claude/rules/testing.md).
 */

import { fils, type Fils, type IsoDate } from '../shared';
import { expiryWarningFor, isUsableOn, type ExpiryWarning } from './expiry';

export const ENTITLEMENT_STATUSES = [
  'available',
  'consumed',
  'expired',
  'refunded',
  'waived',
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const CONSUMPTION_KINDS = ['session', 'late_cancellation', 'no_show'] as const;
export type ConsumptionKind = (typeof CONSUMPTION_KINDS)[number];

/** One credit as the ledger holds it. */
export type EntitlementRecord = {
  serviceTypeId: string;
  status: EntitlementStatus;
  allocatedNetFils: Fils;
  expiresOn: IsoDate | null;
  /** What used it up; null unless the status is `consumed`. */
  consumptionKind: ConsumptionKind | null;
};

export type ServiceBalance = {
  serviceTypeId: string;
  /** Credits that still belong to the client: everything but the refunded and the waived. */
  purchased: number;
  /** Used by a delivered session — the number in "Session 3 of 15". */
  delivered: number;
  /** Taken by a late cancellation or a no-show, and not waived. */
  forfeited: number;
  /** Usable today: available, and not past its expiry date. */
  remaining: number;
  /** Available on paper but out of time, plus anything already marked expired. */
  lapsed: number;
  /** What the remaining credits are worth at the rate they were allocated at. */
  remainingValueNetFils: Fils;
  /**
   * What has been earned: the allocated value of every credit already used
   * up, delivered or forfeited. Cash was taken for these and the obligation
   * behind them is discharged (docs/SPEC/billing.md section 4.1, IFRS 15).
   */
  recognisedNetFils: Fils;
  /**
   * What is still owed in sessions: the allocated value of every credit not
   * yet used. This is the contract liability — the number section 4.1 says
   * to watch the way you would watch a debt — and it includes a credit that
   * has run out of time, because until the practice writes one off it is
   * still a promise it made.
   */
  deferredNetFils: Fils;
  /** The soonest a usable credit runs out, and what to say about it. */
  nextExpiryOn: IsoDate | null;
  expiryWarning: ExpiryWarning;
};

export type ClientBalance = {
  services: ServiceBalance[];
  /** Across every service. */
  delivered: number;
  remaining: number;
  remainingValueNetFils: Fils;
  /** Across every service: earned, and still owed in sessions. */
  recognisedNetFils: Fils;
  deferredNetFils: Fils;
  /** The soonest expiry among every usable credit the client holds. */
  nextExpiryOn: IsoDate | null;
  expiryWarning: ExpiryWarning;
};

/**
 * A waived credit is one a late cancellation took and the coordinator then
 * forgave; a replacement was written in its place, so counting it again
 * would double the client's holding. A refunded credit has been paid back.
 * Neither counts towards anything.
 */
function counts(entitlement: EntitlementRecord): boolean {
  return entitlement.status !== 'waived' && entitlement.status !== 'refunded';
}

function earlier(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

/** Every service the client holds credits for, in the order first seen, plus the totals. */
export function balanceFor(
  entitlements: readonly EntitlementRecord[],
  today: IsoDate,
): ClientBalance {
  const byService = new Map<string, ServiceBalance>();

  for (const entitlement of entitlements) {
    if (!counts(entitlement)) {
      continue;
    }
    let service = byService.get(entitlement.serviceTypeId);
    if (!service) {
      service = {
        serviceTypeId: entitlement.serviceTypeId,
        purchased: 0,
        delivered: 0,
        forfeited: 0,
        remaining: 0,
        lapsed: 0,
        remainingValueNetFils: fils(0),
        recognisedNetFils: fils(0),
        deferredNetFils: fils(0),
        nextExpiryOn: null,
        expiryWarning: 'none',
      };
      byService.set(entitlement.serviceTypeId, service);
    }
    service.purchased += 1;

    if (entitlement.status === 'consumed') {
      if (entitlement.consumptionKind === 'session') {
        service.delivered += 1;
      } else {
        service.forfeited += 1;
      }
      service.recognisedNetFils = fils(service.recognisedNetFils + entitlement.allocatedNetFils);
      continue;
    }
    if (entitlement.status === 'expired') {
      service.lapsed += 1;
      service.deferredNetFils = fils(service.deferredNetFils + entitlement.allocatedNetFils);
      continue;
    }
    // Available on paper, used or not: the practice still owes the visit.
    service.deferredNetFils = fils(service.deferredNetFils + entitlement.allocatedNetFils);
    // Available on the row. Whether it is really usable is a question about
    // today, not about the column: nothing sweeps expiry dates nightly, so
    // the reading is done here rather than trusted to a job that may not have run.
    if (isUsableOn(entitlement.expiresOn, today)) {
      service.remaining += 1;
      service.remainingValueNetFils = fils(
        service.remainingValueNetFils + entitlement.allocatedNetFils,
      );
      service.nextExpiryOn = earlier(service.nextExpiryOn, entitlement.expiresOn);
    } else {
      service.lapsed += 1;
    }
  }

  const services = [...byService.values()].map((service) => ({
    ...service,
    expiryWarning: service.remaining > 0 ? expiryWarningFor(service.nextExpiryOn, today) : 'none',
  }));

  let nextExpiryOn: IsoDate | null = null;
  let delivered = 0;
  let remaining = 0;
  let remainingValue = 0;
  let recognised = 0;
  let deferred = 0;
  for (const service of services) {
    delivered += service.delivered;
    remaining += service.remaining;
    remainingValue += service.remainingValueNetFils;
    recognised += service.recognisedNetFils;
    deferred += service.deferredNetFils;
    if (service.remaining > 0) {
      nextExpiryOn = earlier(nextExpiryOn, service.nextExpiryOn);
    }
  }

  return {
    services,
    delivered,
    remaining,
    remainingValueNetFils: fils(remainingValue),
    recognisedNetFils: fils(recognised),
    deferredNetFils: fils(deferred),
    nextExpiryOn,
    expiryWarning: remaining > 0 ? expiryWarningFor(nextExpiryOn, today) : 'none',
  };
}

/**
 * The money a household owes: every charge less every payment, in fils. A
 * positive figure is owed to the practice, a negative one is credit the
 * practice holds. Derived on every read, stored nowhere (section 1).
 */
export function outstandingBalanceFils(
  charges: readonly { grossFils: Fils }[],
  payments: readonly { amountFils: Fils }[],
): Fils {
  const charged = charges.reduce((total, charge) => total + charge.grossFils, 0);
  const paid = payments.reduce((total, payment) => total + payment.amountFils, 0);
  return fils(charged - paid);
}
