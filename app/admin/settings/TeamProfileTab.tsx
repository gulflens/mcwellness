import { useState, type FormEvent } from 'react';
import { displayFromIso } from '@domain/shared';
import { ProfileBody, type TeamProfile } from '../../api/team/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { PhoneField } from '../../shell/components/PhoneField';

/**
 * The Profile tab of a colleague's drawer: what the practice holds about one
 * member of staff (design section 6). Name, address and telephone live on
 * `app_user`; the job title, the start date, the emergency contact and the
 * owners' own notes live in `staff_profile`, which admits an owner and nobody
 * else. One Save writes both.
 *
 * **The whole form travels every time.** `ProfileBody` has no optional field: a
 * box left empty is a field cleared, so there is no half-written state for
 * anybody to reason about later. That is also why the same parser this screen
 * sends through is the one the route parses on arrival — the boxes are checked
 * against the API's own contract rather than against a second copy of it that
 * could drift.
 *
 * **Read-only when it is not the reader's to change.** An owner's row is that
 * owner's own (`canEditProfile`), so another owner reads it as text rather than
 * meeting a form whose Save would answer 409. The pattern is the client
 * record's own (`app/admin/clients/OverviewTab.tsx`): facts as a list, no
 * disabled boxes, because a disabled box cannot be focused and so cannot be
 * read out.
 */

/** A box that will not pass `ProfileBody`, said in the words of the box it belongs to. */
const FIELD_MESSAGES: Record<string, string> = {
  displayName: 'A person needs a name.',
  email: 'An email address is name@example.com.',
  phone: 'A telephone number needs its country and the rest of the number.',
  jobTitle: 'A job title is 120 characters at most.',
  startedOn: 'That day is not on the calendar.',
  emergencyContactName: 'A name is 120 characters at most.',
  emergencyContactPhone: 'A telephone number needs its country and the rest of the number.',
  privateNotes: 'Notes are 4000 characters at most.',
};

const IN_USE = 'That email address already has a sign-in.';
const LOCKED_MESSAGE = 'An owner’s own details are that owner’s alone to change.';
const UNAVAILABLE_MESSAGE =
  'Sign-ins are unavailable just now, so the address could not be moved. Nothing was saved; try again in a moment.';
const CHECK_MESSAGE = 'Check the details above, then try again.';
const GENERIC_MESSAGE = 'The profile could not be saved. Try again.';

export const NOTES_HINT =
  'Contract terms and reminders. Nothing about health. The person may ask to see what is written here.';

const FIELD_IDS = {
  displayName: 'team-profile-name',
  email: 'team-profile-email',
  phone: 'team-profile-phone',
  preferredLocale: 'team-profile-language',
  jobTitle: 'team-profile-job-title',
  startedOn: 'team-profile-started-on',
  emergencyContactName: 'team-profile-emergency-name',
  emergencyContactPhone: 'team-profile-emergency-phone',
  privateNotes: 'team-profile-notes',
} as const;

type FieldKey = keyof typeof FIELD_IDS;
type FieldErrors = Partial<Record<FieldKey, string>>;

/** Moves focus to the first box that is wrong, so a refusal is heard as well as seen. */
function focusFirstInvalid(errors: FieldErrors): void {
  for (const key of Object.keys(FIELD_IDS) as FieldKey[]) {
    if (errors[key] !== undefined) {
      document.getElementById(FIELD_IDS[key])?.focus();
      return;
    }
  }
}

/**
 * Whether a box is showing text that resolved to nothing.
 *
 * `PhoneField` and `DateField` both hand back `''` for what they cannot yet
 * make sense of — a half-typed number, `31/02/2026` — which is the same value
 * they hand back for an empty box. Left unasked, a typo would save as "there is
 * none" and the person would watch their own typing disappear on the next read
 * (the shape of finding 6 of 2026-09-12, which `PracticeDrawer` answers the
 * same way). The box itself is what says which of the two happened.
 */
function boxHasText(id: string): boolean {
  const box = document.getElementById(id);
  return box instanceof HTMLInputElement && box.value.trim().length > 0;
}

function fact(value: string | null): string {
  return value === null || value.trim() === '' ? 'Not recorded' : value;
}

/**
 * What the boxes hold, as text — every one of them a string, because that is
 * what a box holds; `''` is an empty box, and the save turns it into the null
 * the wire wants.
 *
 * It lives in the drawer rather than in this component, so that switching to
 * Access to check a role and coming back does not silently throw away what
 * somebody has typed: a `TabPanel` unmounts the tab it is not showing, and
 * state inside an unmounted component is gone (found reading this diff back,
 * 2026-09-21).
 */
