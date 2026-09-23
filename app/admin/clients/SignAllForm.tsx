import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canGiveConsent,
  requiredConsentsFor,
  type ConsentPurpose,
  type RequiredConsentPurpose,
} from '@domain/client';
import {
  ConsentWordingResponse,
  MAX_DOCUMENT_BYTES,
  RecordConsentBundleBody,
  type ClientRecordResponse,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { useFocusOnOpen } from '../../shell/components/useFocusOnOpen';
import { ConsentText } from './ConsentText';
import { PURPOSE_LABELS } from './consentPurposeLabels';
import { SignaturePad, type SignatureResult } from './SignaturePad';
import { compressToFit, type UploadFile } from './fileUpload';
import { contactDisplayName, relationshipLabel, signatureName } from './contactName';
import { practiceToday, practiceTodayInWords } from './activation';

/**
 * Every consent the client needs, signed once (trunk round 43, the
 * operator's decision of 10 September 2026: one signature should cover
 * everything a client needs, in one sitting).
 *
 * The wordings are the same approved texts `RecordConsentForm` shows for one
 * purpose at a time, stacked here one after another under their own heading;
 * the household reads all of them, and the pad unlocks only once the stack's
 * own scroll box has been read to its end (the same rule, on the combined
 * text). One signature image is filed and every consent row points at it —
 * `POST /api/clients/:id/consents/bundle` runs the single route's own checks
 * per purpose before writing anything — and the image's own foot names the
 * purposes it covers (`SignaturePad`'s `caption`), because the image is the
 * evidence and should say on its own face what it was signed for. Each row
 * still records the exact wording it was read against: nothing about the
 * wordings, or their versions, changes for this.
 *
 * What it does not do: a verbal re-confirmation (one purpose's own, at the
 * door — never a first signature and never several purposes at once) and a
 * withdrawal both stay on the per-consent form beneath, in `ConsentTab.tsx`.
 */

const REFUSALS: Record<string, string> = {
  wording_not_found: 'One wording is no longer on file. Reopen this form to load the current ones.',
  wording_retired: 'One wording has been retired. Reopen this form for the current ones.',
  wording_superseded:
    'The practice has published a newer version of one wording. Reopen this form to show it.',
  wording_wrong_purpose: 'One wording is for a different consent. Reopen this form.',
  wording_wrong_locale: "One wording is not in this client's own language. Reopen this form.",
  contact_may_not_consent:
    'This contact is not marked as able to give consent. Set “May give consent” on the Contacts tab first.',
  guardian_required: 'A legal guardian has to sign for this client.',
  purpose_not_needed: 'One of these consents is not one this client needs. Reopen this form.',
  purpose_repeated: 'One consent was named twice in this signing. Reopen this form.',
  evidence_required: 'The signature or the scanned form has to go with the consents.',
  evidence_not_accepted: 'That evidence does not go with the method chosen.',
  erased: 'This record has been erased and cannot be changed.',
};
const FORBIDDEN_ERROR = "You don't have permission to record consent for this client.";
const STORAGE_ERROR =
  'The document store cannot be reached, so nothing was recorded. Try again shortly.';
const GENERIC_ERROR = 'The consents could not be recorded. Try again.';

type Method = 'app_signature' | 'paper_scan';
type Loaded = {
  purpose: RequiredConsentPurpose;
  wording: ConsentWordingResponse;
  markdown: string;
};
type WordingsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'missing'; purpose: RequiredConsentPurpose }
  | { kind: 'ready'; wordings: Loaded[] };

/** "no", "one", "two", "three", "four": every count this screen ever shows a person. */
function countInWords(n: number): string {
  return ['no', 'one', 'two', 'three', 'four'][n] ?? String(n);
}

function sentenceCase(word: string): string {
  return word.length === 0 ? word : `${word[0]?.toUpperCase()}${word.slice(1)}`;
}

