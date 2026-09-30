import { z } from 'zod';
import {
  DELIVERY_CHANNELS,
  REPORT_KINDS,
  REPORT_LOCALES,
  REPORT_STATUSES,
} from '../../../domain/reports';

/**
 * What the reports routes take and answer (docs/SPEC/reports-v1.md section
 * 7.1). Every request is parsed before it reaches a query and every response is
 * parsed before it leaves, so a shape that drifts fails here rather than on a
 * screen.
 *
 * `content` is deliberately `unknown` at this boundary: its shape is the
 * domain's to declare per kind (`domain/reports/shapes/`) and
 * `validateContent` is what refuses it, with the field named. Parsing it twice,
 * once here and once there, would be two answers to what a report body is.
 */

export const ReportKindInput = z.enum(REPORT_KINDS);
/**
 * The kinds `POST /api/reports/draft` writes: the two whose figures it
 * gathers from the record. A brain-map report is not one of them — its body,
 * its figures and its source are its own route's (docs/SPEC/reports-qeeg.md
 * section 14) — so a draft of one sent here is refused at the edge rather
 * than read as a session report's.
 */
export const DraftKindInput = z.enum(['session', 'progress']);
export type DraftKind = z.infer<typeof DraftKindInput>;
export const ReportStatusOutput = z.enum(REPORT_STATUSES);
export const ReportLocaleInput = z.enum(REPORT_LOCALES);
export const DeliveryChannelInput = z.enum(DELIVERY_CHANNELS);

/** One row of the Reports tab (section 4.1). */
export const ReportRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  kind: ReportKindInput,
  status: ReportStatusOutput,
  locale: ReportLocaleInput,
  /** Null on a draft: a number is allocated at issue and never before. */
  reference: z.string().nullable(),
  issuedOn: z.string().nullable(),
  coverageFrom: z.string().nullable(),
  coverageTo: z.string().nullable(),
  signedByName: z.string().nullable(),
  version: z.number().int().min(1),
  supersedesId: z.uuid().nullable(),
  amendmentReason: z.string().nullable(),
  documentId: z.uuid().nullable(),
  /** How many times it has been handed to somebody. Never who, on a list. */
  deliveries: z.number().int().min(0),
  createdAt: z.string(),
  /**
   * A brain map's second-language report names the report it was made from
   * (docs/SPEC/reports-qeeg.md section 8). Defaulted, so a screen written
   * before it reads an answer as it did.
   */
  twinOfId: z.uuid().nullable().default(null),
  /** The report made from this one in the other language, a draft or signed, if any. */
  twinId: z.uuid().nullable().default(null),
  /**
   * The report this one was made from has been corrected since (section 8,
   * point 5): worked out when it is read, from the two rows, never stored.
   */
  outOfStep: z.boolean().default(false),
  /**
   * Read from the practice's old tool's file (docs/SPEC/reports-qeeg.md
   * section 11): a draft being brought in, or a kept past record. Defaulted,
   * as the three above are.
   */
  pastRecord: z.boolean().default(false),
  /** A past record withdrawn because it was kept against the wrong client (point 7). */
  withdrawn: z.boolean().default(false),
  /**
   * A brain map's day of recording, as its content says, or null: what a
   * follow-up's list of earlier reports is ordered by (brief R, item 8).
   */
  recordedOn: z.string().nullable().default(null),
});
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportListResponse = z.object({ reports: z.array(ReportRow) });
export type ReportListResponse = z.infer<typeof ReportListResponse>;

/** One delivery, as the practice's own screen shows it (section 4.3). */
export const DeliveryRow = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactLabel: z.string(),
  channel: DeliveryChannelInput,
  sentAt: z.string(),
});
export type DeliveryRow = z.infer<typeof DeliveryRow>;

export const ReportResponse = z.object({
  report: ReportRow,
  content: z.unknown(),
  deliveries: z.array(DeliveryRow),
  /** Present only when the report has a filed PDF and the caller may open it. */
  url: z.string().nullable(),
  expiresInSeconds: z.number().int().positive().nullable(),
  /**
   * When the row was last written, which a brain-map draft's next save must
   * name (`QeegDraftInput.savedAt`). The server always sends it; it is
   * optional here only so a screen written before it reads a response as it
   * did.
   */
  savedAt: z.string().optional(),
});
export type ReportResponse = z.infer<typeof ReportResponse>;

/**
 * Creating or updating a draft. `id` present is an update; absent is a new
 * draft. `gather` asks the server to fill the figures in from the record — a
 * figure a practitioner could retype is a figure that can disagree with it
 * (section 4.2) — and `content` carries only what a person writes.
 */
