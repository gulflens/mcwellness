import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseErasureLetterTemplate } from '../../../domain/client/erasureLetter';
import {
  IDS,
  MORE_IDS,
  freshDatabase,
  rolledBack,
  seedClient,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
  setAuditContext,
} from '../../db/helpers';
import { assessmentId, seedAssessment, seedClientDocument } from './helpers';

/**
 * The erasure reaches the measurements (docs/SPEC/assessment.md section 6,
 * "The erasure step"; migration 106).
 *
 * **The files go and the figures stay**, and the confirmation letter says so.
 * A qEEG recording is the person's own brain activity and there is no version
 * of it that is not personal; the band powers, the reference figures and the
 * questionnaire totals identify nobody once the record around them is
 * anonymous, and the practice uses them in aggregate.
 */

const REQUEST = assessmentId('91', 1);
const BASELINE = assessmentId('92', 1);
const CORRECTION = assessmentId('92', 2);
const EXPORT = assessmentId('93', 1);
const LINK = assessmentId('93', 2);

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'brain-map');
  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
});

afterAll(async () => {
  await owner.end();
});

async function erase(): Promise<Record<string, unknown>> {
  await owner.query(
    'insert into erasure_request (id, tenant_id, client_id, reason) values ($1, $2, $3, $4)',
    [REQUEST, IDS.tenantA, IDS.clientA, 'Household asked to be forgotten'],
  );
  await setAuditContext(owner, IDS.ownerA);
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [IDS.tenantA, 'owner'],
  );
  const { rows } = await owner.query<{ erase_client: Record<string, unknown> }>(
    'select app.erase_client($1, $2) as erase_client',
    [IDS.clientA, REQUEST],
  );
  return rows[0]!.erase_client;
}