export type ProfileDraft = {
  displayName: string;
  email: string;
  phone: string;
  preferredLocale: 'en' | 'ar';
  jobTitle: string;
  startedOn: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  privateNotes: string;
};

/** The draft a profile opens on: what is recorded, with nothing standing in for null. */
export function draftFrom(profile: TeamProfile): ProfileDraft {
  return {
    displayName: profile.displayName,
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    preferredLocale: profile.preferredLocale,
    jobTitle: profile.jobTitle ?? '',
    startedOn: profile.startedOn ?? '',
    emergencyContactName: profile.emergencyContactName ?? '',
    emergencyContactPhone: profile.emergencyContactPhone ?? '',
    privateNotes: profile.privateNotes ?? '',
  };
}

export function TeamProfileTab({
  profile,
  draft,
  onDraft,
  onSaved,
}: {
  profile: TeamProfile;
  draft: ProfileDraft;
  onDraft: (draft: ProfileDraft) => void;
  /** Saved: read the profile back and tell the list its row has changed. */
  onSaved: () => void;
}) {
  const { apiFetch } = useAuth();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const {
    displayName,
    email,
    phone,
    preferredLocale,
    jobTitle,
    startedOn,
    emergencyContactName: emergencyName,
    emergencyContactPhone: emergencyPhone,
    privateNotes,
  } = draft;

  /**
   * One box changed: the draft moves, and whatever that box was told is
   * cleared. Generic in the key so the value has to be the type that key holds
   * — the language is `'en' | 'ar'` and not any string anybody passes.
   */
  function take<K extends FieldKey>(key: K, value: ProfileDraft[K]) {
    onDraft({ ...draft, [key]: value });
    setFieldErrors((held) => (held[key] === undefined ? held : { ...held, [key]: undefined }));
    setFormError(null);
    setSaved(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const parsed = ProfileBody.safeParse({
      displayName,
      email,
      // Empty is nothing recorded; the schema's own pattern refuses anything else.
      phone: phone === '' ? null : phone,
      preferredLocale,
      jobTitle,
      startedOn: startedOn === '' ? null : startedOn,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone === '' ? null : emergencyPhone,
      privateNotes,
    });
    const errors: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && key in FIELD_MESSAGES && key in FIELD_IDS) {
          errors[key as FieldKey] = FIELD_MESSAGES[key];
        }
      }
    }
    if (phone === '' && boxHasText(FIELD_IDS.phone)) {
      errors.phone = FIELD_MESSAGES.phone;
    }
    if (emergencyPhone === '' && boxHasText(FIELD_IDS.emergencyContactPhone)) {
      errors.emergencyContactPhone = FIELD_MESSAGES.emergencyContactPhone;
    }
    if (startedOn === '' && boxHasText(FIELD_IDS.startedOn)) {
      errors.startedOn = FIELD_MESSAGES.startedOn;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !parsed.success) {
      focusFirstInvalid(errors);
      if (Object.keys(errors).length === 0) setFormError(CHECK_MESSAGE);
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch(`/api/team/${profile.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      // Said once, beside the box it is about, rather than in two places at
      // once: the field's own message is already announced as an alert.
      if (res.status === 409 && body?.error === 'email_in_use') {
        setFieldErrors({ email: IN_USE });
        document.getElementById(FIELD_IDS.email)?.focus();
        return;
      }
      if (res.status === 409) {
        setFormError(LOCKED_MESSAGE);
        return;
      }
      if (res.status === 503) {
        setFormError(UNAVAILABLE_MESSAGE);
        return;
      }
      setFormError(res.status === 400 ? CHECK_MESSAGE : GENERIC_MESSAGE);
    } catch {
      setFormError(GENERIC_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (!profile.editable) {
    return (
      <div className="team-profile">
        <Note>{LOCKED_MESSAGE}</Note>
        <dl className="team-facts">
          <div className="team-facts__row">
            <dt>Name</dt>
            <dd>{profile.displayName}</dd>
          </div>
          <div className="team-facts__row">
            <dt>Email address</dt>
            <dd>{fact(profile.email)}</dd>
          </div>
          <div className="team-facts__row">
            <dt>Telephone</dt>
            <dd className="numeric">{fact(profile.phone)}</dd>
          </div>
          <div className="team-facts__row">
            <dt>Language</dt>
            <dd>{profile.preferredLocale === 'ar' ? 'Arabic' : 'English'}</dd>
          </div>
          <div className="team-facts__row">
            <dt>Job title</dt>
            <dd>{fact(profile.jobTitle)}</dd>
          </div>
          <div className="team-facts__row">
            <dt>Start date</dt>
            <dd className="numeric">
              {profile.startedOn === null ? 'Not recorded' : displayFromIso(profile.startedOn)}
            </dd>
          </div>
          <div className="team-facts__row">
            <dt>Emergency contact</dt>
            <dd>
              {fact(profile.emergencyContactName)}
              {profile.emergencyContactPhone === null ? null : (
                <span className="numeric"> {profile.emergencyContactPhone}</span>
              )}
            </dd>
          </div>
          <div className="team-facts__row">
            <dt>Private notes</dt>
            <dd>{fact(profile.privateNotes)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <>
      {/*
        Always in the document, never mounted on demand: a live region has to
        exist before the text lands in it or a screen reader announces nothing
        (the precedent PracticePage sets). Outside the form's own flex column,
        so an empty region takes no gap with it.
      */}
      <div role="status" className="team-profile__status">
        {saved ? <Note>Saved.</Note> : null}
      </div>
      <form className="drawer__form" onSubmit={(e) => void submit(e)}>
        <h3 className="team-profile__heading">Who they are</h3>
        <Field
          id={FIELD_IDS.displayName}
          label="Name"
          value={displayName}
          maxLength={120}
          onChange={(e) => take('displayName', e.target.value)}
          error={fieldErrors.displayName}
        />
        <Field
          id={FIELD_IDS.email}
          label="Email address"
          hint="This is how they sign in. Changing it changes the sign-in too."
          type="text"
          inputMode="email"
          value={email}
          maxLength={200}
          onChange={(e) => take('email', e.target.value)}
          error={fieldErrors.email}
        />
        <PhoneField
          id={FIELD_IDS.phone}
          label="Telephone"
          value={phone}
          onChange={(next) => take('phone', next)}
          error={fieldErrors.phone}
        />
        <Select
          id={FIELD_IDS.preferredLocale}
          label="Language"
          hint="Which language this person’s own screens and messages use. The console itself is English."
          value={preferredLocale}
          onChange={(e) => take('preferredLocale', e.currentTarget.value === 'ar' ? 'ar' : 'en')}
        >
          <option value="en">English</option>
          <option value="ar">Arabic</option>
        </Select>

        <h3 className="team-profile__heading">At the practice</h3>
        <Field
          id={FIELD_IDS.jobTitle}
          label="Job title"
          value={jobTitle}
          maxLength={120}
          onChange={(e) => take('jobTitle', e.target.value)}
          error={fieldErrors.jobTitle}
        />
        <DateField
          id={FIELD_IDS.startedOn}
          label="Start date"
          value={startedOn}
          onChange={(next) => take('startedOn', next)}
          error={fieldErrors.startedOn}
        />

        <h3 className="team-profile__heading">If something happens</h3>
        <p className="small muted">
          Somebody to call while this person is working alone in a household&rsquo;s home. Tell them
          it is recorded, and clear both boxes to remove it.
        </p>
        <Field
          id={FIELD_IDS.emergencyContactName}
          label="Emergency contact"
          value={emergencyName}
          maxLength={120}
          onChange={(e) => take('emergencyContactName', e.target.value)}
          error={fieldErrors.emergencyContactName}
        />
        <PhoneField
          id={FIELD_IDS.emergencyContactPhone}
          label="Emergency contact number"
          value={emergencyPhone}
          onChange={(next) => take('emergencyContactPhone', next)}
          error={fieldErrors.emergencyContactPhone}
        />

        <div className="field">
          <label htmlFor={FIELD_IDS.privateNotes} className="field__label">
            Private notes
          </label>
          <textarea
            id={FIELD_IDS.privateNotes}
            className="field__input team-profile__notes"
            aria-invalid={fieldErrors.privateNotes ? true : undefined}
            aria-describedby={`${FIELD_IDS.privateNotes}-message`}
            maxLength={4000}
            value={privateNotes}
            onChange={(e) => take('privateNotes', e.target.value)}
          />
          <div
            id={`${FIELD_IDS.privateNotes}-message`}
            role={fieldErrors.privateNotes ? 'alert' : undefined}
            className={[
              'field__hint',
              'small',
              fieldErrors.privateNotes ? 'field__hint--error' : 'muted',
            ].join(' ')}
          >
            {fieldErrors.privateNotes ?? NOTES_HINT}
          </div>
        </div>

        {formError ? <Note tone="critical">{formError}</Note> : null}

        <div className="drawer__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save the profile'}
          </Button>
        </div>
      </form>
    </>
  );
}
