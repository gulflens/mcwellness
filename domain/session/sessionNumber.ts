/**
 * "Session 12 of 30" (docs/SPEC/session-capture.md section 5 rule 4), the
 * line under the client's name on the run screen. Derived from history and
 * entitlements, never stored (00-data-model.md section 4).
 *
 * N counts this visit among the client's completed visits of the same
 * service, ordered by when each was checked in. M adds the credits still
 * available for that service on top. M is null when the practice holds no
 * entitlement rows for this client and service at all — an unknown
 * programme length, which the screen renders as "Session 12" rather than
 * inventing a denominator.
 *
 * Pure: no clock. The ordering comes from `checkedInAt` on the rows
 * themselves, tie-broken by id so two visits checked in within the same
 * millisecond still number stably.
 */

/** A past visit, as far as this rule is concerned. */
export type SessionHistoryEntry = {
  id: string;
  serviceTypeId: string;
  status: 'in_progress' | 'completed' | 'no_show' | 'cancelled_late' | 'cancelled' | 'aborted';
  /** ISO 8601. */
  checkedInAt: string;
};

/** One credit on the ledger (00-data-model.md section 6), read, never written, here. */
export type EntitlementEntry = {
  serviceTypeId: string;
  status: 'available' | 'consumed' | 'expired' | 'refunded';
};

export type SessionCount = { number: number; of: number | null };

export function sessionNumber(
  history: readonly SessionHistoryEntry[],
  session: { id: string; serviceTypeId: string; checkedInAt: string },
  entitlements: readonly EntitlementEntry[] = [],
): SessionCount {
  const before = history.filter(
    (entry) =>
      entry.serviceTypeId === session.serviceTypeId &&
      entry.status === 'completed' &&
      entry.id !== session.id &&
      isBefore(entry, session),
  ).length;

  const number = before + 1;

  const forService = entitlements.filter((e) => e.serviceTypeId === session.serviceTypeId);
  if (forService.length === 0) {
    return { number, of: null };
  }
  // The programme is what has been done plus what is still owed. An expired
  // or refunded credit is neither, so it counts towards neither.
  const remaining = forService.filter((e) => e.status === 'available').length;
  const completed = history.filter(
    (entry) => entry.serviceTypeId === session.serviceTypeId && entry.status === 'completed',
  ).length;
  return { number, of: Math.max(number, completed + remaining) };
}

function isBefore(
  entry: { id: string; checkedInAt: string },
  session: { id: string; checkedInAt: string },
): boolean {
  if (entry.checkedInAt !== session.checkedInAt) {
    return entry.checkedInAt < session.checkedInAt;
  }
  return entry.id < session.id;
}
