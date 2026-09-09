import { useCallback, useEffect, useMemo, useState } from 'react';
import { canGiveConsent, type ConsentPurpose } from '@domain/client';
import {
  ConsentWitnessListResponse,
  ConsentWordingResponse,
  MAX_DOCUMENT_BYTES,
  type ClientRecordResponse,
  type ConsentWitness,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { ConsentText } from './ConsentText';
import { SignaturePad, type SignatureResult } from './SignaturePad';
import { compressToFit, type UploadFile } from './fileUpload';
import { contactName, relationshipLabel } from './contactName';
import { practiceToday, practiceTodayInWords } from './activation';

/**
 * Recording one consent (docs/SPEC/client-record.md section 7).
 *
 * The order on screen is the order the conversation happens in: which consent,
 * who is giving it, the words themselves, and only then a signature. The pad
 * stays disabled until the wording has been scrolled to the end, because a
 * consent records that a person was shown a text and a text nobody reached the
 * bottom of was not shown.
 *
 * The draft line is not decoration. Every wording the practice holds today is
 * a draft awaiting its lawyer (docs/CONSENT/README.md), and the person signing
 * is told so — on screen here, and in the text's own first line.
 *
 * Two routes to the same rule. `app_signature` is the pad; `paper_scan` is a
 * photograph or a PDF of the form the person signed on paper. Whichever is
 * used, the evidence goes with the consent in one request, so a consent
 * without evidence cannot be recorded at all.
 */

const PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  participation: 'Participation',
  minor_participation: "Guardian's consent for a child",
  home_visit: 'Visits at home',
  health_data: 'Brain-map and neurofeedback information',
  photo_video: 'Photographs and video',
  research: 'Research',
  marketing: 'Marketing',
};

const REFUSALS: Record<string, string> = {
  wording_not_found: 'That wording is no longer on file. Reopen this form to load the current one.',
  wording_retired:
    'That version of the wording has been retired. Reopen this form for the current one.',
  wording_superseded:
    'The practice has published a newer version of this wording. Reopen this form to show it.',
  wording_wrong_purpose: 'That wording is for a different consent. Reopen this form.',
  wording_wrong_locale: "That wording is not in this client's own language. Reopen this form.",
  contact_may_not_consent:
    'This contact is not marked as able to give consent. Set “May give consent” on the Contacts tab first.',
  guardian_required:
    'A child’s consent has to come from a legal guardian. Mark the contact as a legal guardian, or choose one.',
  evidence_required: 'A consent needs the signature or the scanned form with it.',
  evidence_not_accepted: 'That evidence does not go with the method chosen.',
  no_consent_to_reconfirm:
    'A verbal confirmation re-confirms a home visit already agreed, and this client has agreed to none. Record the first one on screen or on paper.',
  witness_required: 'A verbal confirmation needs the second member of staff who heard it.',
  witness_not_accepted: 'Only a verbal confirmation carries a witness.',
  witness_is_actor: 'The witness is the second person in the room, not the one recording it.',
  witness_not_staff: 'That witness is not on this practice’s books.',
  bytes_do_not_match_type: 'That file is not the kind of file it says it is.',
  document_too_large: 'That file is too large to file here.',
  erased: 'This record has been erased and cannot be changed.',
};
const GENERIC_ERROR = 'This consent could not be recorded. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to record consent for this client.";
const STORAGE_ERROR =
  'The document store cannot be reached, so nothing was recorded. Try again shortly.';

type Method = 'app_signature' | 'paper_scan' | 'verbal_witnessed';

type WordingState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; wording: ConsentWordingResponse; markdown: string };

/** Loaded only when a verbal re-confirmation is chosen; nothing else needs it. */
type WitnessState =
  { kind: 'idle' } | { kind: 'error' } | { kind: 'ready'; witnesses: ConsentWitness[] };

