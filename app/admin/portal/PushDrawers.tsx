import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  OFFER_STOP_LINE,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  checkPushMessage,
  pushWarnings,
  type PushField,
  type PushKind,
  type PushProblem,
  type PushReach,
  type PushWarning,
} from '../../../domain/portal';
import { OfficePushRecordResponse } from '../../api/portal/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { Table } from '../../shell/components/Table';
import { useDrawer } from '../../shell/components/useDrawer';
import { ArabicPreview, ArabicTextField } from './AnnouncementArabic';

/**
 * The Send screen's two drawers (Settings › Notifications; the push memo's
 * decision 3).
 *
 * **Writing and sending one.** Two steps, as an announcement's: **Write** —
 * the kind, and the title and text in English and Arabic; **Preview** — both
 * languages as a phone will show them (an offer with its stop line), how many
 * people and devices it will reach today, the ambiguous words to confirm, a
 * reason, and Send. Nothing is written until Send, and Send goes once: the
 * drawer chose the message's id when it opened, so a second press, or a
 * retry after a lost answer, is refused as already sent rather than sent
 * twice.
 *
 * **The record of one.** Who it went to, how many of their devices, and each
 * person's marketing consent standing at that moment with the wording
 * version it stood on — what the practice would show a regulator, or a
 * household.
 */

const FIELD_NAME: Record<PushField, string> = {
  titleEn: 'The English title',
  titleAr: 'The Arabic title',
  bodyEn: 'The English text',
  bodyAr: 'The Arabic text',
};

function sentenceFor(problem: PushProblem): string {
  const name = FIELD_NAME[problem.field];
  switch (problem.code) {
    case 'empty':
      return `${name} is empty. A notification is written in both languages.`;
    case 'too_long':
      return `${name} is longer than ${
        problem.field === 'titleEn' || problem.field === 'titleAr' ? PUSH_TITLE_MAX : PUSH_BODY_MAX
      } characters. A phone shows a short notification; shorten it, nothing is cut.`;
    case 'medical_word':
      return `${name} uses a word of another kind of practice. McWellness is a wellness practice: say sessions, goals and measurements.`;
  }
}

function warningSentence(warnings: readonly PushWarning[]): string {
  const named = warnings
    .map((warning) => `“${warning.term}”, in ${FIELD_NAME[warning.field].replace(/^The /, 'the ')}`)
    .join('; ');
  const verb = warnings.length === 1 ? 'This word can' : 'These words can';
  return `${named}. ${verb} read as a medical claim. Check the sense before you send.`;
}

function reach(value: PushReach): string {
  const people = `${value.people} ${value.people === 1 ? 'person' : 'people'}`;
  const devices = `${value.devices} ${value.devices === 1 ? 'device' : 'devices'}`;
  return `${people} on ${devices}`;
}

const GENERIC = 'It could not be sent. Try again.';
const REFUSALS: Record<string, string> = {
  offer_ceiling: 'Two offers have already gone this calendar month. The next can go on the first.',
  no_recipients: 'Nobody would receive it today, so nothing was sent.',
  already_sent: 'This notification has already been sent. Close the drawer to see it below.',
  push_not_configured: 'Push is not configured on this deployment, so nothing can be sent.',
  reason_required: 'Say why, in a sentence.',
  confirm_wording: 'Confirm the words named above before you send.',
};

type Words = { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string };

