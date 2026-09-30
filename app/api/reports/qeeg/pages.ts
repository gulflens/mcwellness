import { createHash } from 'node:crypto';
import type { DocumentImage, FontSet } from '../../../../domain/shared/document';
import { readPng } from '../../../../domain/shared/document';
import type { StorageProvider } from '../../../../domain/shared/storage';
import { isoDateIn } from '../../../../domain/shared';
import {
  layoutQeegReport,
  renderQeegReport,
  type Laid,
  type PracticeLines,
  type QeegReportInput,
  type ReportFacts,
} from '../../../../domain/reports/qeeg/document';
import { unprintableIn } from '../../../../domain/reports/qeeg/document/unprintable';
import { subjectFrom } from '../../../../domain/reports/qeeg/draftRequest';
import { figuresNamedIn } from '../../../../domain/reports/qeeg/figuresNamed';
import type { FigureLink } from '../../../../domain/reports/qeeg/links';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import { reportFonts } from '../../billing/fonts';
import { practiceLogo } from '../../billing/document-source';
import type { Db } from '../../_middleware/request-context';
import { practiceTimeZone } from '../gather';
import type { ReportRecord } from '../source';

/**
 * A brain-map report's pages, put together on the server from its row, its
 * pictures and the practice (docs/SPEC/reports-qeeg.md section 12, "Rendered
 * on the server"). The preview, the issue and the repair path each ask here,
 * so the three can never assemble one report two ways.
 *
 * **A draft is assembled from today; a signed report from its own row.** A
 * draft's preview reads the client, the practice and its pictures as they
 * stand, and has no signer (section 12, point 9: the room, the rule and the
 * label). A signed report reads the recipient, the signer's four snapshots,
 * the practice's name and address, the reference and the day from the row
 * that `app.issue_report` wrote, and its content as it was frozen. That is
 * what lets the repair path render the filed bytes again.
 *
 * **Two things are read live even for a signed report**, as billing reads
 * them for an invoice (`app/api/billing/document-source.ts`, `practiceLogo`):
 * the practice's logo and its telephone, email and website on the footer.
 * Neither is snapshotted on a report row, and no migration here adds them. A
 * signed report whose practice has since changed its mark or its number no
 * longer renders to the bytes it was filed as, and the repair path then
 * refuses to overwrite the filed file and says so, exactly as it does for an
 * invoice. The filed PDF stays the record (section 12, known limit 4).
 *
 * **Pictures by the report's links, and nothing else** (section 9, point 6).
 * Every picture the content names is found through `report_figure` for this
 * report, its bytes read from the store under the linked document's key and
 * held to the link's digest. One whose bytes are gone, or differ, is refused
 * by the path of the field that names it, never drawn as an empty box.
 *
 * **What the editor is told** (section 12, point 10) travels beside the file:
 * the number of pages, the dashboard's scale, every part that runs over, every
 * character no face draws, and how sharply each map prints where it sits.
 * The preview puts it in a response header (`QEEG_LAYOUT_HEADER`), because
 * the screen already fetches the file itself before it opens it, and a header
 * is read on that same answer; a refusal carries it in its body.
 */

/** The response header the preview answers the editor's notes in, as JSON. */
export const QEEG_LAYOUT_HEADER = 'x-report-layout';

/** What the editor is told of a report's pages. ASCII throughout, so it fits a header. */
export type LayoutNotes = {
  readonly pages: number;
  readonly dashboardScale: number;
  readonly overflowing: readonly string[];
  readonly unprintable: readonly string[];
  readonly maps: readonly { figureId: string; dpi: number; quality: string }[];
  readonly pairs: readonly {
    figureId: string;
    condition: string;
    side: string;
    dpi: number;
    quality: string;
  }[];
};

export function notesOf(laid: Laid, fonts: FontSet): LayoutNotes {
  const round = (dpi: number) => Math.round(dpi);
  return {
    pages: laid.pages.length,
    dashboardScale: Math.round(laid.dashboardScale * 1000) / 1000,
    overflowing: [...laid.overflowing],
    unprintable: unprintableIn(laid.pages, fonts),
    maps: laid.maps.map((map) => ({
      figureId: map.figureId,
      dpi: round(map.dpi),
      quality: map.quality,
    })),
    pairs: laid.pairs.map((pair) => ({
      figureId: pair.figureId,
      condition: pair.condition,
      side: pair.side,
      dpi: round(pair.dpi),
      quality: pair.quality,
    })),
  };
}

// ---------------------------------------------------------------------------
// The client, gathered once more
// ---------------------------------------------------------------------------

const CLIENT_SQL =
  'select given_name, family_name, given_name_ar, family_name_ar, ' +
  "to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, " +
  'sex_at_birth::text as sex_at_birth, status::text as status ' +
  'from client where tenant_id = app.current_tenant_id() and id = $1';