export const DraftInput = z.object({
  id: z.uuid().optional(),
  clientId: z.uuid(),
  kind: DraftKindInput,
  locale: ReportLocaleInput.default('en'),
  serviceTypeId: z.uuid().nullable().default(null),
  /**
   * The completed visit a **session** report follows. Required for that kind
   * and refused for a progress report, which covers a stretch rather than a
   * day. The figures are then read from that visit and never from the request.
   */
  sessionId: z.uuid().nullable().default(null),
  coverageFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  coverageTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /**
   * The whole body, as the editor holds it. Validated by
   * `domain/reports/validateContent` and never by this schema.
   */
  content: z.unknown(),
});
export type DraftInput = z.infer<typeof DraftInput>;

export const DraftResponse = z.object({
  report: ReportRow,
  content: z.unknown(),
});
export type DraftResponse = z.infer<typeof DraftResponse>;

/**
 * Only the kind, read first, so `POST /api/reports/draft` can hand the body to
 * the door that knows it: the two gathered kinds to `DraftInput`, a brain map
 * to `QeegDraftInput`.
 */
export const DraftKindOf = z.object({ kind: ReportKindInput });

/**
 * The stamp of the save a brain-map draft is made over, as the server sent it:
 * the row's last write, in UTC, to the microsecond.
 */
export const SavedAt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

/**
 * Creating or updating a brain-map (qEEG) draft (docs/SPEC/reports-qeeg.md
 * section 14). `id` present is an update, and must then say which save it is
 * made over (`savedAt`), so a page left open in a second tab cannot save over
 * a newer one.
 *
 * **Strict.** What the server owns has no field here and cannot be sent: where
 * a report came from (`imported_from`, `source_sha256` are the import's, a
 * later door), its twin in the other language, the comparison's column (the
 * route writes it from the body's `comparedWith.reportId`), its status. An
 * unknown field is refused, not ignored, so a caller who believes it set one
 * is told it did not.
 *
 * `locale` is the draft's at creation, `en` unless said. A saved draft keeps
 * its language: each language is its own report (section 8), and the second
 * is made from the first by its own door.
 *
 * `content` is the body as the editor holds it, less the parts the server
 * writes (the client, where it came from, what a follow-up is compared with
 * beyond its id). Held to `validateQeegContent`, never to this schema.
 */
export const QeegDraftInput = z
  .object({
    id: z.uuid().optional(),
    clientId: z.uuid(),
    kind: z.literal('qeeg'),
    locale: ReportLocaleInput.optional(),
    serviceTypeId: z.uuid().nullable().default(null),
    savedAt: SavedAt.optional(),
    content: z.unknown(),
  })
  .strict()
  .refine((input) => input.id === undefined || input.savedAt !== undefined, {
    path: ['savedAt'],
    message: 'An update names the save it is made over.',
  });
export type QeegDraftInput = z.infer<typeof QeegDraftInput>;

/**
 * The body a draft save may carry: 512 KiB, where every other route keeps
 * 64 KiB (`app/api/create-api.ts`).
 *
 * **Why so much.** A brain map is the largest thing a person types here. The
 * shape accepts, in both languages: two formatted summaries of 4,000 each with
 * 200 marks apiece, twelve items she added to each of four lists with a label
 * of 160 and a note of 400, eight map captions of 120, six pieces of evidence
 * of 400 and two headline captions of 120. That is about 77,000 typed UTF-16
 * units. Arabic is two bytes a unit in the JSON and another script up to
 * three, so the typed text alone may reach about 230 KB, and the marks, keys
 * and figures around it add some 60 KB more: about 290 KB at worst. Measured:
 * the largest body the test builds, every half in Arabic, is 157,950 bytes
 * (`tests/reports/db/qeeg_draft.test.ts`). 512 KiB is the worst case with
 * room to spare, and the logo's own figure, so the API has two envelope sizes
 * and not three. The older kinds share the path and so the envelope; their
 * bodies are a few kilobytes and their shapes refuse more.
 */
export const REPORT_DRAFT_BODY_LIMIT_BYTES = 512 * 1024;
export const REPORT_DRAFT_PATH = '/api/reports/draft';

/** A brain-map draft as saved, with the stamp its next save must name. */
export const QeegDraftResponse = z.object({
  report: ReportRow,
  content: z.unknown(),
  savedAt: SavedAt,
});
export type QeegDraftResponse = z.infer<typeof QeegDraftResponse>;