/** A baseline, a correction of it, and one filed export. */
async function seedMeasurements(): Promise<void> {
  await seedAssessment(owner, {
    id: BASELINE,
    tenantId: IDS.tenantA,
    clientId: IDS.clientA,
    practitionerId: MORE_IDS.practitionerA,
    conditionNote: 'Eyes closed, quiet room; the fan was on for the first minute.',
  });
  await owner.query(
    'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
      'instrument, instrument_version, derived, condition_note, version, supersedes_id, supersede_reason) ' +
      "values ($1, $2, $3, $4, now(), 'qeeg', '1', $5::jsonb, $6, 2, $7, $8)",
    [
      CORRECTION,
      IDS.tenantA,
      IDS.clientA,
      MORE_IDS.practitionerA,
      JSON.stringify({
        kind: 'brain-map',
        provenance: { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' },
        condition: 'eyes-closed',
        figures: [{ site: 'Fz', band: 'alpha', value: 12.5, unit: 'uV2' }],
      }),
      'Eyes closed, quiet room.',
      BASELINE,
      'The alpha figure at Fz was typed from the wrong column.',
    ],
  );
  await seedClientDocument(owner, {
    id: EXPORT,
    tenantId: IDS.tenantA,
    clientId: IDS.clientA,
    digest: 'synthetic-export',
  });
  await owner.query(
    'insert into assessment_document (id, tenant_id, client_id, assessment_id, document_id, role) ' +
      "values ($1, $2, $3, $4, $5, 'raw_recording')",
    [LINK, IDS.tenantA, IDS.clientA, BASELINE, EXPORT],
  );
}

describe('erasing a household that has been measured', () => {
  it('takes the files, keeps the figures, and clears the two free-text columns', async () => {
    await rolledBack(owner, async () => {
      await seedMeasurements();
      const summary = await erase();

      expect(summary).toMatchObject({
        assessmentsCleared: 2,
        assessmentFilesUnlinked: 1,
        // The export is one of the documents the erasure deletes: no
        // assessment bytes are left behind it.
        documentsDeleted: 1,
      });
      const keys = summary.storage_keys_to_delete as { id: string; storageKey: string }[];
      expect(keys.map((entry) => entry.id)).toEqual([EXPORT]);

      // No bytes: the document row is gone, and with it the link.
      const documents = await owner.query('select id from document where id = $1', [EXPORT]);
      expect(documents.rows).toHaveLength(0);
      const links = await owner.query('select id from assessment_document where client_id = $1', [
        IDS.clientA,
      ]);
      expect(links.rows).toHaveLength(0);

      // The figures stay, exactly as they were recorded.
      const measurements = await owner.query<{
        id: string;
        derived: { figures: { site: string; band: string; value: number; unit: string }[] };
        condition_note: string | null;
        supersede_reason: string | null;
        reference_age_years: number | null;
      }>(
        'select id, derived, condition_note, supersede_reason, reference_age_years ' +
          'from assessment where client_id = $1 order by version',
        [IDS.clientA],
      );
      expect(measurements.rows).toHaveLength(2);
      expect(measurements.rows[0]?.derived.figures[0]).toEqual({
        site: 'Fz',
        band: 'alpha',
        value: 10,
        unit: 'uV2',
      });
      expect(measurements.rows[0]?.reference_age_years).toBe(9);

      // And the words beside them go.
      expect(measurements.rows[0]?.condition_note).toBeNull();
      expect(measurements.rows[1]?.condition_note).toBeNull();
      // A first version carries no reason and is nulled; a correction must
      // carry one, so it takes the fixed phrase rather than breaking its own
      // constraint.
      expect(measurements.rows[0]?.supersede_reason).toBeNull();
      expect(measurements.rows[1]?.supersede_reason).toBe('Erased with the record');
    });
  });

  it('runs on a household that has never been measured', async () => {
    await rolledBack(owner, async () => {
      const summary = await erase();
      expect(summary).toMatchObject({ assessmentsCleared: 0, assessmentFilesUnlinked: 0 });
    });
  });

  it('writes the erasure’s own changes to the trail with the values withheld', async () => {
    await rolledBack(owner, async () => {
      await seedMeasurements();
      await erase();
      const trail = await owner.query<{ new_values: Record<string, unknown> | null }>(
        "select new_values from audit_log where entity_type = 'assessment' and action = 'update' " +
          'and client_id = $1',
        [IDS.clientA],
      );
      expect(trail.rows).toHaveLength(2);
      for (const row of trail.rows) {
        // app.audit_redact withholds the values inside an erasure and keeps
        // the field names (098_erasure_guard.sql).
        expect(JSON.stringify(row.new_values ?? {})).not.toContain('quiet room');
      }
    });
  });
});

const LETTER_DIR = new URL('../../../docs/CONSENT/erasure-letter/', import.meta.url);

function letter(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, LETTER_DIR)), 'utf8');
}

/** The letter's own body as one run of words: the templates are hard-wrapped. */
function sentences(file: string): string {
  return parseErasureLetterTemplate(letter(file)).body.replace(/\s+/g, ' ');
}

describe('the confirmation letter', () => {
  it('says the brain-map files have gone, in both languages', () => {
    // Section 6: "the confirmation letter must say this about assessments in
    // the same sentence it says it about sessions, or the letter is wrong".
    expect(sentences('en.md')).toContain('the files from any brain map or questionnaire');
    expect(sentences('en.md')).toContain("the recordings the equipment's own software produced");
    expect(sentences('ar.md')).toContain('وملفات أي خريطة دماغ أو استبيان');
  });

  it('says the figures stay, in both languages', () => {
    expect(sentences('en.md')).toContain(
      'the figures from a brain map and the total from a questionnaire',
    );
    expect(sentences('ar.md')).toContain('وأرقام خريطة الدماغ ومجموع الاستبيان');
  });

  it('attaches no word to a figure anywhere in either language', () => {
    for (const file of ['en.md', 'ar.md']) {
      const body = sentences(file).toLowerCase();
      for (const word of ['abnormal', 'diagnos', 'severity', 'moderate']) {
        expect(body).not.toContain(word);
      }
    }
  });
});
