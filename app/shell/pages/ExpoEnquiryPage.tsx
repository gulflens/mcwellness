import { useState, type FormEvent } from 'react';
import {
  ENQUIRING_FOR,
  INTERESTS,
  type EnquiringFor,
  type Interest,
  type MissingField,
} from '@domain/enquiry';
import { IncompleteResponse } from '../../api/enquiries/schema';
import { Button, Field, Note, Select } from '../components/Controls';
import { PhoneField } from '../components/PhoneField';
import './expo.css';

/**
 * `/expo`: the form on the practice's stand (trunk round 50, 2026-09-16). A
 * visitor scans the code on the stand, this page opens on their own phone,
 * and what they send lands with the website's enquiries at
 * `POST /api/enquiries`, source `expo`, for the office to follow up after
 * the expo (docs/superpowers/specs/2026-09-09-enquiries-design.md, amended).
 *
 * Reachable signed out, like the sign-in page and the portal's invitation:
 * there is no account on the other end. It posts with a plain `fetch` and
 * never `apiFetch`, which would attach a token if a member of staff happened
 * to be signed in on the stand's tablet and sign them out on a refusal.
 *
 * The tick is the same sentence the website's forms carry, and it is not a
 * consent: it records only that the box was ticked. The practice's consents
 * are recorded on the client, from the wording filed as documents, once the
 * enquiry becomes a lead.
 *
 * English only, by the owner's decision of 16 September 2026.
 */

const PRIVACY_URL = 'https://mcwellnessuae.com/privacy.html';

const ENQUIRING_FOR_LABELS: Record<EnquiringFor, string> = {
  self: 'Myself',
  child: 'My child',
  family_member: 'Another family member',
  someone_else: 'Someone else',
};

const INTEREST_LABELS: Record<Interest, string> = {
  brain_map: 'A brain map',
  neurofeedback: 'Neurofeedback',
  both: 'Both',
};

/** What each missing field says beside itself: a form error, in the form's words. */
const MISSING_SENTENCES: Record<MissingField, string> = {
  name: 'Please tell us your name.',
  phone: 'Please give a number we can reach you on.',
  enquiring_for: 'Please choose one.',
  interest: 'Please choose one.',
};

const CHECK_FIELDS = 'Please check the fields marked.';
const NOT_SENT = 'That did not go through. Please try again, or ask us at the stand.';

type Sent = 'idle' | 'sending' | 'sent' | 'failed';

export function ExpoEnquiryPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [area, setArea] = useState('');
  const [enquiringFor, setEnquiringFor] = useState<EnquiringFor | ''>('');
  const [interest, setInterest] = useState<Interest | ''>('');
  const [message, setMessage] = useState('');
  const [agreed, setAgreed] = useState(false);
  // The trap: a person never sees it, a script that fills every input fills it.
  const [trap, setTrap] = useState('');
  const [missing, setMissing] = useState<readonly MissingField[]>([]);
  const [state, setState] = useState<Sent>('idle');

  const error = (field: MissingField): string | undefined =>
    missing.includes(field) ? MISSING_SENTENCES[field] : undefined;

  function reset(): void {
    setName('');
    setPhone('');
    setEmail('');
    setArea('');
    setEnquiringFor('');
    setInterest('');
    setMessage('');
    setAgreed(false);
    setTrap('');
    setMissing([]);
    setState('idle');
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    // The same four the door insists on, checked here first so a phone on a
    // busy stand is not made to wait for a refusal it could have seen.
    const local: MissingField[] = [];
    if (name.trim() === '') local.push('name');
    if (phone === '') local.push('phone');
    if (enquiringFor === '') local.push('enquiring_for');
    if (interest === '') local.push('interest');
    if (local.length > 0) {
      setMissing(local);
      return;
    }
    setMissing([]);
    setState('sending');
    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'expo',
          name: name.trim(),
          phone,
          email: email.trim(),
          area: area.trim(),
          enquiring_for: enquiringFor,
          interest,
          message: message.trim(),
          consent: agreed ? 'on' : '',
          website: trap,
        }),
      });
      if (res.ok) {
        setState('sent');
        return;
      }
      if (res.status === 400) {
        const body = IncompleteResponse.safeParse(await res.json().catch(() => null));
        setMissing(body.success ? body.data.missing : ['name', 'phone']);
        setState('idle');
        return;
      }
      setState('failed');
    } catch {
      setState('failed');
    }
  }

  if (state === 'sent') {
    return (
      <main className="plain expo">
        <h1>Thank you</h1>
        <p>We have your details and will be in touch after the expo.</p>
        <Button variant="quiet" onClick={reset}>
          Send another
        </Button>
      </main>
    );
  }

  return (
    <main className="plain expo">
      <h1>Good to meet you</h1>
      <p>Leave your details and we will be in touch after the expo.</p>
      <form className="expo__form" noValidate onSubmit={(e) => void submit(e)}>
        <Field
          id="expo-name"
          label="Your name"
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error('name')}
        />
        <PhoneField
          id="expo-phone"
          label="WhatsApp number"
          value={phone}
          onChange={setPhone}
          hint="We reply by WhatsApp or call."
          error={error('phone')}
        />
        <Field
          id="expo-email"
          label="Email (optional)"
          type="email"
          autoComplete="email"
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="expo-area"
          label="Where you live (optional)"
          hint="The area, so we can say whether a home visit reaches you."
          maxLength={120}
          value={area}
          onChange={(e) => setArea(e.target.value)}
        />
        <Select
          id="expo-for"
          label="Who are you asking for?"
          value={enquiringFor}
          onChange={(e) => setEnquiringFor(e.target.value as EnquiringFor | '')}
          error={error('enquiring_for')}
        >
          <option value="">Choose one</option>
          {ENQUIRING_FOR.map((who) => (
            <option key={who} value={who}>
              {ENQUIRING_FOR_LABELS[who]}
            </option>
          ))}
        </Select>
        <Select
          id="expo-interest"
          label="What are you interested in?"
          value={interest}
          onChange={(e) => setInterest(e.target.value as Interest | '')}
          error={error('interest')}
        >
          <option value="">Choose one</option>
          {INTERESTS.map((what) => (
            <option key={what} value={what}>
              {INTEREST_LABELS[what]}
            </option>
          ))}
        </Select>
        <div className="field">
          <label htmlFor="expo-message" className="field__label">
            What would you like to know? (optional)
          </label>
          <textarea
            id="expo-message"
            className="field__input expo__message"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div className="expo__trap" aria-hidden="true">
          <label htmlFor="expo-website">Website</label>
          <input
            id="expo-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
        </div>
        <label htmlFor="expo-agree" className="checkbox">
          <input
            id="expo-agree"
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>By submitting, you agree to be contacted by McWellness about your enquiry.</span>
        </label>
        <p className="small muted">
          We use your details to get back to you about this enquiry. If you go on to work with us
          they become part of your record; if not, once we have replied the enquiry keeps nothing
          personal. How we look after your information is set out in our{' '}
          <a className="link" href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            privacy policy
          </a>
          .
        </p>
        {missing.length > 0 ? <Note tone="critical">{CHECK_FIELDS}</Note> : null}
        {state === 'failed' ? <Note tone="critical">{NOT_SENT}</Note> : null}
        <Button type="submit" variant="primary" disabled={!agreed || state === 'sending'}>
          Send
        </Button>
      </form>
    </main>
  );
}
