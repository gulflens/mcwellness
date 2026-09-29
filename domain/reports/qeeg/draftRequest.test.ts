import { describe, expect, it } from 'vitest';
import { FAMILY_NAMES, GIVEN_NAMES } from '../../../db/seed/names';
import { blankFollowUp, blankInitial } from './blank';
import { DIMENSION_IDS } from './catalogue/ids';
import { assembleDraft, routeOwnedIn, subjectFrom, type ClientFacts } from './draftRequest';
import { validateQeegContent } from './shape';
import type { ComparedWith, QeegFollowUp } from './types';

/**
 * Brief L: what a brain-map draft takes from a request, and what the route
 * puts in its place. The client, where a report came from, what it is
 * compared with and a calculated figure are the server's (docs/SPEC/
 * reports-qeeg.md section 4, rule 11), so a request that carries one is
 * refused, and the route writes its own.
 */

const ID = (n: number) => `0000000D-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EARLIER = ID(1);
const SHA = 'e'.repeat(64);

const given = GIVEN_NAMES[7] ?? { en: 'Hazel', ar: 'بندق' };
const family = FAMILY_NAMES[4] ?? { en: 'Harbour', ar: 'مرفأ' };

const FACTS: ClientFacts = {
  givenNameAr: given.ar,
  familyNameAr: family.ar,
  dateOfBirth: '2016-05-20',
  sexAtBirth: 'female',
};

const COMPARED: ComparedWith = {
  reportId: EARLIER,
  recordedOn: '2026-03-14',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

/** What the route brings forward from the earlier report, as the prefill makes it. */
function broughtForward(): QeegFollowUp {
  const blank = blankFollowUp(COMPARED, 'follow_up');
  return {
    ...blank,
    dashboard: {
      ...blank.dashboard,
      attention_focus: { score: null, evidence: null, earlierScore: 6 },
    },
    change: {
      ...blank.change,
      pairs: {
        eyes_open: {
          earlier: { figureId: ID(9), sha256: SHA, widthPx: 800, heightPx: 600 },
          later: null,
        },
        eyes_closed: { earlier: null, later: null },
      },
    },
  };
}

/** A body with the parts the server writes taken out, as the editor sends it. */
function withoutServerParts(content: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(structuredClone(content)).filter(
      ([key]) => key !== 'subject' && key !== 'provenance',
    ),
  );
}

/** A body as the editor sends it: no client, no source, only the id of what it is compared with. */
function sentFollowUp(): Record<string, unknown> {
  return {
    ...withoutServerParts(blankFollowUp(COMPARED, 'follow_up')),
    comparedWith: { reportId: EARLIER },
  };
}

function sentInitial(): Record<string, unknown> {
  return withoutServerParts(blankInitial());
}

describe('subjectFrom', () => {
  it('writes the Arabic name, the age on the day of the recording and the sex from the record', () => {
    expect(subjectFrom(FACTS, { recordedOn: '2026-05-19', today: '2026-09-30' })).toEqual({
      nameAr: `${given.ar} ${family.ar}`,
      ageYears: 9,
      sex: 'female',
    });
    expect(subjectFrom(FACTS, { recordedOn: '2026-05-20', today: '2026-09-30' }).ageYears).toBe(10);
  });

  it('counts the age on today when no day of recording is given, or a day that is no day', () => {
    for (const recordedOn of [null, '2026-02-30', 'yesterday']) {
      expect(
        subjectFrom(FACTS, { recordedOn, today: '2026-09-30' }).ageYears,
        `${recordedOn}`,
      ).toBe(10);
    }
  });

  it('says nothing it does not know: no Arabic name, no date of birth, a sex not known', () => {
    expect(
      subjectFrom(
        { givenNameAr: null, familyNameAr: '  ', dateOfBirth: null, sexAtBirth: 'unknown' },
        { recordedOn: null, today: '2026-09-30' },
      ),
    ).toEqual({ nameAr: null, ageYears: null, sex: null });
    expect(
      subjectFrom({ ...FACTS, sexAtBirth: null }, { recordedOn: null, today: '2026-09-30' }).sex,
    ).toBeNull();
  });

  it('keeps one half of an Arabic name when only one is on the record', () => {
    expect(
      subjectFrom({ ...FACTS, familyNameAr: null }, { recordedOn: null, today: '2026-09-30' })
        .nameAr,
    ).toBe(given.ar);
  });

  it('gives no age for a birth after the recording, rather than a figure the shape refuses', () => {
    expect(
      subjectFrom(FACTS, { recordedOn: '2016-05-19', today: '2026-09-30' }).ageYears,
    ).toBeNull();
  });
});

describe('routeOwnedIn', () => {
  it('finds nothing in a body as the editor sends it', () => {
    expect(routeOwnedIn(sentInitial())).toEqual([]);
    expect(routeOwnedIn(sentFollowUp())).toEqual([]);
  });

  it('names the client and where a report came from, whatever they hold', () => {
    expect(routeOwnedIn({ ...sentInitial(), subject: null })).toEqual(['subject']);
    expect(
      routeOwnedIn({ ...sentInitial(), subject: { nameAr: null, ageYears: 4, sex: null } }),
    ).toEqual(['subject']);
    expect(routeOwnedIn({ ...sentInitial(), provenance: { origin: 'app' } })).toEqual([
      'provenance',
    ]);
  });

  it('names every fact of what a follow-up is compared with but its id', () => {
    const body = sentFollowUp();
    expect(routeOwnedIn({ ...body, comparedWith: COMPARED })).toEqual([
      'comparedWith.recordedOn',
      'comparedWith.relation',
      'comparedWith.origin',
      'comparedWith.reference',
    ]);
  });

  it('names a calculated figure, and a count of sessions said to be gathered', () => {
    const body = sentFollowUp();
    const change = body['change'] as Record<string, unknown>;
    const calculated = {
      kind: 'no_appreciable_change',
      source: 'calculated',
      basis: {
        earlierAssessmentId: ID(2),
        laterAssessmentId: ID(3),
        unit: 'uV2',
        sitesPaired: 19,
      },
    };
    const typed = { kind: 'no_appreciable_change', source: 'typed', basis: null };
    const withFigures = {
      ...body,
      change: {
        ...change,
        sessionsCompleted: { count: 20, source: 'gathered' },
        table: { delta: { position: 0, eyesOpen: typed, eyesClosed: calculated } },
      },
    };
    expect(routeOwnedIn(withFigures)).toEqual([
      'change.table.delta.eyesClosed.source',
      'change.sessionsCompleted.source',
    ]);
  });

  it('leaves a typed count of sessions and a typed figure to her', () => {
    const body = sentFollowUp();
    const change = body['change'] as Record<string, unknown>;
    expect(
      routeOwnedIn({
        ...body,
        change: { ...change, sessionsCompleted: { count: 20, source: 'typed' } },
      }),
    ).toEqual([]);
  });

  it('never throws on what is not a body, and reads only its own keys', () => {
    for (const value of [null, 3, 'x', [], { change: 'x' }, { comparedWith: [1] }]) {
      expect(routeOwnedIn(value)).toEqual([]);
    }
    const inherited = Object.create({ subject: {} }) as Record<string, unknown>;
    expect(routeOwnedIn(inherited)).toEqual([]);
  });
});

describe('assembleDraft', () => {
  it('writes the client and an app source into a first report the shape accepts', () => {
    const subject = subjectFrom(FACTS, { recordedOn: null, today: '2026-09-30' });
    const body = assembleDraft(sentInitial(), { subject, followUp: null });
    const checked = validateQeegContent(body);
    if (!checked.ok) throw new Error(JSON.stringify(checked.refusals));
    expect(checked.content.subject).toEqual(subject);
    expect(checked.content.provenance).toEqual({ origin: 'app' });
    expect(checked.content).toEqual({ ...blankInitial(), subject });
  });

  it('writes what a follow-up is compared with, and the earlier scores and maps, from the earlier report', () => {
    const subject = subjectFrom(FACTS, { recordedOn: null, today: '2026-09-30' });
    const sent = sentFollowUp();
    const dashboard = sent['dashboard'] as Record<string, Record<string, unknown>>;
    // A score she could type over the earlier one is a score that can disagree with it.
    const forged = {
      ...sent,
      dashboard: {
        ...dashboard,
        attention_focus: { ...dashboard['attention_focus'], earlierScore: 1 },
      },
    };
    const body = assembleDraft(forged, { subject, followUp: broughtForward() });
    const checked = validateQeegContent(body);
    if (!checked.ok) throw new Error(JSON.stringify(checked.refusals));
    if (checked.content.edition !== 'follow-up') throw new Error('not a follow-up');
    expect(checked.content.comparedWith).toEqual(COMPARED);
    expect(checked.content.dashboard.attention_focus.earlierScore).toBe(6);
    for (const d of DIMENSION_IDS.filter((each) => each !== 'attention_focus')) {
      expect(checked.content.dashboard[d].earlierScore, d).toBeNull();
    }
    expect(checked.content.change.pairs.eyes_open.earlier?.figureId).toBe(ID(9));
    expect(checked.content.change.pairs.eyes_closed.earlier).toBeNull();
  });

  it('keeps what she typed exactly as it was sent, for the shape to judge', () => {
    // RC4 N2: a mark that is nearly a mark reaches the shape as it was sent,
    // and is refused there by name, never dropped on the way.
    const subject = subjectFrom(FACTS, { recordedOn: null, today: '2026-09-30' });
    const nearly = { from: 0, to: 4, bold: true, underline: false };
    const body = assembleDraft(
      { ...sentInitial(), summary: { en: { text: 'Calm', marks: [nearly] }, ar: null } },
      { subject, followUp: null },
    );
    expect((body['summary'] as { en: { marks: unknown[] } }).en.marks).toEqual([nearly]);
    const checked = validateQeegContent(body);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.refusals.map((refusal) => refusal.path)).toContain(
      'summary.en.marks.0.underline',
    );
  });

  it('changes nothing it was handed', () => {
    const sent = sentFollowUp();
    const before = structuredClone(sent);
    const followUp = broughtForward();
    const followUpBefore = structuredClone(followUp);
    const subject = subjectFrom(FACTS, { recordedOn: null, today: '2026-09-30' });
    const body = assembleDraft(sent, { subject, followUp });
    expect(sent).toEqual(before);
    expect(followUp).toEqual(followUpBefore);
    (body['comparedWith'] as { reportId: string }).reportId = ID(5);
    expect(followUp.comparedWith.reportId).toBe(EARLIER);
  });

  it('leaves a part it cannot read for the shape to refuse by name', () => {
    const subject = subjectFrom(FACTS, { recordedOn: null, today: '2026-09-30' });
    const body = assembleDraft(
      { ...sentFollowUp(), dashboard: 'none', change: null },
      { subject, followUp: broughtForward() },
    );
    const checked = validateQeegContent(body);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    const paths = checked.refusals.map((refusal) => refusal.path);
    expect(paths).toContain('dashboard');
    expect(paths).toContain('change');
  });
});