export function SendPushDrawer({
  audience,
  offersLeft,
  onClose,
  onDone,
}: {
  audience: Record<PushKind, PushReach>;
  offersLeft: number;
  onClose: () => void;
  onDone: (sentence: string) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  // Chosen once, when the drawer opens: the message's own id, so it is sent once.
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<PushKind>('announcement');
  const [words, setWords] = useState<Words>({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });
  const [problems, setProblems] = useState<PushProblem[]>([]);
  const [step, setStep] = useState<'write' | 'preview'>('write');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = {
    kind,
    title: { en: words.titleEn.trim(), ar: words.titleAr.trim() },
    body: { en: words.bodyEn.trim(), ar: words.bodyAr.trim() },
  };
  const warnings = pushWarnings(draft);
  const reaches = audience[kind];

  const errorFor = (field: PushField): string | undefined => {
    const problem = problems.find((row) => row.field === field);
    return problem ? sentenceFor(problem) : undefined;
  };
  const take = (field: keyof Words) => (value: string) =>
    setWords((was) => ({ ...was, [field]: value }));

  function preview(event: FormEvent): void {
    event.preventDefault();
    const found = checkPushMessage(draft);
    setProblems(found);
    setFormError(null);
    setConfirmed(false);
    if (found.length === 0) setStep('preview');
  }

  async function send(): Promise<void> {
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch('/api/portal/push/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({ id, ...draft, confirmedWarnings: warnings.length > 0 && confirmed }),
      });
      if (res.ok) {
        onDone(
          kind === 'offer'
            ? 'Sent. The offer is on its way to the people whose consent is on.'
            : 'Sent. The announcement is on its way to every adult with notifications on.',
        );
        return;
      }
      if (res.status === 403) {
        setFormError('Notifications are the owner’s and an admin’s to send.');
        return;
      }
      const answer = (await res.json().catch(() => null)) as {
        error?: string;
        problems?: PushProblem[];
      } | null;
      if (answer?.error === 'wording' && Array.isArray(answer.problems)) {
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

  const offerBody = (text: string, stop: string) => (kind === 'offer' ? `${text}\n${stop}` : text);

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="push-drawer-title">Write a notification</h2>
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
            <fieldset className="push__kinds">
              <legend className="field__label">Kind</legend>
              <label className="push__kind" htmlFor="push-kind-announcement">
                <input
                  id="push-kind-announcement"
                  type="radio"
                  name="push-kind"
                  checked={kind === 'announcement'}
                  onChange={() => setKind('announcement')}
                />
                <span>
                  Announcement
                  <span className="small muted push__kind-note">
                    Practice news. To every adult with notifications on:{' '}
                    {reach(audience.announcement)} today.
                  </span>
                </span>
              </label>
              <label className="push__kind" htmlFor="push-kind-offer">
                <input
                  id="push-kind-offer"
                  type="radio"
                  name="push-kind"
                  checked={kind === 'offer'}
                  disabled={offersLeft === 0}
                  onChange={() => setKind('offer')}
                />
                <span>
                  Offer
                  <span className="small muted push__kind-note">
                    {offersLeft === 0
                      ? 'Two offers have already gone this calendar month.'
                      : `A discount, a package price, a season. Only to those whose marketing consent is on: ${reach(audience.offer)} today. ${offersLeft} left this month.`}
                  </span>
                </span>
              </label>
            </fieldset>
            <Field
              id="push-title-en"
              label="English title"
              type="text"
              value={words.titleEn}
              error={errorFor('titleEn')}
              hint={`At most ${PUSH_TITLE_MAX} characters.`}
              onChange={(event) => take('titleEn')(event.currentTarget.value)}
            />
            <div className="field">
              <label htmlFor="push-body-en" className="field__label">
                English text
              </label>
              <textarea
                id="push-body-en"
                className="field__input announcements__textarea"
                rows={4}
                value={words.bodyEn}
                aria-invalid={errorFor('bodyEn') ? true : undefined}
                aria-describedby="push-body-en-message"
                onChange={(event) => take('bodyEn')(event.currentTarget.value)}
              />
              <div
                id="push-body-en-message"
                role={errorFor('bodyEn') ? 'alert' : undefined}
                className={[
                  'field__hint',
                  'small',
                  errorFor('bodyEn') ? 'field__hint--error' : 'muted',
                ].join(' ')}
              >
                {errorFor('bodyEn') ?? `At most ${PUSH_BODY_MAX} characters.`}
              </div>
            </div>
            <ArabicTextField
              id="push-title-ar"
              label="Arabic title"
              value={words.titleAr}
              error={errorFor('titleAr')}
              hint={`The same title, in Arabic. At most ${PUSH_TITLE_MAX} characters.`}
              onChange={take('titleAr')}
            />
            <ArabicTextField
              id="push-body-ar"
              label="Arabic text"
              multiline
              value={words.bodyAr}
              error={errorFor('bodyAr')}
              hint={`The same text, in Arabic. At most ${PUSH_BODY_MAX} characters.`}
              onChange={take('bodyAr')}
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
              <p className="small muted">On a phone reading English:</p>
              <article className="announcements__preview">
                <h4>{draft.title.en}</h4>
                <p className="push__preview-body">{offerBody(draft.body.en, OFFER_STOP_LINE.en)}</p>
              </article>
              <p className="small muted">On a phone reading Arabic:</p>
              <ArabicPreview
                title={draft.title.ar}
                body={offerBody(draft.body.ar, OFFER_STOP_LINE.ar)}
              />
            </section>
            <Note>
              {kind === 'offer' ? 'This offer' : 'This announcement'} will reach {reach(reaches)}{' '}
              today.
              {kind === 'offer'
                ? ' Each one carries a stop that leads to the switch on their portal.'
                : ''}
            </Note>
            {warnings.length > 0 ? (
              <div className="announcements__previews">
                <Note tone="attention">{warningSentence(warnings)}</Note>
                <label className="announcements__confirm" htmlFor="push-confirm">
                  <input
                    id="push-confirm"
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.currentTarget.checked)}
                  />
                  <span>I have checked: this is not a medical claim.</span>
                </label>
              </div>
            ) : null}
            <Field
              id="push-reason"
              label="Reason"
              type="text"
              maxLength={200}
              value={reason}
              hint="Recorded with the notification on the practice's trail."
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
                disabled={
                  busy ||
                  reason.trim() === '' ||
                  reaches.people === 0 ||
                  (warnings.length > 0 && !confirmed)
                }
                onClick={() => void send()}
              >
                {busy ? 'Sending…' : 'Send once'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

type Recipient = OfficePushRecordResponse['recipients'][number] & { position: number };

/** The record of one message: who it went to, and each one's standing then. */
export function PushRecordDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);
  const [record, setRecord] = useState<OfficePushRecordResponse | 'loading' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/portal/push/messages/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('refused');
        const parsed = OfficePushRecordResponse.parse(await res.json());
        if (live) setRecord(parsed);
      })
      .catch(() => {
        if (live) setRecord('error');
      });
    return () => {
      live = false;
    };
  }, [apiFetch, id]);

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="push-record-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="push-record-title">
            {typeof record === 'object' ? record.message.title.en : 'A notification sent'}
          </h2>
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
        {record === 'loading' ? <Note>Loading the record.</Note> : null}
        {record === 'error' ? (
          <Note tone="critical">The record could not be loaded. Try again.</Note>
        ) : null}
        {typeof record === 'object' ? (
          <div className="announcements__form">
            <section className="announcements__previews" aria-label="What it said">
              <article className="announcements__preview">
                <h4>{record.message.title.en}</h4>
                <p>{record.message.body.en}</p>
              </article>
              <ArabicPreview title={record.message.title.ar} body={record.message.body.ar} />
            </section>
            <Table<Recipient>
              caption="Who it went to, and each one's marketing consent at that moment"
              columns={[
                { key: 'name', header: 'Person', render: (row) => row.name },
                {
                  key: 'devices',
                  header: 'Devices',
                  align: 'end',
                  render: (row) => <span className="numeric">{row.devices}</span>,
                },
                {
                  key: 'standing',
                  header: 'Marketing consent then',
                  render: (row) =>
                    row.standing === 'on'
                      ? `On, wording ${row.wordingVersion ?? 'unknown'}`
                      : 'Off',
                },
              ]}
              rows={record.recipients.map((row, position) => ({ ...row, position }))}
              rowKey={(row) => String(row.position)}
              empty={<Note>Nobody is recorded for this message.</Note>}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