type ClientRow = {
  given_name: string;
  family_name: string;
  given_name_ar: string | null;
  family_name_ar: string | null;
  date_of_birth: string | null;
  sex_at_birth: 'female' | 'male' | 'unknown' | null;
  status: string;
};

export type Gathered =
  | { ok: true; content: QeegContent; clientName: string }
  | { ok: false; code: 'not_found' | 'client_erased' };

/**
 * The content with its head read from the record once more: the client's
 * Arabic name, age on the day of the recording and sex (section 4, rule 11),
 * and the English name the page prints. Nothing else of the content moves.
 * The read is the caller's to log.
 */
export async function gatheredOnce(
  db: Db,
  clientId: string,
  content: QeegContent,
  now: Date,
): Promise<Gathered> {
  const found = await db.query<ClientRow>(CLIENT_SQL, [clientId]);
  const client = found.rows[0];
  if (!client) return { ok: false, code: 'not_found' };
  if (client.status === 'erased') return { ok: false, code: 'client_erased' };
  const subject = subjectFrom(
    {
      givenNameAr: client.given_name_ar,
      familyNameAr: client.family_name_ar,
      dateOfBirth: client.date_of_birth,
      sexAtBirth: client.sex_at_birth,
    },
    {
      recordedOn: content.recording.recordedOn,
      today: isoDateIn(now, await practiceTimeZone(db)),
    },
  );
  const clientName = [client.given_name, client.family_name]
    .filter((part) => part.length > 0)
    .join(' ');
  return { ok: true, content: { ...content, subject }, clientName };
}

// ---------------------------------------------------------------------------
// The practice
// ---------------------------------------------------------------------------

const PRACTICE_SQL =
  'select t.legal_name, t.legal_name_ar, l.display_address, t.contact_phone, ' +
  't.contact_email, t.website from tenant t left join location l on l.id = t.location_id ' +
  'where t.id = app.current_tenant_id()';

type PracticeRow = {
  legal_name: string;
  legal_name_ar: string | null;
  display_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
};

