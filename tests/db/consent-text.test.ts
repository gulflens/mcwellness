import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySeed, isSeeded } from '../../db/seed/apply';
import { loadConsentTexts } from '../../db/seed/consent-text';
import { generateSeed } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { freshDatabase, rolledBack } from './helpers';

/**
 * The practice's consent wording, filed as documents (docs/SPEC/client-record.md
 * section 7, docs/CONSENT/README.md, migration 902): one row per purpose per
 * language, carrying the version and status from the file's own front matter
 * and the fingerprint of its actual bytes, so a consent row can point at the
 * exact text a person was shown and mean it.
 */

// A test key that unlocks nothing outside this file.
const KEYS = deriveIdentityKeys(Buffer.alloc(32, 7));
const data = generateSeed();

type DocumentRow = {
  id: string;
  kind: string;
  client_id: string | null;
  purpose: string;
  locale: string;
  version: string;
  status: string;
  mime_type: string;
  is_immutable: boolean;
  sha256: Buffer;
  storage_key: string;
};

let owner: pg.Client;
let rows: DocumentRow[];

beforeAll(async () => {
  owner = await freshDatabase();
  expect(await isSeeded(owner)).toBe(false);
  await applySeed(owner, data, KEYS);
  ({ rows } = await owner.query<DocumentRow>(
    "select * from document where kind = 'consent_text' order by purpose, locale",
  ));
});

afterAll(async () => {
  await owner.end();
});

describe('the seeded consent wording', () => {
  it('files one document per purpose and language: eight, all drafts', () => {
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => `${row.purpose}.${row.locale}`).sort()).toEqual([
      'home_visit.ar',
      'home_visit.en',
      'minor_participation.ar',
      'minor_participation.en',
      'participation.ar',
      'participation.en',
      'photo_video.ar',
      'photo_video.en',
    ]);
    for (const row of rows) {
      // Not the lawyer's yet, and the schema says so rather than a comment.
      expect(row.status).toBe('draft');
      expect(row.version).toBe('0.1-draft');
      expect(row.mime_type).toBe('text/markdown');
      // A practice document: it belongs to no one client, and is never rewritten.
      expect(row.client_id).toBeNull();
      expect(row.is_immutable).toBe(true);
    }
  });

  it('fingerprints the file that is actually in the repository', () => {
    const texts = loadConsentTexts();
    expect(texts).toHaveLength(8);

    for (const text of texts) {
      const onDisk = readFileSync(
        fileURLToPath(new URL(`../../docs/CONSENT/${text.file}`, import.meta.url)),
      );
      const row = rows.find(
        (candidate) => candidate.purpose === text.purpose && candidate.locale === text.locale,
      );

      expect(row).toBeDefined();
      expect(row?.sha256.toString('hex')).toBe(createHash('sha256').update(onDisk).digest('hex'));
      expect(row?.version).toBe(text.version);
      expect(row?.status).toBe(text.status);
    }
  });

  it('names each one by document id alone, never by what it says', () => {
    for (const row of rows) {
      expect(row.storage_key).toBe(`tenant/${data.tenant.id}/practice/${row.id}`);
      expect(row.storage_key).not.toContain(row.purpose);
    }
  });

  it('is what every seeded consent points at, in the language that household reads', async () => {
    const { rows: consents } = await owner.query<{
      purpose: string;
      preferred_locale: string;
      text_purpose: string;
      text_locale: string;
    }>(
      'select c.purpose, cl.preferred_locale, d.purpose as text_purpose, d.locale as text_locale ' +
        'from consent c join client cl on cl.id = c.client_id ' +
        'join document d on d.id = c.text_document_id',
    );

    expect(consents.length).toBeGreaterThan(0);
    for (const row of consents) {
      expect(row.text_purpose).toBe(row.purpose);
      expect(row.text_locale).toBe(row.preferred_locale);
    }
  });

  it('holds one row per version: the same wording is never filed twice', async () => {
    await rolledBack(owner, async () => {
      const first = rows[0];
      expect(first).toBeDefined();

      await expect(
        owner.query(
          'insert into document (tenant_id, kind, purpose, locale, version, status, storage_key, mime_type, sha256) ' +
            "select tenant_id, kind, purpose, locale, version, status, 'a-different-key', mime_type, sha256 " +
            'from document where id = $1',
          [first?.id],
        ),
      ).rejects.toThrow('document_consent_text_version_idx');
    });
  });

  it('keeps the four columns to consent wording: a referral letter has no purpose', async () => {
    // Each refusal gets its own transaction: the first aborts the one it is in.
    await rolledBack(owner, async () => {
      await expect(
        owner.query(
          'insert into document (tenant_id, kind, purpose, locale, version, status, storage_key, mime_type, sha256) ' +
            "values ($1, 'referral', 'participation', 'en', '1', 'draft', 'k1', 'application/pdf', $2)",
          [data.tenant.id, Buffer.alloc(32, 1)],
        ),
      ).rejects.toThrow('document_consent_text_columns_only');
    });
  });

  it('refuses a wording that names a purpose but not the language it is in', async () => {
    await rolledBack(owner, async () => {
      await expect(
        owner.query(
          'insert into document (tenant_id, kind, purpose, storage_key, mime_type, sha256) ' +
            "values ($1, 'consent_text', 'participation', 'k2', 'text/markdown', $2)",
          [data.tenant.id, Buffer.alloc(32, 2)],
        ),
      ).rejects.toThrow('document_consent_text_all_or_none');
    });
  });
});

describe('the session settings on a service', () => {
  it('gives the neurofeedback session its checklist and its questions, and no other service one', async () => {
    const { rows: services } = await owner.query<{
      code: string;
      preflight_checklist: { key: string; label_en: string; label_ar: string }[];
      rating_questions: { key: string; min: number; max: number }[];
    }>('select code, preflight_checklist, rating_questions from service_type order by code');

    const nf = services.find((service) => service.code === 'nf-session');
    expect(nf?.preflight_checklist.map((item) => item.key)).toEqual([
      'identity',
      'guardian_present',
      'child_assents',
      'environment',
      'equipment',
    ]);
    expect(nf?.rating_questions.map((item) => item.key)).toEqual(['sleep', 'focus', 'mood']);
    for (const item of nf?.preflight_checklist ?? []) {
      expect(item.label_en.length).toBeGreaterThan(0);
      expect(item.label_ar.length).toBeGreaterThan(0);
    }
    for (const item of nf?.rating_questions ?? []) {
      expect(item.min).toBe(0);
      expect(item.max).toBe(10);
    }
    for (const service of services.filter((s) => s.code !== 'nf-session')) {
      expect(service.preflight_checklist).toEqual([]);
      expect(service.rating_questions).toEqual([]);
    }
  });

  it('refuses anything but a JSON array in either column', async () => {
    for (const [column, constraint] of [
      ['preflight_checklist', 'service_type_preflight_checklist_is_array'],
      ['rating_questions', 'service_type_rating_questions_is_array'],
    ]) {
      // One transaction each: a refused statement aborts the one it is in.
      await rolledBack(owner, async () => {
        await expect(
          owner.query(`update service_type set ${column} = '{"key": "identity"}'::jsonb`),
        ).rejects.toThrow(constraint);
      });
    }
  });
});