/**
 * A follow-up begun from an earlier report (`GET /api/reports/qeeg/prefill`,
 * brief S): the content to start from, what she chose last time for the form
 * to offer, and the count of sessions with the days it ran between (`after`
 * and `before` left out; `through` taken in, set only while the new recording
 * has no day). `content` and `offered` are held to the domain's shapes by the
 * form, never to this schema.
 */
export const QeegPrefillResponse = z.object({
  content: z.unknown(),
  offered: z.unknown(),
  sessions: z.object({
    count: z.number().int().min(0),
    after: z.string(),
    before: z.string().nullable(),
    through: z.string().nullable(),
  }),
});
export type QeegPrefillResponse = z.infer<typeof QeegPrefillResponse>;

/** What the draft screen shows before a practitioner writes a word. */
export const GatherResponse = z.object({
  content: z.unknown(),
  /** True when the assessment table is on this database and was read. */
  brainMapsRead: z.boolean(),
});
export type GatherResponse = z.infer<typeof GatherResponse>;

/** One completed visit a session report may be written about (section 4.2). */
export const VisitChoice = z.object({
  id: z.uuid(),
  on: z.string(),
  serviceName: z.string(),
  practitionerName: z.string(),
  durationMinutes: z.number().int().nullable(),
});
export type VisitChoice = z.infer<typeof VisitChoice>;

export const VisitsResponse = z.object({ visits: z.array(VisitChoice) });
export type VisitsResponse = z.infer<typeof VisitsResponse>;

/**
 * Issuing takes **nothing**. Who signs is the person signed in: the route
 * reads their own practitioner row and `app.issue_report` refuses any other
 * (section 10, decision 3). A field naming a signer would be a field through
 * which one person could put a colleague's name and certificate number on a
 * document, and the trail would name the actor while the document did not.
 */
export const IssueInput = z.object({});
export type IssueInput = z.infer<typeof IssueInput>;

/**
 * Signing a brain-map (qEEG) draft. It still names no signer: the person
 * signing is the one signed in, as for every report. It names the save it is
 * made over (`savedAt`), so what is signed is the version on her screen and
 * not one saved since in another tab (docs/SPEC/reports-qeeg.md section 14).
 * Strict: a field the route does not take is refused, not ignored.
 */
export const QeegIssueInput = z.object({ savedAt: SavedAt }).strict();
export type QeegIssueInput = z.infer<typeof QeegIssueInput>;

/**
 * What a brain-map report's preview tells the editor of its pages
 * (docs/SPEC/reports-qeeg.md section 12, point 10), in the preview's
 * `x-report-layout` header and in the body of a refusal to produce the file.
 */
export const QeegLayoutNotes = z.object({
  pages: z.number().int().min(0),
  dashboardScale: z.number(),
  /** The id of every part that runs over. */
  overflowing: z.array(z.string()),
  /** Every character no face draws, as `U+` and its code point. */
  unprintable: z.array(z.string()),
  /** How many more such characters, beyond the first twenty named. */
  unprintableMore: z.number().int().min(0),
  maps: z.array(
    z.object({
      figureId: z.string(),
      dpi: z.number(),
      quality: z.enum(['good', 'fair', 'poor']),
    }),
  ),
  pairs: z.array(
    z.object({
      figureId: z.string(),
      condition: z.string(),
      side: z.enum(['earlier', 'later']),
      dpi: z.number(),
      quality: z.enum(['good', 'fair', 'poor']),
    }),
  ),
});
export type QeegLayoutNotes = z.infer<typeof QeegLayoutNotes>;

export const IssueResponse = z.object({
  report: ReportRow,
});
export type IssueResponse = z.infer<typeof IssueResponse>;

export const SupersedeInput = z.object({
  reason: z.string(),
  /** The corrected body. The new version is a whole report, not a patch. */
  content: z.unknown(),
  locale: ReportLocaleInput.optional(),
});
export type SupersedeInput = z.infer<typeof SupersedeInput>;

/**
 * Correcting a signed brain-map (qEEG) report: a reason, and nothing to
 * correct it with. The new draft starts from what was signed
 * (`app/api/reports/qeeg/supersede.ts`); `content` is named here only so a
 * body that sends it is refused by name rather than as an unknown field, and
 * `locale` so a body naming another language is told why.
 */
export const QeegSupersedeInput = z
  .object({
    reason: z.string(),
    content: z.unknown().optional(),
    locale: ReportLocaleInput.optional(),
  })
  .strict();
export type QeegSupersedeInput = z.infer<typeof QeegSupersedeInput>;