async function practiceRow(db: Db): Promise<PracticeRow | null> {
  const found = await db.query<PracticeRow>(PRACTICE_SQL);
  return found.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// The pictures
// ---------------------------------------------------------------------------

const LINKS_SQL =
  "select f.document_id, encode(f.sha256, 'hex') as sha256, " +
  'f.borrowed_from_report_id is not null as borrowed, d.storage_key ' +
  'from report_figure f join document d on d.tenant_id = f.tenant_id and d.id = f.document_id ' +
  'where f.tenant_id = app.current_tenant_id() and f.report_id = $1 order by f.created_at, f.id';

type LinkRow = { document_id: string; sha256: string; borrowed: boolean; storage_key: string };

/** A draft's links, as `ownLinksNotNamed` reads them. */
export async function linksOf(db: Db, reportId: string): Promise<FigureLink[]> {
  const found = await db.query<LinkRow>(LINKS_SQL, [reportId]);
  return found.rows.map((row) => ({ figureId: row.document_id, borrowed: row.borrowed }));
}

export type PictureRefusal = {
  readonly code: 'unlinked_figure' | 'map_missing' | 'map_differs';
  readonly field: string;
  readonly figureId: string;
};

export type Pictures =
  | { ok: true; pictures: Readonly<Record<string, DocumentImage>> }
  | { ok: false; refusal: PictureRefusal };

/**
 * Every picture the content names, read from the store through this report's
 * own links and held to the digest each link records. The first that is not
 * linked, not stored, or not what was filed is refused by its field.
 */
export async function picturesOf(
  db: Db,
  storage: StorageProvider,
  reportId: string,
  content: QeegContent,
): Promise<Pictures> {
  const named = figuresNamedIn(content);
  if (named.length === 0) return { ok: true, pictures: {} };
  const found = await db.query<LinkRow>(LINKS_SQL, [reportId]);
  const links = new Map(found.rows.map((row) => [row.document_id, row]));
  const pictures: Record<string, DocumentImage> = {};
  for (const figure of named) {
    const { figureId } = figure.ref;
    if (Object.hasOwn(pictures, figureId)) continue;
    const link = links.get(figureId);
    const at = `${figure.path}.figureId`;
    if (!link) return { ok: false, refusal: { code: 'unlinked_figure', field: at, figureId } };
    const bytes = await storage.get(link.storage_key);
    if (bytes === null) {
      return { ok: false, refusal: { code: 'map_missing', field: at, figureId } };
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== link.sha256 || digest !== figure.ref.sha256) {
      return { ok: false, refusal: { code: 'map_differs', field: at, figureId } };
    }
    try {
      pictures[figureId] = readPng(bytes);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { ok: false, refusal: { code: 'map_differs', field: at, figureId } };
    }
  }
  return { ok: true, pictures };
}

// ---------------------------------------------------------------------------
// The facts, for a draft and for a signed report
// ---------------------------------------------------------------------------

function linesOf(
  practice: PracticeRow,
  name: { name: string; nameAr: string | null; address: string | null },
): PracticeLines {
  return {
    ...name,
    phone: practice.contact_phone,
    email: practice.contact_email,
    website: practice.website,
  };
}

/** A draft's facts: the practice as it stands, no signer, no reference, no day of issue. */
export async function draftFacts(
  db: Db,
  storage: StorageProvider,
  input: {
    clientName: string;
    pictures: Readonly<Record<string, DocumentImage>>;
    draftWording: boolean;
  },
): Promise<ReportFacts | null> {
  const practice = await practiceRow(db);
  if (!practice) return null;
  return {
    clientName: input.clientName,
    reference: null,
    issuedOn: null,
    signer: null,
    practice: linesOf(practice, {
      name: practice.legal_name,
      nameAr: practice.legal_name_ar,
      address: practice.display_address,
    }),
    logo: await practiceLogo(db, storage),
    // Nothing on a draft today is calculated: the draft door refuses a
    // calculated figure until the mapping software's figures can be read
    // (brief L, route-owned parts).
    calculatedFrom: null,
    pictures: input.pictures,
    draftWording: input.draftWording,
  };
}

/**
 * A signed report's facts, from its own row: the recipient, the reference,
 * the day, the signer's four snapshots and the practice's name and address.
 * Null where the row is not a signed report.
 */
export async function signedFacts(
  db: Db,
  storage: StorageProvider,
  record: ReportRecord,
  pictures: Readonly<Record<string, DocumentImage>>,
): Promise<ReportFacts | null> {
  if (
    (record.status !== 'issued' && record.status !== 'superseded') ||
    record.reference === null ||
    record.issued_on === null ||
    record.signed_by_name === null ||
    record.signed_by_certification === null ||
    record.recipient_name === null ||
    record.practice_legal_name === null
  ) {
    return null;
  }
  const practice = await practiceRow(db);
  if (!practice) return null;
  return {
    clientName: record.recipient_name,
    reference: record.reference,
    issuedOn: record.issued_on,
    signer: {
      name: record.signed_by_name,
      certification: record.signed_by_certification,
      certifyingBody: record.signed_by_certifying_body,
      certificateNumber: record.signed_by_certificate_number,
    },
    practice: linesOf(practice, {
      name: record.practice_legal_name,
      nameAr: record.practice_legal_name_ar,
      address: record.practice_address,
    }),
    logo: await practiceLogo(db, storage),
    calculatedFrom: null,
    pictures,
  };
}

// ---------------------------------------------------------------------------
// A signed report, rendered again from its row
// ---------------------------------------------------------------------------

export type Filed =
  | { ok: true; bytes: Uint8Array; notes: LayoutNotes }
  | { ok: false; code: 'overrun'; notes: LayoutNotes }
  | { ok: false; code: 'not_signed' | 'invalid_content' }
  | { ok: false; code: PictureRefusal['code']; refusal: PictureRefusal };

/**
 * A signed brain-map report as it was filed: its frozen content, its row's
 * snapshots, its pictures. The issue route files what this answers, and the
 * repair path and the preview of a signed report answer the same, so a
 * re-render is the filed file or a refusal, never a third thing.
 */
export async function renderSigned(
  db: Db,
  storage: StorageProvider,
  record: ReportRecord,
): Promise<Filed> {
  const checked = validateQeegContent(record.content);
  if (!checked.ok) return { ok: false, code: 'invalid_content' };
  const pictures = await picturesOf(db, storage, record.id, checked.content);
  if (!pictures.ok) return { ok: false, code: pictures.refusal.code, refusal: pictures.refusal };
  const facts = await signedFacts(db, storage, record, pictures.pictures);
  if (facts === null) return { ok: false, code: 'not_signed' };
  return pagesOf({ content: checked.content, locale: record.locale, facts });
}

/**
 * The pages laid and what the editor is told of them, and the file when
 * nothing runs over: "no file is produced while anything runs over" (section
 * 12, known limit 1). The faces are the set of four (`reportFonts`), so a
 * bold Arabic word is bold.
 */
export function pagesOf(input: QeegReportInput): Filed {
  const fonts = reportFonts();
  const laid = layoutQeegReport(input, fonts);
  const notes = notesOf(laid, fonts);
  if (laid.overflowing.length > 0) return { ok: false, code: 'overrun', notes };
  return { ok: true, bytes: renderQeegReport(input, fonts), notes };
}

/** The header's value: the notes as JSON, which is ASCII (`unprintableIn` names code points). */
export function notesHeader(notes: LayoutNotes): string {
  return JSON.stringify(notes);
}
