import { useCallback, useState, type FormEvent } from 'react';
import { FamilyResponse, type Person } from '../api/portal/schema';
import { useAuth } from '../shell/auth/AuthContext';
import { Field, Note } from '../shell/components/Controls';
import { Sections } from './Layout';
import { useWords } from './i18n';
import { usePortalRead } from './usePortal';

/**
 * `/portal/family` — who is on the record, and where the practitioner drives
 * (docs/SPEC/client-portal.md section 3.4).
 *
 * **The address is read-only, and the screen says why.** The day sheet reads it
 * live, so an edit moves where somebody drives, and a move may change the zone,
 * which is the practice's call. What the household sees of it is the line and
 * the emirate; the coordinate, the parking point, the gate, the arrival notes
 * and the Makani number never leave the practice at all — the route does not
 * select them.
 *
 * **One form, on the signed-in person's own row.** Telephone, email, WhatsApp
 * preference. The route asks `contact.write_own`, row security refuses a row
 * that is not theirs, and `app.guard_contact_self_service` refuses every column
 * but the three. The screen is the courtesy in front of all that.
 */

/** What each person on the record may do, in words rather than three ticks. */
function permissions(person: Person, words: ReturnType<typeof useWords>): string {
  const parts = [
    person.canConsent ? words.t('canConsent') : null,
    person.canReceiveReports ? words.t('canReceiveReports') : null,
    person.canPay ? words.t('canPay') : null,
  ].filter((part): part is string => part !== null);
  return parts.join(words.locale === 'ar' ? '، ' : ', ');
}

function YourDetails({ person, onSaved }: { person: Person; onSaved: () => void }) {
  const words = useWords();
  const { apiFetch } = useAuth();
  const [phone, setPhone] = useState(person.phone ?? '');
  const [email, setEmail] = useState(person.email ?? '');
  const [whatsapp, setWhatsapp] = useState(person.whatsappOptIn);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [fieldError, setFieldError] = useState<'phone' | 'email' | null>(null);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      setState('saving');
      setFieldError(null);
      void apiFetch(`/api/portal/contacts/${person.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim().length === 0 ? null : phone,
          email: email.trim().length === 0 ? null : email,
          whatsappOptIn: whatsapp,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            setState('saved');
            onSaved();
            return;
          }
          if (res.status === 400) {
            const body = (await res.json().catch(() => ({}))) as { code?: string };
            setFieldError(body.code === 'email' ? 'email' : 'phone');
            setState('idle');
            return;
          }
          setState('failed');
        })
        .catch(() => setState('failed'));
    },
    [apiFetch, person.id, phone, email, whatsapp, onSaved],
  );

  return (
    <form className="portal__form" onSubmit={submit}>
      <h4>{words.t('yourDetails')}</h4>
      <Field
        id={`portal-phone-${person.id}`}
        label={words.t('telephone')}
        type="tel"
        inputMode="tel"
        maxLength={40}
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setFieldError(null);
          setState('idle');
        }}
        error={fieldError === 'phone' ? words.t('badPhone') : undefined}
      />
      <Field
        id={`portal-email-${person.id}`}
        label={words.t('email')}
        type="email"
        maxLength={320}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setFieldError(null);
          setState('idle');
        }}
        error={fieldError === 'email' ? words.t('badEmail') : undefined}
      />
      <label className="portal__check" htmlFor={`portal-whatsapp-${person.id}`}>
        <input
          id={`portal-whatsapp-${person.id}`}
          type="checkbox"
          checked={whatsapp}
          onChange={(e) => {
            setWhatsapp(e.target.checked);
            setState('idle');
          }}
        />
        <span>{words.t('whatsappOptIn')}</span>
      </label>
      <div className="portal__actions">
        <button type="submit" className="button button--primary" disabled={state === 'saving'}>
          {words.t('save')}
        </button>
      </div>
      <div role="status">
        {state === 'saving' ? <Note>{words.t('saving')}</Note> : null}
        {state === 'saved' ? <Note>{words.t('saved')}</Note> : null}
        {state === 'failed' ? <Note tone="critical">{words.t('saveFailed')}</Note> : null}
      </div>
    </form>
  );
}

export function FamilyScreen() {
  const words = useWords();
  const family = usePortalRead('/api/portal/family', FamilyResponse);

  if (family.kind === 'loading') return <Note>{words.t('loading')}</Note>;
  if (family.kind === 'refused') return <Note tone="critical">{words.t('notYours')}</Note>;
  if (family.kind === 'error') return <Note tone="critical">{words.t('loadFailed')}</Note>;

  const { clients, people } = family.data;

  return (
    <>
      <section className="portal__section">
        <h1>{words.t('family')}</h1>
        <Sections
          clients={clients}
          render={(client) => {
            const address = clients.find((row) => row.id === client.id)?.address ?? null;
            const onRecord = people.filter((person) => person.clientId === client.id);
            return (
              <>
                <dl className="portal__facts">
                  <dt>{words.t('addressLabel')}</dt>
                  <dd>
                    {address === null || address.displayAddress === null ? (
                      <span className="muted">{words.t('noAddress')}</span>
                    ) : (
                      address.displayAddress
                    )}
                  </dd>
                </dl>
                <p className="small muted">{words.t('addressReadOnly')}</p>

                <h4>{words.t('peopleOnRecord')}</h4>
                <div className="portal__list">
                  {onRecord.map((person) => (
                    <div key={person.id} className="portal__row">
                      <span>
                        {words.locale === 'ar' && person.nameAr ? person.nameAr : person.name}
                      </span>
                      {/* Spacing marks the person's own row, never an
                          em-dash-spaced label (docs/DESIGN-BRIEF.md 4.5). */}
                      {person.isYou ? (
                        <span className="small muted">{words.t('thisIsYou')}</span>
                      ) : null}
                      <span className="small">{words.relationship(person.relationship)}</span>
                      <span className="small muted">{permissions(person, words)}</span>
                      {/* Spacing separates them, never a middle dot
                          (docs/DESIGN-BRIEF.md section 4.5). */}
                      <span className="portal__row-note small">
                        <span className="numeric">{person.phone ?? words.t('notRecorded')}</span>
                      </span>
                      {person.email ? (
                        <span className="portal__row-note small">{person.email}</span>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/*
                  The key carries what the row says, so a reload after a save
                  mounts the form afresh on the values that came back rather
                  than copying them into state from an effect: three fields
                  that follow the row, and no second source of truth for them.
                */}
                {onRecord
                  .filter((person) => person.isYou)
                  .map((person) => (
                    <YourDetails
                      key={`${person.id}:${person.phone ?? ''}:${person.email ?? ''}:${String(person.whatsappOptIn)}`}
                      person={person}
                      onSaved={family.reload}
                    />
                  ))}
              </>
            );
          }}
        />
      </section>
    </>
  );
}
