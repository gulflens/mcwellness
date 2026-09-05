/**
 * The reports module's pure rules (docs/SPEC/reports-v1.md section 8).
 *
 * Everything here is arithmetic and judgement over values: no I/O, no clock
 * read inside, no database, no import from another module's `domain/`
 * (docs/SPEC/OWNERSHIP.md rule 3). The routes under `app/api/reports/` are
 * thin and call these; the row policies under `db/policies/reports/` refuse
 * underneath them.
 *
 * The renderer is deliberately **not** re-exported here. This barrel is
 * browser-safe and is imported by screens; a PDF writer's names have no
 * business in it, and the one place that renders a report imports
 * `domain/reports/document` by its own path — the same discipline
 * `domain/shared/document` keeps.
 */

export { canIssue, credentialValidOn } from './canIssue';
export type { IssueAnswer, IssueRefusalCode, SigningCredential } from './canIssue';
export { canDeliver, DELIVERY_CHANNELS } from './canDeliver';
export type {
  DeliverableContact,
  DeliverAnswer,
  DeliverRefusalCode,
  DeliveryChannel,
  ParticipationConsent,
} from './canDeliver';
export {
  canSupersede,
  MAX_SUPERSEDE_REASON,
  MIN_SUPERSEDE_REASON,
  nextVersion,
} from './canSupersede';
export type { SupersedableReport, SupersedeAnswer, SupersedeRefusalCode } from './canSupersede';
export { compareBrainMaps, dominantBand, gatherProgress, ribbonFor } from './gatherProgress';
export type {
  AssessmentRow,
  EntitlementRow,
  GoalRow,
  ProgressNarrative,
  VisitRow,
} from './gatherProgress';
export { draftReportMessage } from './message';
export type { DraftedReportMessage, SendableReport } from './message';
export { REFERENCE_PREFIX, referenceFor, sequenceOf } from './referenceFor';
export { validateContent } from './validateContent';
export type { ContentAccepted, ContentAnswer, ContentRefusal } from './validateContent';
export { BAND_KEYS, REPORT_KINDS, REPORT_LOCALES, REPORT_STATUSES } from './types';
export type {
  BandKey,
  BrainMapComparison,
  ComparisonLine,
  GoalLine,
  IsoDate,
  PracticeSnapshot,
  ProgressReportContent,
  RatingPair,
  ReportContent,
  ReportDocument,
  ReportKind,
  ReportLocale,
  ReportRecipient,
  ReportStatus,
  Ribbon,
  RibbonSlice,
  SessionReportContent,
  SignerSnapshot,
} from './types';
export { ProgressReportShape } from './shapes/progress';
export { SessionReportShape } from './shapes/session';
