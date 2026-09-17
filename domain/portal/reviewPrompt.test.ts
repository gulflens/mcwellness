import { describe, expect, it } from 'vitest';
import {
  BRAIN_MAP_SERVICE_CODE,
  REVIEW_PROMPT_DAYS,
  reviewMilestones,
  type ReviewEntitlement,
  type ReviewVisit,
} from './reviewPrompt';

/**
 * docs/SPEC/client-portal.md section 5, rule 9, and
 * docs/superpowers/specs/2026-09-17-review-prompt-design.md.
 *
 * Ids in the reserved shape; nothing here names a person.
 */

const TODAY = '2026-09-17';
const CLIENT = '00000001-0000-4000-8000-000000000021';
const OTHER = '00000001-0000-4000-8000-000000000022';
const VISIT = '00000001-0000-4000-8000-0000000000a1';
const OTHER_VISIT = '00000001-0000-4000-8000-0000000000a2';
const PURCHASE = '00000001-0000-4000-8000-000000000062';

function visit(overrides: Partial<ReviewVisit> = {}): ReviewVisit {
  return {
    id: VISIT,
    clientId: CLIENT,
    serviceCode: BRAIN_MAP_SERVICE_CODE,
    status: 'completed',
    date: '2026-09-10',
    ...overrides,
  };
}

function credit(
  status: ReviewEntitlement['status'],
  consumedOn: string | null,
  overrides: Partial<ReviewEntitlement> = {},
): ReviewEntitlement {
  return { packagePurchaseId: PURCHASE, clientId: CLIENT, status, consumedOn, ...overrides };
}

const NOTHING = { visits: [], purchases: [], entitlements: [], answered: [] };

describe('reviewMilestones', () => {
  it('raises a review milestone for a completed brain-map visit', () => {
    expect(reviewMilestones({ ...NOTHING, visits: [visit()] }, TODAY)).toEqual([
      { kind: 'brain_map', id: VISIT, clientId: CLIENT, reachedOn: '2026-09-10' },
    ]);
  });

  it('raises one for a package whose last credit has been used', () => {
    const milestones = reviewMilestones(
      {
        ...NOTHING,
        purchases: [{ id: PURCHASE, clientId: CLIENT }],
        entitlements: [credit('consumed', '2026-08-30'), credit('consumed', '2026-09-12')],
      },
      TODAY,
    );
    expect(milestones).toEqual([
      { kind: 'package_complete', id: PURCHASE, clientId: CLIENT, reachedOn: '2026-09-12' },
    ]);
  });

  it('ignores a package with credits left, and one with no credits at all', () => {
    expect(
      reviewMilestones(
        {
          ...NOTHING,
          purchases: [{ id: PURCHASE, clientId: CLIENT }],
          entitlements: [credit('consumed', '2026-09-12'), credit('available', null)],
        },
        TODAY,
      ),
    ).toEqual([]);
    expect(
      reviewMilestones(
        { ...NOTHING, purchases: [{ id: PURCHASE, clientId: CLIENT }], entitlements: [] },
        TODAY,
      ),
    ).toEqual([]);
  });

  it('leaves a refunded or waived credit out, as the progress figure does', () => {
    expect(
      reviewMilestones(
        {
          ...NOTHING,
          purchases: [{ id: PURCHASE, clientId: CLIENT }],
          entitlements: [credit('consumed', '2026-09-12'), credit('refunded', null)],
        },
        TODAY,
      ),
    ).toHaveLength(1);
  });

  it('ignores a visit that was not completed, and a visit for any other service', () => {
    expect(
      reviewMilestones({ ...NOTHING, visits: [visit({ status: 'no_show' })] }, TODAY),
    ).toEqual([]);
    expect(
      reviewMilestones({ ...NOTHING, visits: [visit({ status: 'confirmed' })] }, TODAY),
    ).toEqual([]);
    expect(
      reviewMilestones({ ...NOTHING, visits: [visit({ serviceCode: 'nf-session' })] }, TODAY),
    ).toEqual([]);
  });

  it('ignores a milestone older than ninety days, and one on a day that has not come', () => {
    expect(REVIEW_PROMPT_DAYS).toBe(90);
    // Ninety days back is the edge and still counts; ninety-one is out.
    expect(
      reviewMilestones({ ...NOTHING, visits: [visit({ date: '2026-06-19' })] }, TODAY),
    ).toHaveLength(1);
    expect(
      reviewMilestones({ ...NOTHING, visits: [visit({ date: '2026-06-18' })] }, TODAY),
    ).toEqual([]);
    expect(
      reviewMilestones({ ...NOTHING, visits: [visit({ date: '2026-09-18' })] }, TODAY),
    ).toEqual([]);
  });

  it('ignores a milestone the household has already answered', () => {
    expect(
      reviewMilestones(
        { ...NOTHING, visits: [visit()], answered: [{ kind: 'brain_map', id: VISIT }] },
        TODAY,
      ),
    ).toEqual([]);
    // The same id under the other kind is a different milestone.
    expect(
      reviewMilestones(
        { ...NOTHING, visits: [visit()], answered: [{ kind: 'package_complete', id: VISIT }] },
        TODAY,
      ),
    ).toHaveLength(1);
  });

  it('keeps one line per client, the most recent milestone', () => {
    const milestones = reviewMilestones(
      {
        visits: [visit({ date: '2026-09-01' }), visit({ id: OTHER_VISIT, date: '2026-09-05' })],
        purchases: [{ id: PURCHASE, clientId: CLIENT }],
        entitlements: [credit('consumed', '2026-09-14')],
        answered: [],
      },
      TODAY,
    );
    expect(milestones).toEqual([
      { kind: 'package_complete', id: PURCHASE, clientId: CLIENT, reachedOn: '2026-09-14' },
    ]);
  });

  it('answers the same way whatever order the rows arrive in', () => {
    const a = visit({ date: '2026-09-05' });
    const b = visit({ id: OTHER_VISIT, date: '2026-09-05' });
    expect(reviewMilestones({ ...NOTHING, visits: [a, b] }, TODAY)).toEqual(
      reviewMilestones({ ...NOTHING, visits: [b, a] }, TODAY),
    );
  });

  it("leaves another client's milestone in place beside this one's", () => {
    const milestones = reviewMilestones(
      {
        ...NOTHING,
        visits: [visit(), visit({ id: OTHER_VISIT, clientId: OTHER, date: '2026-09-11' })],
      },
      TODAY,
    );
    expect(milestones.map((row) => row.clientId)).toEqual([CLIENT, OTHER]);
  });
});