export function SignAllForm({
  clientId,
  record,
  onSaved,
  onCancel,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onSaved: (purposes: ConsentPurpose[]) => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const today = practiceToday();
  // What this client needs, from the date of birth alone — the same question
  // ConsentTab.tsx and the bundle route itself ask (domain/client), so a
  // purpose this screen offers can never be one the route would refuse as
  // `purpose_not_needed`.
  const purposes = useMemo(
    () => requiredConsentsFor({ dateOfBirth: record.dateOfBirth }, ['home'], today),
    [record.dateOfBirth, today],
  );
  const [selectedPurposes, setSelectedPurposes] = useState<RequiredConsentPurpose[]>(purposes);
  const selectionKey = selectedPurposes.join(',');
  // A giver who may give every one of these; a guardian's purpose in the
  // stack narrows the list to guardians, which is the rule the route holds
  // (`canGiveConsent`, domain/client).
  const consenting = useMemo(
    () =>
      record.contacts.filter((contact) =>
        selectedPurposes.every(
          (purpose) =>
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
      ),
    [record.contacts, record.dateOfBirth, selectedPurposes, today],
  );
  const locale = record.preferredLocale;
  const [givenByContactId, setGivenByContactId] = useState(consenting[0]?.id ?? '');
  const [method, setMethod] = useState<Method>('app_signature');
  const [state, setState] = useState<WordingsState>({ kind: 'loading' });
  const [readToEnd, setReadToEnd] = useState(false);
  const [signature, setSignature] = useState<SignatureResult | null>(null);
  const scanRequest = useRef(0);
  const [scan, setScan] = useState<UploadFile | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const giver = consenting.find((contact) => contact.id === givenByContactId) ?? null;
  // The same fallback RecordConsentForm.tsx uses (contactName.tsx,
  // `signatureName`): a self contact with no name of its own signs as the
  // client's own name, and every other unnamed giver starts blank rather than
  // a relationship label standing in for a person's signature.
  const [typedName, setTypedName] = useState<string | null>(null);
  const signedName = typedName ?? (giver ? signatureName(giver, record) : '');

  function changeSelection(next: RequiredConsentPurpose[]): void {
    scanRequest.current += 1;
    setSelectedPurposes(next);
    setReadToEnd(false);
    setSignature(null);
    setScan(null);
    setScanError(null);
    setScanWarning(null);
    setFormError(null);
  }

  const selectedWordings =
    state.kind === 'ready'
      ? state.wordings.filter((wording) => selectedPurposes.includes(wording.purpose))
      : [];

  const loadWordings = useCallback(async (): Promise<WordingsState> => {
    const loaded: Loaded[] = [];
    for (const purpose of purposes) {
      try {
        const res = await apiFetch(
          `/api/clients/consent-wording?purpose=${encodeURIComponent(purpose)}&locale=${encodeURIComponent(locale)}`,
        );
        if (res.status === 404) return { kind: 'missing', purpose };
        if (!res.ok) return { kind: 'error' };
        const wording = ConsentWordingResponse.parse(await res.json());
        // The words themselves come from the store through the signed link
        // the route handed back, never from an API route of this app's own
        // (docs/SEAMS.md), exactly as RecordConsentForm.tsx reads one.
        const text = await fetch(wording.textUrl);
        if (!text.ok) return { kind: 'error' };
        loaded.push({ purpose, wording, markdown: await text.text() });
      } catch {
        return { kind: 'error' };
      }
    }
    return { kind: 'ready', wordings: loaded };
  }, [apiFetch, locale, purposes]);

  useEffect(() => {
    let live = true;
    void loadWordings().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [loadWordings]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const box = event.currentTarget;
    if (
      box.scrollHeight <= box.clientHeight ||
      box.scrollTop + box.clientHeight >= box.scrollHeight - 8
    ) {
      setReadToEnd(true);
    }
  }, []);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (node && node.scrollHeight <= node.clientHeight) setReadToEnd(true);
  }, []);

  async function chooseScan(file: File | null): Promise<void> {
    const request = ++scanRequest.current;
    setScanError(null);
    setScanWarning(null);
    setScan(null);
    if (!file) return;
    const prepared = await compressToFit(file, MAX_DOCUMENT_BYTES);
    if (request !== scanRequest.current) return;
    if (!prepared.ok) {
      setScanError(prepared.message);
      return;
    }
    setScan(prepared.file);
    setScanWarning(prepared.warning ?? null);
  }

  // What the filed image's own foot says it covers, in the same words the
  // headings above read (fix round of 10 September 2026); `SignaturePad.tsx`
  // wraps whatever this comes to across as many lines as it needs. Built
  // from `state.wordings`, the same array the request body below is built
  // from, not from `purposes` again — the two are provably equal today, but
  // deriving the caption from a second array only argues that rather than
  // making it structural, and the caption is the legal artefact. Empty
  // until the wordings are loaded; nothing reads it before then, since it is
  // only ever passed to `SignaturePad` inside the `state.kind === 'ready'`
  // branch below.
  const caption =
    state.kind === 'ready'
      ? `Signed for: ${selectedWordings.map((w) => PURPOSE_LABELS[w.purpose] ?? w.purpose).join(', ')}`
      : '';

  async function submit(): Promise<void> {
    if (!canSubmit || state.kind !== 'ready') return;
    const evidence =
      method === 'app_signature'
        ? signature
        : scan && { mimeType: scan.mimeType, bytesBase64: scan.bytesBase64 };
    if (!evidence) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = RecordConsentBundleBody.parse({
        purposes: selectedWordings.map((w) => ({
          purpose: w.purpose,
          textDocumentId: w.wording.id,
        })),
        givenByContactId,
        method,
        evidence,
      });
      const res = await apiFetch(`/api/clients/${clientId}/consents/bundle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        onSaved(selectedWordings.map((wording) => wording.purpose));
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
      const answer = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      setFormError(REFUSALS[answer?.code ?? ''] ?? REFUSALS[answer?.error ?? ''] ?? GENERIC_ERROR);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const evidenceReady =
    method === 'app_signature' ? signature !== null && signedName.trim() !== '' : scan !== null;
  const canSubmit =
    !busy &&
    state.kind === 'ready' &&
    selectedWordings.length > 0 &&
    readToEnd &&
    giver !== null &&
    evidenceReady;

  const heading = useFocusOnOpen<HTMLHeadingElement>();

  return (
    <section className="tab-section consent-form">
      {/* Focused once, when this form opens (useFocusOnOpen.ts), the same
          reason every panel this tab opens takes focus (ConsentTab.tsx's
          PanelHeading): the button that opened this is unchanged above it. */}
      <h3 className="drawer__section" tabIndex={-1} ref={heading}>
        One signature for your consents
      </h3>
      <p className="small muted">
        {sentenceCase(countInWords(purposes.length))} consents, read one after another and signed
        once. Each is recorded against the wording shown here.
      </p>

      <section className="consent-choice" aria-labelledby="consent-choice-heading">
        <h4 id="consent-choice-heading">Choose the agreements to sign</h4>
        <p className="small muted">
          Select all {countInWords(purposes.length)} to cover them with one signature, or choose
          individual agreements.
        </p>
        <label className="consent-choice__all">
          <input
            type="checkbox"
            disabled={busy}
            checked={selectedPurposes.length === purposes.length}
            ref={(node) => {
              if (node)
                node.indeterminate =
                  selectedPurposes.length > 0 && selectedPurposes.length < purposes.length;
            }}
            onChange={(event) => changeSelection(event.target.checked ? purposes : [])}
          />
          <span>Select all {countInWords(purposes.length)} consents</span>
        </label>
        <div className="consent-choice__list">
          {purposes.map((purpose) => (
            <label key={purpose} className="consent-choice__item">
              <input
                type="checkbox"
                disabled={busy}
                checked={selectedPurposes.includes(purpose)}
                onChange={(event) =>
                  changeSelection(
                    purposes.filter((candidate) =>
                      candidate === purpose
                        ? event.target.checked
                        : selectedPurposes.includes(candidate),
                    ),
                  )
                }
              />
              <span>{PURPOSE_LABELS[purpose]}</span>
            </label>
          ))}
        </div>
        <p className="small" role="status">
          {selectedPurposes.length} of {purposes.length} selected. One signature.
        </p>
      </section>
      <section className="consent-form__section" aria-labelledby="consent-signer-heading">
        <h4 id="consent-signer-heading">1. Confirm who is signing</h4>
        {consenting.length === 0 ? (
          <Note tone="critical">
            No contact on this record may give all of these consents. A child needs a legal guardian
            who may consent; mark one on the Contacts tab first.
          </Note>
        ) : (
          <Select
            id="sign-all-giver"
            label="Given by"
            disabled={busy}
            value={giver ? givenByContactId : ''}
            onChange={(event) => {
              scanRequest.current += 1;
              setGivenByContactId(event.target.value);
              setTypedName(null);
              setSignature(null);
              setScan(null);
              setScanError(null);
              setScanWarning(null);
              setReadToEnd(false);
            }}
          >
            {!giver ? (
              <option value="" disabled>
                Choose who is signing
              </option>
            ) : null}
            {consenting.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contactDisplayName(contact, record)} —{' '}
                {relationshipLabel(contact.relationship).toLowerCase()}
                {contact.isLegalGuardian ? ' (legal guardian)' : ''}
              </option>
            ))}
          </Select>
        )}
      </section>
      {state.kind === 'loading' ? <Note>Loading the wordings.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The wordings could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'missing' ? (
        <Note tone="critical">
          The practice has no wording on file for{' '}
          {(PURPOSE_LABELS[state.purpose] ?? state.purpose).toLowerCase()} in this client&rsquo;s
          language, so nothing can be signed at once yet.
        </Note>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <section className="consent-form__section" aria-labelledby="consent-read-heading">
            <h4 id="consent-read-heading">2. Read the agreements</h4>
            <p className="small muted">The signature will cover the following consents:</p>
            <ul className="consent-form__purposes small">
              {selectedWordings.map((w) => (
                <li key={w.purpose}>{PURPOSE_LABELS[w.purpose] ?? w.purpose}</li>
              ))}
            </ul>
            <div
              key={`${givenByContactId}:${selectionKey}`}
              className="consent-text"
              ref={measure}
              onScroll={onScroll}
              tabIndex={0}
              role="region"
              aria-label="Consent wording"
              {...(locale === 'ar' ? { lang: 'ar', dir: 'rtl' as const } : {})}
            >
              {selectedWordings.map((w) => (
                <section key={w.purpose} className="consent-text__part">
                  {/* Its own class and its own level (h3, not h4): `.consent-text__heading`
                    below is what a heading *inside* a wording's own markdown renders as
                    (ConsentText.tsx), and a separator rule alone was carrying the whole
                    burden of saying "a new consent starts here". */}
                  <h3 className="consent-text__part-heading">
                    {PURPOSE_LABELS[w.purpose] ?? w.purpose}
                  </h3>
                  <p className="small muted">
                    Version <span className="numeric">{w.wording.version}</span>
                  </p>
                  <ConsentText markdown={w.markdown} />
                </section>
              ))}
            </div>
            <p className="small muted" role="status">
              {readToEnd
                ? 'You have reached the end. The signature section is ready.'
                : 'Scroll inside the agreements to the end to unlock signing.'}
            </p>
          </section>
          <section className="consent-form__section" aria-labelledby="consent-sign-heading">
            <h4 id="consent-sign-heading">3. Sign once for the selected agreements</h4>
            <p className="small">
              This signature covers {countInWords(selectedPurposes.length)} selected{' '}
              {selectedPurposes.length === 1 ? 'agreement' : 'agreements'}. Each consent is saved
              separately with the same signature.
            </p>
            <Select
              id="sign-all-method"
              label="How it is being given"
              disabled={busy}
              value={method}
              onChange={(event) => setMethod(event.target.value as Method)}
            >
              <option value="app_signature">Signed on screen</option>
              <option value="paper_scan">Paper form, photographed or scanned</option>
            </Select>

            {method === 'app_signature' ? (
              <SignaturePad
                key={`${givenByContactId}:${selectionKey}`}
                signedName={signedName}
                onSignedNameChange={setTypedName}
                onChange={setSignature}
                disabled={busy || !readToEnd || selectedPurposes.length === 0}
                today={practiceTodayInWords()}
                caption={caption}
              />
            ) : (
              <div className="field">
                <label htmlFor="sign-all-scan" className="field__label">
                  The signed form
                </label>
                <input
                  key={`${givenByContactId}:${selectionKey}`}
                  id="sign-all-scan"
                  className="field__input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={busy || !readToEnd || selectedPurposes.length === 0}
                  onChange={(event) => void chooseScan(event.target.files?.[0] ?? null)}
                />
                <p className="small muted">
                  A photograph or a PDF. Photographs are made smaller here before they are sent; a
                  PDF is sent as it is. One scan is filed against every consent listed above, so the
                  form itself has to show agreement to all of them, not just one.
                </p>
                {scan ? <p className="small muted">Ready to file: {scan.name}</p> : null}
                {scanWarning ? <Note>{scanWarning}</Note> : null}
                {scanError ? <Note tone="critical">{scanError}</Note> : null}
              </div>
            )}
          </section>
        </>
      ) : null}

      {formError ? <Note tone="critical">{formError}</Note> : null}
      {!canSubmit && !busy && state.kind === 'ready' ? (
        <p className="small muted">
          {selectedPurposes.length === 0
            ? 'Select at least one agreement to continue.'
            : !readToEnd
              ? 'Scroll to the end of the wording before recording this.'
              : givenByContactId === ''
                ? 'Choose who is giving this consent.'
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
          {busy
            ? 'Recording…'
            : `Record ${selectedPurposes.length === purposes.length ? 'all ' : ''}${countInWords(selectedPurposes.length)} ${selectedPurposes.length === 1 ? 'consent' : 'consents'}`}
        </Button>
      </div>
    </section>
  );
}