export function RecordConsentForm({
  clientId,
  record,
  purpose,
  onSaved,
  onCancel,
}: {
  clientId: string;
  record: ClientRecordResponse;
  purpose: ConsentPurpose;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const today = practiceToday();
  // Only the contacts who may actually give *this* consent, judged by the
  // same rule the route judges by (`canGiveConsent` in domain/client): the
  // practice's own can_consent flag always, and a legal guardian besides when
  // the client is a minor or the purpose is a guardian's own. Listing the
  // others and letting the server refuse made the guardian rule something a
  // person discovered by being told no.
  const consenting = useMemo(
    () =>
      record.contacts.filter(
        (contact) =>
          canGiveConsent(
            { dateOfBirth: record.dateOfBirth },
            {
              id: contact.id,
              canConsent: contact.canConsent,
              isLegalGuardian: contact.isLegalGuardian,
            },
            purpose,
            today,
          ).ok,
      ),
    [record.contacts, record.dateOfBirth, purpose, today],
  );
  /** Someone may consent, but not to this: the sentence has to say which. */
  const guardianIsTheGap = record.contacts.some((contact) => contact.canConsent);
  const [givenByContactId, setGivenByContactId] = useState(consenting[0]?.id ?? '');
  const [method, setMethod] = useState<Method>('app_signature');
  const [wordingState, setWordingState] = useState<WordingState>({ kind: 'loading' });
  const [readToEnd, setReadToEnd] = useState(false);
  const [signature, setSignature] = useState<SignatureResult | null>(null);
  const [scan, setScan] = useState<UploadFile | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [witnessState, setWitnessState] = useState<WitnessState>({ kind: 'idle' });
  const [witnessId, setWitnessId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const giver = consenting.find((contact) => contact.id === givenByContactId) ?? null;
  // The typed name falls back to the contact's own where the record has one
  // (db/migrations/101_contact_name.sql), and holds whatever was typed the
  // moment anything is. Derived rather than copied into state by an effect:
  // an effect would have to decide when the copy is stale, and the answer —
  // "once the person has typed" — is exactly what `typedName` being non-null
  // already says.
  const [typedName, setTypedName] = useState<string | null>(null);
  const signedName = typedName ?? contactName(giver) ?? '';

  // `verbal_witnessed` is a home-visit **re-confirmation** and nothing else
  // (section 7: never initial participation). So it is offered for that
  // purpose and only once the client has a home_visit consent already on the
  // record — of any status, since a withdrawn or expired one is exactly what
  // gets re-confirmed at the door. Offering it anywhere else would be a choice
  // the route refuses, which is a worse way to learn the rule.
  const hasHomeVisitOnRecord = record.consents.some((consent) => consent.purpose === 'home_visit');
  const methods: Method[] =
    purpose === 'home_visit' && hasHomeVisitOnRecord
      ? ['app_signature', 'paper_scan', 'verbal_witnessed']
      : ['app_signature', 'paper_scan'];

  const locale = record.preferredLocale;
  // Loading is separate from setting, so the effect below never calls setState
  // in its own body. The form is mounted with a key of the purpose
  // (ConsentTab), so a different consent is a fresh component rather than this
  // one resetting itself — which is why there is no "back to loading" here.
  const loadWording = useCallback(async (): Promise<WordingState> => {
    try {
      const res = await apiFetch(
        `/api/clients/consent-wording?purpose=${encodeURIComponent(purpose)}&locale=${encodeURIComponent(locale)}`,
      );
      if (res.status === 404) return { kind: 'missing' };
      if (!res.ok) return { kind: 'error' };
      const wording = ConsentWordingResponse.parse(await res.json());
      // The words themselves come from the store through the signed link the
      // route handed back, never from an API route of this app's own
      // (docs/SEAMS.md). No credentials on this fetch: the signature in the
      // link is the authorisation, and it is good for five minutes.
      const text = await fetch(wording.textUrl);
      if (!text.ok) return { kind: 'error' };
      return { kind: 'ready', wording, markdown: await text.text() };
    } catch {
      return { kind: 'error' };
    }
  }, [apiFetch, locale, purpose]);

  useEffect(() => {
    let live = true;
    void loadWording().then((next) => {
      if (live) setWordingState(next);
    });
    return () => {
      live = false;
    };
  }, [loadWording]);

  // Who may witness: this practice's own staff, other than the person
  // recording. Asked for only when a verbal re-confirmation is chosen, because
  // no other method has a witness and a dropdown nobody will open is still a
  // request.
  const loadWitnesses = useCallback(async (): Promise<WitnessState> => {
    try {
      const res = await apiFetch('/api/clients/consent-witnesses');
      if (!res.ok) return { kind: 'error' };
      const body = ConsentWitnessListResponse.parse(await res.json());
      return { kind: 'ready', witnesses: body.witnesses };
    } catch {
      return { kind: 'error' };
    }
  }, [apiFetch]);

  useEffect(() => {
    if (method !== 'verbal_witnessed') return;
    let live = true;
    void loadWitnesses().then((next) => {
      if (live) setWitnessState(next);
    });
    return () => {
      live = false;
    };
  }, [method, loadWitnesses]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const box = event.currentTarget;
    // A short wording that does not scroll at all has already been read to the
    // end the moment it is on screen; anything taller wants the last line
    // actually reached, with a few pixels of slack for a trackpad that stops
    // just shy of the bottom.
    if (
      box.scrollHeight <= box.clientHeight ||
      box.scrollTop + box.clientHeight >= box.scrollHeight - 8
    ) {
      setReadToEnd(true);
    }
  }, []);

  // A wording that does not scroll never fires a scroll event, so the same
  // question is asked once when it lands.
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (node && node.scrollHeight <= node.clientHeight) setReadToEnd(true);
  }, []);

  async function chooseScan(file: File | null): Promise<void> {
    setScanError(null);
    setScanWarning(null);
    setScan(null);
    if (!file) return;
    const prepared = await compressToFit(file, MAX_DOCUMENT_BYTES);
    if (!prepared.ok) {
      setScanError(prepared.message);
      return;
    }
    setScan(prepared.file);
    // A form that had to be squeezed hard is still filed, and the person
    // filing it is told to look at it first (./fileUpload.ts).
    setScanWarning(prepared.warning ?? null);
  }

  async function submit(): Promise<void> {
    if (wordingState.kind !== 'ready') return;
    setBusy(true);
    setFormError(null);
    try {
      const evidence =
        method === 'app_signature'
          ? signature
          : method === 'paper_scan'
            ? scan && { mimeType: scan.mimeType, bytesBase64: scan.bytesBase64 }
            : undefined;
      // The witness travels only with the method that has one: migration
      // 103's check constraint refuses the row otherwise, and the route
      // refuses the request before that.
      const witness = method === 'verbal_witnessed' ? { witnessedByUserId: witnessId } : {};
      const res = await apiFetch(`/api/clients/${clientId}/consents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purpose,
          givenByContactId,
          textDocumentId: wordingState.wording.id,
          method,
          ...(evidence ? { evidence } : {}),
          ...witness,
        }),
      });
      if (res.status === 201) {
        onSaved();
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_ERROR);
        return;
      }
      if (res.status === 503) {
        setFormError(STORAGE_ERROR);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      const named = REFUSALS[body?.code ?? ''] ?? REFUSALS[body?.error ?? ''];
      setFormError(named ?? GENERIC_ERROR);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const evidenceReady =
    method === 'verbal_witnessed'
      ? witnessId !== ''
      : method === 'app_signature'
        ? signature !== null && signedName.trim() !== ''
        : scan !== null;
  const canSubmit =
    !busy && wordingState.kind === 'ready' && readToEnd && givenByContactId !== '' && evidenceReady;

  return (
    <section className="tab-section consent-form">
      {/* Focused as it appears: the button that opened this form is above it
          and unchanged, so without this the press reads as having done
          nothing at all. */}
      <h3
        className="drawer__section"
        tabIndex={-1}
        ref={(node) => {
          node?.focus();
        }}
      >
        Record {PURPOSE_LABELS[purpose].toLowerCase()}
      </h3>

      {consenting.length === 0 ? (
        <Note tone="critical">
          {guardianIsTheGap
            ? 'This consent has to come from a legal guardian, and no contact on this record is marked as one. Mark the guardian on the Contacts tab first.'
            : 'No contact on this record may give consent. Set “May give consent” on the Contacts tab first.'}
        </Note>
      ) : (
        <Select
          id="consent-giver"
          label="Given by"
          value={givenByContactId}
          onChange={(event) => setGivenByContactId(event.target.value)}
        >
          {consenting.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contactName(contact) ?? 'Unnamed contact'} —{' '}
              {relationshipLabel(contact.relationship).toLowerCase()}
              {contact.isLegalGuardian ? ' (legal guardian)' : ''}
            </option>
          ))}
        </Select>
      )}

      {wordingState.kind === 'loading' ? <Note>Loading the wording.</Note> : null}
      {wordingState.kind === 'missing' ? (
        <Note tone="critical">
          The practice has no wording on file for this consent in this client&rsquo;s language, so
          nothing can be signed yet.
        </Note>
      ) : null}
      {wordingState.kind === 'error' ? (
        <Note tone="critical">The wording could not be loaded. Try again.</Note>
      ) : null}

      {wordingState.kind === 'ready' ? (
        <>
          <p className="small muted">
            Version <span className="numeric">{wordingState.wording.version}</span>
          </p>
          {wordingState.wording.status === 'draft' ? (
            <Note>
              This wording is a draft, in use until the practice&rsquo;s lawyer approves a final
              version. Read it to the person before they sign.
            </Note>
          ) : null}
          <div
            className="consent-text"
            ref={measure}
            onScroll={onScroll}
            tabIndex={0}
            role="region"
            aria-label="Consent wording"
            {...(wordingState.wording.locale === 'ar' ? { lang: 'ar', dir: 'rtl' as const } : {})}
          >
            <ConsentText markdown={wordingState.markdown} />
          </div>
          {readToEnd ? null : (
            <p className="small muted">Scroll to the end of the wording before signing.</p>
          )}

          <Select
            id="consent-method"
            label="How it is being given"
            value={method}
            onChange={(event) => setMethod(event.target.value as Method)}
          >
            <option value="app_signature">Signed on screen</option>
            <option value="paper_scan">Paper form, photographed or scanned</option>
            {methods.includes('verbal_witnessed') ? (
              <option value="verbal_witnessed">Confirmed verbally, witnessed</option>
            ) : null}
          </Select>

          {method === 'app_signature' ? (
            <SignaturePad
              signedName={signedName}
              onSignedNameChange={setTypedName}
              onChange={setSignature}
              disabled={!readToEnd}
              today={practiceTodayInWords()}
            />
          ) : null}

          {method === 'paper_scan' ? (
            <div className="field">
              <label htmlFor="consent-scan" className="field__label">
                The signed form
              </label>
              <input
                id="consent-scan"
                className="field__input"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={!readToEnd}
                onChange={(event) => void chooseScan(event.target.files?.[0] ?? null)}
              />
              <p className="small muted">
                A photograph or a PDF. Photographs are made smaller here before they are sent; a PDF
                is sent as it is.
              </p>
              {scan ? <p className="small muted">Ready to file: {scan.name}</p> : null}
              {scanWarning ? <Note>{scanWarning}</Note> : null}
              {scanError ? <Note tone="critical">{scanError}</Note> : null}
            </div>
          ) : null}

          {method === 'verbal_witnessed' ? (
            <>
              <Note>
                A verbal re-confirmation of a home visit already agreed. It files no document, so
                the second member of staff who heard it given is the whole of the record.
              </Note>
              {witnessState.kind === 'error' ? (
                <Note tone="critical">
                  The practice&rsquo;s staff could not be loaded. Try again.
                </Note>
              ) : null}
              {witnessState.kind === 'ready' && witnessState.witnesses.length === 0 ? (
                <Note tone="critical">
                  Nobody else is on this practice&rsquo;s books to witness it. Record this consent
                  on screen or on paper instead.
                </Note>
              ) : null}
              {witnessState.kind === 'ready' && witnessState.witnesses.length > 0 ? (
                <Select
                  id="consent-witness"
                  label="Witnessed by"
                  value={witnessId}
                  onChange={(event) => setWitnessId(event.target.value)}
                >
                  <option value="">Choose the member of staff who heard it</option>
                  {witnessState.witnesses.map((witness) => (
                    <option key={witness.id} value={witness.id}>
                      {witness.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {formError ? <Note tone="critical">{formError}</Note> : null}
      {/* A disabled primary with nothing beside it is a dead end: the person
          is looking at a pad they have drawn on and a button that will not
          go. Say which of the three things is still missing. */}
      {!canSubmit && !busy && wordingState.kind === 'ready' ? (
        <p className="small muted">
          {!readToEnd
            ? 'Scroll to the end of the wording before recording this.'
            : givenByContactId === ''
              ? 'Choose who is giving this consent.'
              : method === 'verbal_witnessed'
                ? 'Choose the member of staff who witnessed it.'
                : method === 'paper_scan'
                  ? 'Add a photograph or a PDF of the signed form.'
                  : signature === null
                    ? 'A signature has to be drawn on the pad.'
                    : 'Type the name as the person writes it: it is printed into the image that is filed.'}
        </p>
      ) : null}
      <div className="drawer__actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? 'Recording…' : 'Record consent'}
        </Button>
      </div>
    </section>
  );
}