/**
 * Starting a brain-map report's second language from a signed one
 * (`app/api/reports/qeeg/twin.ts`). Nothing is sent: the language is the one
 * the report is not in, and the content, the maps and what it is compared
 * with are the signed report's. The reason travels in `X-Reason`.
 */
export const TwinInput = z.object({}).strict();
export type TwinInput = z.infer<typeof TwinInput>;

export const TwinResponse = z.object({
  /** The new draft in the other language, ready for its halves of typed text. */
  report: ReportRow,
});
export type TwinResponse = z.infer<typeof TwinResponse>;

/** A fingerprint of a file, as small hexadecimal: what `source_sha256` holds (migration 602). */
export const SourceSha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Bringing in a past record from the practice's old tool
 * (`POST /api/reports/qeeg/import`, docs/SPEC/reports-qeeg.md section 11).
 *
 * **What the reader made of the file, never the file** (point 1): the file is
 * read in the browser by `readLegacyReport` and only its `content` is sent,
 * with the fingerprint of the file's bytes, which the content's own
 * provenance must repeat. The name, age and sex the file typed are shown in
 * the browser and never sent (point 2): the content's `subject` must be
 * empty, and there is no field here for them. Strict, so a body that tries to
 * carry them beside the content is refused rather than read.
 */
export const ImportInput = z
  .object({
    clientId: z.uuid(),
    sourceSha256: SourceSha256,
    content: z.unknown(),
  })
  .strict();
export type ImportInput = z.infer<typeof ImportInput>;

/** The import draft as saved, with the stamp its pictures and its keep are made over. */
export const ImportResponse = z.object({
  report: ReportRow,
  content: z.unknown(),
  savedAt: SavedAt,
});
export type ImportResponse = z.infer<typeof ImportResponse>;

/**
 * Keeping a past record (`POST /api/reports/:id/keep-import`): where each of
 * its pictures went once filed through the maps door, keyed by its place in
 * the file as the reader keys it, and the places that could not be brought in
 * (section 11, point 5). Nothing else of the record can change: the content is
 * the one brought in. `savedAt` is the last write's, the last picture's.
 */
export const KeepImportInput = z
  .object({
    savedAt: SavedAt,
    maps: z.record(z.string(), z.unknown()),
    leftOut: z.array(z.string().max(12)).max(8),
  })
  .strict();
export type KeepImportInput = z.infer<typeof KeepImportInput>;

/**
 * Withdrawing a past record kept against the wrong client
 * (`POST /api/reports/:id/withdraw-import`, point 7): why, and nothing else.
 *
 * **The reason is in the body**, as a correction's is, because a person types
 * it and a header carries only Latin-1: an apostrophe typed on a phone, or a
 * word in Arabic, cannot travel in `X-Reason`. The route cleans it as the
 * fence cleans a header, stamps it on the transaction for the trail, and
 * keeps it on the row.
 */
export const WithdrawImportInput = z.object({ reason: z.string().max(2000) }).strict();
export type WithdrawImportInput = z.infer<typeof WithdrawImportInput>;

/** A past record kept or withdrawn, as the list shows it. */
export const PastRecordResponse = z.object({ report: ReportRow });
export type PastRecordResponse = z.infer<typeof PastRecordResponse>;

/** The path whose body carries a whole brain map, and so the draft's envelope. */
export const REPORT_IMPORT_PATH = '/api/reports/qeeg/import';

export const SupersedeResponse = z.object({
  /** The new draft, ready to be read over and signed. */
  report: ReportRow,
});
export type SupersedeResponse = z.infer<typeof SupersedeResponse>;

export const DeliverInput = z.object({
  contactId: z.uuid(),
  channel: DeliveryChannelInput,
});
export type DeliverInput = z.infer<typeof DeliverInput>;

export const DeliverResponse = z.object({
  channel: DeliveryChannelInput,
  delivered: z.boolean(),
  handoffUrl: z.string().optional(),
  message: z.string(),
});
export type DeliverResponse = z.infer<typeof DeliverResponse>;

/** The declared shapes, so a screen builds its form from the same source. */
export const SchemaResponse = z.object({
  kinds: z.array(ReportKindInput),
  locales: z.array(ReportLocaleInput),
  channels: z.array(DeliveryChannelInput),
  fields: z.record(z.string(), z.array(z.string())),
});
export type SchemaResponse = z.infer<typeof SchemaResponse>;

export const DocumentLinkResponse = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type DocumentLinkResponse = z.infer<typeof DocumentLinkResponse>;
