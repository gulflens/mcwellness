import { useCallback, useEffect, useState } from 'react';
import { CLIENT_UPLOAD_KINDS, type ClientUploadKind } from '@domain/client';
import {
  ClientDocumentListResponse,
  MAX_DOCUMENT_BYTES,
  type ClientDocument,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { DocumentLink } from './DocumentLink';
import { compressToFit, type UploadFile } from './fileUpload';

/**
 * Documents (docs/SPEC/client-record.md section 4.2): what the practice holds
 * about this client, filing something new, and opening one.
 *
 * The kinds offered are the ones a person files by hand
 * (`CLIENT_UPLOAD_KINDS` in domain/client). An identity document is not among
 * them and never will be: the practice holds an Emirates ID as a keyed
 * fingerprint and a sealed value, never as a picture
 * (docs/SPEC/00-data-model.md section 3), and the route refuses one by kind
 * with that reason if a request is ever hand-written.
 *
 * Consent evidence is listed here as well, filed by the consent route and
 * marked as unchangeable. It is part of what the practice holds, and a
 * Documents tab that quietly omitted it would make the record look emptier
 * than it is.
 *
 * A table rather than cards: documents are homogeneous rows
 * (docs/DESIGN-BRIEF.md), and `ledger` is the console's own table, already
 * carrying the sticky head and tabular figures.
 *
 * There is no delete. Erasure is its own thing, with a request, a reason and a
 * record of what went (section 8), and the API role holds no delete grant on a
 * document at all — a button here would be a button that could not work.
 */

const KIND_LABELS: Record<string, string> = {
  referral: 'Referral letter',
  correspondence: 'Correspondence',
  assessment_raw: 'Assessment file',
  school_report: 'School report',
  other: 'Other',
  consent_signature: 'Signed consent',
  consent_scan: 'Signed consent, on paper',
  consent_text: 'Consent wording',
  report: 'Report',
  invoice: 'Invoice',
  setup_photo: 'Setup photograph',
  certificate: 'Certificate',
};

const UPLOAD_REFUSALS: Record<string, string> = {
  identity_document:
    'The practice never holds a picture of an identity document. Capture the number on the contact instead.',
  system_written: 'That kind of document is filed by the app itself, not uploaded here.',
  unknown_kind: 'Choose what kind of document this is.',
  bytes_do_not_match_type: 'That file is not the kind of file it says it is.',
  document_too_large: 'That file is too large to file here.',
  erased: 'This record has been erased and nothing more can be filed against it.',
};
const GENERIC_ERROR = 'That document could not be filed. Try again.';
const FORBIDDEN_ERROR = "You don't have permission to file documents for this client.";
const STORAGE_ERROR = 'The document store cannot be reached, so nothing was filed.';

type ListState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; documents: ClientDocument[] };

export function DocumentsTab({
  clientId,
  mayWrite,
}: {
  clientId: string;
  /** False for a role the upload route would refuse: the list, and nothing else. */
  mayWrite: boolean;
}) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [kind, setKind] = useState<ClientUploadKind>('referral');
  const [file, setFile] = useState<UploadFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  // Bumped after a successful upload so the input is a fresh element and stops
  // naming a file that has already been filed.
  const [chooserKey, setChooserKey] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetching and setting are separate so the effect below never calls
  // setState in its own body: it hands the answer to a callback, the way
  // useClientRecord does, and a drawer closed mid-flight sets nothing.
  const load = useCallback(async (): Promise<ListState> => {
    try {
      const res = await apiFetch(`/api/clients/${clientId}/documents`);
      if (!res.ok) return { kind: 'error' };
      const body = ClientDocumentListResponse.parse(await res.json());
      return { kind: 'ready', documents: body.documents };
    } catch {
      return { kind: 'error' };
    }
  }, [apiFetch, clientId]);

  useEffect(() => {
    let live = true;
    void load().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function choose(chosen: File | null): Promise<void> {
    setFileError(null);
    setFileWarning(null);
    setFile(null);
    if (!chosen) return;
    const prepared = await compressToFit(chosen, MAX_DOCUMENT_BYTES);
    if (!prepared.ok) {
      setFileError(prepared.message);
      return;
    }
    setFile(prepared.file);
    setFileWarning(prepared.warning ?? null);
  }

  async function upload(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          file: { mimeType: file.mimeType, bytesBase64: file.bytesBase64 },
        }),
      });
      if (res.status === 201) {
        setFile(null);
        setFileWarning(null);
        setChooserKey((key) => key + 1);
        setState(await load());
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
      setFormError(
        UPLOAD_REFUSALS[body?.code ?? ''] ?? UPLOAD_REFUSALS[body?.error ?? ''] ?? GENERIC_ERROR,
      );
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-section">
      {state.kind === 'loading' ? <Note>Loading the documents.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The documents could not be loaded. Try again.</Note>
      ) : null}

      {state.kind === 'ready' ? (
        state.documents.length === 0 ? (
          <Note>Nothing filed against this client yet.</Note>
        ) : (
          <table className="ledger">
            <caption className="visually-hidden">Documents filed against this client</caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Filed</th>
                <th scope="col">Filed by</th>
                <th scope="col">Kept until</th>
                <th scope="col">
                  <span className="visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.documents.map((document) => (
                <tr key={document.id}>
                  <td>
                    {KIND_LABELS[document.kind] ?? document.kind}
                    {document.isImmutable ? <p className="small muted">Unchangeable</p> : null}
                  </td>
                  <td className="numeric">
                    {new Date(document.uploadedAt).toLocaleDateString('en-GB')}
                  </td>
                  <td>{document.uploadedByName ?? 'Not recorded'}</td>
                  <td className="numeric">
                    {document.retentionUntil
                      ? new Date(document.retentionUntil).toLocaleDateString('en-GB')
                      : 'Not on a fixed clock'}
                  </td>
                  <td>
                    {document.bytesRemoved ? (
                      <span className="small muted">
                        Removed when photographs and video consent was withdrawn
                      </span>
                    ) : (
                      <DocumentLink clientId={clientId} documentId={document.id} label="Open" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {mayWrite ? (
        <div className="drawer__form">
          <h3 className="drawer__section">File a document</h3>
          <Select
            id="document-kind"
            label="What it is"
            value={kind}
            onChange={(event) => setKind(event.target.value as ClientUploadKind)}
          >
            {CLIENT_UPLOAD_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option] ?? option}
              </option>
            ))}
          </Select>
          <div className="field">
            <label htmlFor="document-file" className="field__label">
              The file
            </label>
            <input
              key={chooserKey}
              id="document-file"
              className="field__input"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            />
            <p className="small muted">
              A photograph or a PDF. Never a picture of an Emirates ID, a passport or a visa: the
              practice does not hold those.
            </p>
            {file ? <p className="small muted">Ready to file: {file.name}</p> : null}
            {fileWarning ? <Note>{fileWarning}</Note> : null}
            {fileError ? <Note tone="critical">{fileError}</Note> : null}
          </div>
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="drawer__actions">
            <Button variant="primary" disabled={busy || !file} onClick={() => void upload()}>
              {busy ? 'Filing…' : 'File document'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
