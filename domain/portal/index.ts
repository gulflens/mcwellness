/**
 * The portal's own rules (docs/SPEC/client-portal.md section 5). Browser-safe,
 * like every domain barrel: no Node built-in is reachable from here, directly
 * or through anything it imports (tests/lint/no-node-imports-in-browser-bundle).
 */
export { ADULT_AGE, moneyVisibleTo } from './money';
export type { MoneyClient, MoneyContact } from './money';
export { describeAccess, INVITE_KINDS, INVITE_VALID_DAYS, inviteExpiry } from './invite';
export type {
  Access,
  AccessContact,
  AccessInvite,
  AccessState,
  AccessUser,
  InviteKind,
} from './invite';
export { reportsVisibleTo } from './reports';
export {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_STATES,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENTS_SHOWN,
  announcementStates,
  announcementWarnings,
  correctionTakesOverNow,
  announcementsFor,
  announcementsVisibleTo,
  checkAnnouncement,
  isCurrentOn,
} from './announcements';
export { normaliseForCheck, wellnessWords } from './announcementWords';
export type { WellnessFindings } from './announcementWords';
export type {
  AnnouncementDraft,
  AnnouncementField,
  AnnouncementProblem,
  AnnouncementProblemCode,
  AnnouncementRow,
  AnnouncementState,
  AnnouncementViewer,
  AnnouncementWarning,
  Bilingual,
} from './announcements';
export type { ReportClient, ReportContact } from './reports';
export { packageProgress } from './packages';
export {
  BRAIN_MAP_SERVICE_CODE,
  REVIEW_MILESTONE_KINDS,
  REVIEW_PROMPT_DAYS,
  reviewMilestones,
} from './reviewPrompt';
export type {
  ReviewAnswer,
  ReviewEntitlement,
  ReviewInput,
  ReviewMilestone,
  ReviewMilestoneKind,
  ReviewPurchase,
  ReviewVisit,
} from './reviewPrompt';
export type { PackageProgress, ProgressEntitlement, ProgressPurchase } from './packages';
export {
  APPOINTMENT_STATUSES,
  VISIT_OUTCOMES,
  visitOutcome,
  visitOutcomeWord,
  visitsFor,
} from './visits';
export type { AppointmentStatus, SplittableVisit, VisitOutcome, VisitSplit } from './visits';
