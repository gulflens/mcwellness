import { useRef, useState, type FormEvent } from 'react';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementWarnings,
  checkAnnouncement,
  correctionTakesOverNow,
  type AnnouncementField,
  type AnnouncementProblem,
  type AnnouncementWarning,
} from '../../../domain/portal';
import type { OfficeAnnouncement } from '../../api/portal/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from '../../shell/components/useDrawer';
import { ArabicPreview, ArabicTextField } from './AnnouncementArabic';

/**
 * Writing an announcement, or a correction of one (Settings › Announcements;
 * docs/SPEC/client-portal.md section 3.10).
 *
 * Two steps in one drawer. **Write**: the title and the text in English and in
 * Arabic, and the first and last days if the practice wants them. **Preview**:
 * both languages exactly as a household will read them, checked first by the
 * same rule the route asks (`checkAnnouncement`) so a medical word or a box
 * left empty is caught before anything is sent; then a reason, and Publish.
 * Nothing is written until Publish.
 *
 * **A correction is a new announcement.** Opened from a standing one, the
 * drawer carries its words over to be changed, and publishing it withdraws
 * the one it corrects in the same act. There is no way to change a published
 * announcement's words, here or anywhere.
 */

const FIELD_NAME: Record<AnnouncementField, string> = {
  titleEn: 'The English title',
  titleAr: 'The Arabic title',
  bodyEn: 'The English text',
  bodyAr: 'The Arabic text',
  visibleUntil: 'The last day',
};

function sentenceFor(problem: AnnouncementProblem): string {
  const name = FIELD_NAME[problem.field];
  switch (problem.code) {
    case 'empty':
      return `${name} is empty. An announcement is written in both languages.`;
    case 'too_long':
      return `${name} is longer than ${
        problem.field === 'titleEn' || problem.field === 'titleAr'
          ? ANNOUNCEMENT_TITLE_MAX
          : ANNOUNCEMENT_BODY_MAX
      } characters. Shorten it; nothing is cut.`;
    case 'medical_word':
      return `${name} uses a word of another kind of practice. McWellness is a wellness practice: say sessions, goals and measurements.`;
    case 'before_from':
      return 'The last day is before the first.';
    case 'in_the_past':
      return 'The last day has already gone.';
  }
}

/** The ambiguous words at preview, in one sentence the writer can act on. */
function warningSentence(warnings: readonly AnnouncementWarning[]): string {
  const named = warnings
    .map((warning) => `“${warning.term}”, in ${FIELD_NAME[warning.field].replace(/^The /, 'the ')}`)
    .join('; ');
  const verb = warnings.length === 1 ? 'This word can' : 'These words can';
  return `${named}. ${verb} read as a medical claim. Check the sense before you publish.`;
}

const FORBIDDEN = 'Announcements are the owner’s and an admin’s to publish.';
const GENERIC = 'It could not be published. Try again.';
const REFUSALS: Record<string, string> = {
  already_withdrawn:
    'That announcement has already been withdrawn, so there is nothing to correct.',
  already_corrected: 'That announcement has already been corrected.',
  not_found: 'That announcement could not be found.',
  reason_required: 'Say why, in a sentence.',
  confirm_wording: 'Confirm the words named above before you publish.',
};

type Words = { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string };

