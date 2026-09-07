import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { practiceLogo } from '../../../app/api/billing/document-source';
import type { PracticeLogoResponse } from '../../../app/api/practice/schema';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * The practice's mark, filed once and read back onto its documents
 * (docs/SPEC/billing.md section 5.6, migration 909).
 *
 * Two halves meet here. The **filing** is the settings screen's route, which
 * already existed when this round began: `POST /api/practice/logo`, owner and
 * admin only, one row per practice, the bytes through the storage seam. The
 * **reading** is billing's own `practiceLogo`, which fetches those bytes and
 * turns them into something the PDF writer can draw — or answers null, so a
 * document still renders with the wordmark set in type when it cannot.
 *
 * Every image below is a PNG this file builds out of hexadecimal: a two-pixel
 * picture with a real header, a real `IDAT` and a real `IEND`. Nothing real
 * and nothing personal (.claude/rules/testing.md).
 */

const NOW = () => new Date('2026-09-08T08:00:00.000Z');

/** A 2 by 2 truecolour PNG, bit depth 8, not interlaced: the shape readPng embeds. */
const PNG_2X2 =
  '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a7300' +
  '0000124944415478da63f8cf0004ff41e8ff7f06001eef04fc132417c20000000049454e44ae426082';

/** The same file with its colour type changed to 6: truecolour with an alpha channel. */
function withAlpha(): string {
  const bytes = Buffer.from(PNG_2X2, 'hex');
  bytes[8 + 4 + 4 + 9] = 6;
  return bytes.toString('hex');
}

/** A JPEG's first bytes, which migration 909 allows as a logo and readPng will not embed. */
const JPEG = 'ffd8ffe000104a46494600010100000100010000ffd9';

let h: Harness;

/** The database as the owner, with the practice's own tenant stamped on the session. */
async function asOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, '00000000-0000-4000-8000-0000000000fb'],
  );
}

async function file(hex: string, mimeType: string, as = SEEDED.owner): Promise<Response> {
  return h.call('POST', '/api/practice/logo', as, {
    mimeType,
    bytesBase64: Buffer.from(hex, 'hex').toString('base64'),
  });
}

async function logoRows(): Promise<{ id: string; storage_key: string; mime_type: string }[]> {
  await asOwner();
  const { rows } = await h.owner.query<{ id: string; storage_key: string; mime_type: string }>(
    "select id, storage_key, mime_type from document where kind = 'practice_logo'",
  );
  return rows;
}

beforeAll(async () => {
  h = await startHarness(NOW);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('a practice with no logo', () => {
  it('renders its documents with no picture rather than refusing to render them', async () => {
    await asOwner();
    expect(await practiceLogo(h.owner, h.storage)).toBeNull();
  });
});

describe('filing the practice’s logo', () => {
  it('leaves one row however many times it is replaced', async () => {
    expect((await file(PNG_2X2, 'image/png')).status).toBe(200);
    expect((await file(PNG_2X2, 'image/png')).status).toBe(200);
    // Migration 909's partial unique index is what makes "the logo" a row you
    // can select rather than a convention.
    expect(await logoRows()).toHaveLength(1);
  });

  it('refuses a practitioner, because the practice’s mark is the owner’s', async () => {
    const res = await file(PNG_2X2, 'image/png', SEEDED.practitioner);
    expect(res.status).toBe(403);
  });
});

describe('reading it back onto a document', () => {
  it('gives the writer the picture that was filed, byte for byte', async () => {
    const filed = (await (await file(PNG_2X2, 'image/png')).json()) as PracticeLogoResponse;
    expect(filed.logo.mimeType).toBe('image/png');

    await asOwner();
    const image = await practiceLogo(h.owner, h.storage);
    if (!image) throw new Error('The practice has a logo and it was not read back.');
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(image.colours).toBe('rgb');
    // The compressed scanlines out of the store are the compressed scanlines
    // out of the file: nothing on this path decodes or recompresses anything.
    expect(Buffer.from(image.data).toString('hex')).toBe('78da63f8cf0004ff41e8ff7f06001eef04fc');
  });

  it('answers null for a logo whose bytes are gone from the store', async () => {
    await file(PNG_2X2, 'image/png');
    const rows = await logoRows();
    const key = rows[0]?.storage_key;
    if (!key) throw new Error('No logo was filed.');
    await h.storage.delete(key);

    await asOwner();
    expect(await practiceLogo(h.owner, h.storage)).toBeNull();
  });

  it('answers null for a JPEG, which the schema allows and this writer cannot embed', async () => {
    expect((await file(JPEG, 'image/jpeg')).status).toBe(200);
    await asOwner();
    expect(await practiceLogo(h.owner, h.storage)).toBeNull();
  });

  it('answers null for a PNG shape the writer will not embed', async () => {
    // An alpha channel would need a soft mask, which means decoding. The page
    // is set with the wordmark instead; nothing about the invoice is refused.
    expect((await file(withAlpha(), 'image/png')).status).toBe(200);
    await asOwner();
    expect(await practiceLogo(h.owner, h.storage)).toBeNull();
  });
});
