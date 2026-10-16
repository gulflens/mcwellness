/**
 * How long a review is kept when it is not on the website
 * (docs/SPEC/testimonials.md section 6; docs/COMPLIANCE/data-inventory.md).
 * Pure: the scheduler passes the cutoffs to `app.purge_stale_testimonials`
 * (migration 978), which refuses any cutoff later than these floors, so a
 * mistake here can keep a review longer and can never delete one sooner.
 *
 * **Why a timer here, when nothing else deletes on one.** CLAUDE.md rule 8 is
 * the household record's retention floor. A review is not a client record: it
 * is what a member of the public wrote for publication, under a name they
 * chose, and once the office has said no there is no purpose left in keeping
 * it. Thirty days lets a declined review be looked at again if somebody asks
 * "where did mine go?"; a hundred and eighty is a generous wait for a review
 * nobody has decided on. An approved review stays while it is published, and
 * Withdraw turns it into a declined one, which this then removes.
 */

export const DECLINED_KEPT_DAYS = 30;
export const PENDING_KEPT_DAYS = 180;

const DAY_MS = 86_400_000;

export type TestimonialCutoffs = {
  /** A declined review decided before this is deleted. */
  declinedBefore: Date;
  /** A review still waiting that arrived before this is deleted. */
  pendingBefore: Date;
};

export function testimonialRetentionCutoffs(now: Date): TestimonialCutoffs {
  return {
    declinedBefore: new Date(now.getTime() - DECLINED_KEPT_DAYS * DAY_MS),
    pendingBefore: new Date(now.getTime() - PENDING_KEPT_DAYS * DAY_MS),
  };
}