export function AnnouncementDrawer({
  today,
  correcting,
  onClose,
  onDone,
}: {
  /** The practice's own today, from the list. */
  today: string;
  /** The standing announcement this corrects, or null for a new one. */
  correcting: OfficeAnnouncement | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [words, setWords] = useState<Words>({
    titleEn: correcting?.title.en ?? '',
    titleAr: correcting?.title.ar ?? '',
    bodyEn: correcting?.body.en ?? '',
    bodyAr: correcting?.body.ar ?? '',
  });
  const [visibleFrom, setVisibleFrom] = useState(correcting?.visibleFrom ?? '');
  const [visibleUntil, setVisibleUntil] = useState(correcting?.visibleUntil ?? '');
  const [problems, setProblems] = useState<AnnouncementProblem[]>([]);
  const [step, setStep] = useState<'write' | 'preview'>('write');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = {
    title: { en: words.titleEn.trim(), ar: words.titleAr.trim() },
    body: { en: words.bodyEn.trim(), ar: words.bodyAr.trim() },
    visibleFrom: visibleFrom === '' ? null : visibleFrom,
    visibleUntil: visibleUntil === '' ? null : visibleUntil,
  };

  const errorFor = (field: AnnouncementField): string | undefined => {
    const problem = problems.find((row) => row.field === field);
    return problem ? sentenceFor(problem) : undefined;
  };

  const take = (field: keyof Words) => (value: string) =>
    setWords((was) => ({ ...was, [field]: value }));

  function preview(event: FormEvent): void {
    event.preventDefault();
    const found = checkAnnouncement(draft, today);
    setProblems(found);
    setFormError(null);
    setConfirmed(false);
    if (found.length === 0) setStep('preview');
  }

  async function publish(): Promise<void> {
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch('/api/portal/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({
          ...draft,
          supersedesId: correcting?.id ?? null,
          confirmedWarnings: warnings.length > 0 && confirmed,
        }),
      });
      if (res.ok) {
        onDone();
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN);
        return;
      }
      const answer = (await res.json().catch(() => null)) as {
        error?: string;
        problems?: AnnouncementProblem[];
      } | null;
      if (answer?.error === 'wording' && Array.isArray(answer.problems)) {
        // The server's own check disagreed (a day passed at midnight, say):
        // back to the words, with the sentence in the field it is about.
        setProblems(answer.problems);
        setStep('write');
        return;
      }
      setFormError(REFUSALS[answer?.error ?? ''] ?? GENERIC);
    } catch {
      setFormError(GENERIC);
    } finally {
      setBusy(false);
    }
  }

  const title = correcting ? 'Correct an announcement' : 'Write an announcement';
  // The ambiguous words (treat, patient, …), named at preview for the writer
  // to confirm; the route refuses the publication without that confirmation.
  const warnings = announcementWarnings(draft);
  const waitsForFirstDay = correcting !== null && !correctionTakesOverNow(draft, today);

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="announcement-drawer-title">{title}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        {step === 'write' ? (
          <form className="announcements__form" onSubmit={preview} noValidate>
            <p className="small muted">
              Practice news for every adult household, on the portal&rsquo;s home: a closure, a new
              service, a new practitioner. Written in both languages. Never a medical claim.
            </p>
            {correcting ? (
              <Note tone="attention">
                The announcement you are correcting is replaced by this one: at once, or on this
                one&rsquo;s first day if you give a later one, and until then households keep seeing
                the old one. A published announcement is never changed in place.
              </Note>
            ) : null}
            <Field
              id="announcement-title-en"
              label="English title"
              type="text"
              value={words.titleEn}
              error={errorFor('titleEn')}
              hint={`At most ${ANNOUNCEMENT_TITLE_MAX} characters.`}
              onChange={(event) => take('titleEn')(event.currentTarget.value)}
            />
            <div className="field">
              <label htmlFor="announcement-body-en" className="field__label">
                English text
              </label>
              <textarea
                id="announcement-body-en"
                className="field__input announcements__textarea"
                rows={5}
                value={words.bodyEn}
                aria-invalid={errorFor('bodyEn') ? true : undefined}
                aria-describedby="announcement-body-en-message"
                onChange={(event) => take('bodyEn')(event.currentTarget.value)}
              />
              <div
                id="announcement-body-en-message"
                role={errorFor('bodyEn') ? 'alert' : undefined}
                className={[
                  'field__hint',
                  'small',
                  errorFor('bodyEn') ? 'field__hint--error' : 'muted',
                ].join(' ')}
              >
                {errorFor('bodyEn') ??
                  `At most ${ANNOUNCEMENT_BODY_MAX} characters, one paragraph.`}
              </div>
            </div>
            <ArabicTextField
              id="announcement-title-ar"
              label="Arabic title"
              value={words.titleAr}
              error={errorFor('titleAr')}
              hint={`The same title, in Arabic. At most ${ANNOUNCEMENT_TITLE_MAX} characters.`}
              onChange={take('titleAr')}
            />
            <ArabicTextField
              id="announcement-body-ar"
              label="Arabic text"
              multiline
              value={words.bodyAr}
              error={errorFor('bodyAr')}
              hint={`The same text, in Arabic. At most ${ANNOUNCEMENT_BODY_MAX} characters.`}
              onChange={take('bodyAr')}
            />
            <DateField
              id="announcement-from"
              label="First day shown (optional)"
              value={visibleFrom}
              hint="Empty: from the day it is published."
              onChange={setVisibleFrom}
            />
            <DateField
              id="announcement-until"
              label="Last day shown (optional)"
              value={visibleUntil}
              error={errorFor('visibleUntil')}
              hint="Empty: until it is withdrawn."
              onChange={setVisibleUntil}
            />
            <div className="announcements__actions">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Preview
              </Button>
            </div>
          </form>
        ) : (
          <div className="announcements__form">
            <section className="announcements__previews" aria-label="Preview">
              <p className="small muted">As a household reading English will see it:</p>
              <article className="announcements__preview">
                <h4>{draft.title.en}</h4>
                <p>{draft.body.en}</p>
              </article>
              <p className="small muted">As a household reading Arabic will see it:</p>
              <ArabicPreview title={draft.title.ar} body={draft.body.ar} />
            </section>
            {waitsForFirstDay ? (
              <Note>
                Households keep seeing the announcement you are correcting until {draft.visibleFrom}
                , and this one from that day.
              </Note>
            ) : null}
            {warnings.length > 0 ? (
              <div className="announcements__previews">
                <Note tone="attention">{warningSentence(warnings)}</Note>
                <label className="announcements__confirm" htmlFor="announcement-confirm">
                  <input
                    id="announcement-confirm"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.currentTarget.checked)}
                  />
                  <span>I have checked: this is not a medical claim.</span>
                </label>
              </div>
            ) : null}
            <Field
              id="announcement-reason"
              label="Reason"
              type="text"
              maxLength={200}
              value={reason}
              hint="Recorded with the announcement on the practice's trail."
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            {formError ? <Note tone="critical">{formError}</Note> : null}
            <div className="announcements__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('write')}
                disabled={busy}
              >
                Back to editing
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={busy || reason.trim() === '' || (warnings.length > 0 && !confirmed)}
                onClick={() => void publish()}
              >
                {busy ? 'Publishing…' : correcting ? 'Publish the correction' : 'Publish'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Withdrawing a standing announcement, with a reason. */
export function WithdrawAnnouncementDrawer({
  announcement,
  onClose,
  onDone,
}: {
  announcement: OfficeAnnouncement;
  onClose: () => void;
  onDone: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/portal/announcements/${announcement.id}/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: '{}',
      });
      if (res.ok) {
        onDone();
        return;
      }
      if (res.status === 403) {
        setFormError('Announcements are the owner’s and an admin’s to withdraw.');
        return;
      }
      const answer = (await res.json().catch(() => null)) as { error?: string } | null;
      setFormError(
        answer?.error === 'already_withdrawn'
          ? 'It has already been withdrawn.'
          : 'It could not be withdrawn. Try again.',
      );
    } catch {
      setFormError('It could not be withdrawn. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-withdraw-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="announcement-withdraw-title">Withdraw an announcement</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <form className="announcements__form" onSubmit={(event) => void send(event)}>
          <p>
            &ldquo;{announcement.title.en}&rdquo; leaves every household&rsquo;s home at once. It
            stays on this list as withdrawn.
          </p>
          <Field
            id="announcement-withdraw-reason"
            label="Reason"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="announcements__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || reason.trim() === ''}>
              {busy ? 'Withdrawing…' : 'Withdraw the announcement'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
