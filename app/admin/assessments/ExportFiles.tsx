import { useCallback, useState } from 'react';
import {
  ASSESSMENT_FILE_LIMIT_BYTES,
  ASSESSMENT_FILE_MIME_TYPE,
  ASSESSMENT_FILE_ROLES,
  FileLinkResponse,
  type AssessmentFile,
  type AssessmentFileRole,
} from '../../api/assessments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { ATTACH_MESSAGES, ATTACH_REFUSALS, FILE_ROLE_LABELS } from './copy';

/**
 * The export, in the measurement's own row (docs/SPEC/assessment.md sections
 * 3.1 and 3.2): what is filed against this measurement, and the way to file
 * another.
 *
 * **The digest is computed here, in the browser, over the bytes that are about
 * to be sent**, and the server recomputes it over the bytes it actually
 * received (app/api/assessments/file.ts). Two fingerprints of the same file,
 * taken at each end: a truncated upload does not become a filed export, and a
 * retry after a dropped connection is recognised as the same file rather than
 * filed twice.
 *
 * **A PDF and nothing else**, which the input says and the route enforces. The
 * `accept` attribute is a convenience for the person choosing, never a check:
 * the bytes are read against their own signature on the server, because a
 * route that files whatever it is handed under whatever it is told will one
 * day hold an HTML page called a report.
 *
 * **Opening one is a read**, and the link is asked for at the moment somebody
 * presses, never rendered into the page in advance — the route writes the
 * audit row before it signs, so a page that pre-fetched links would log the
 * practice as having opened every export every time anyone glanced at the tab
 * (docs/SEAMS.md, and the same reasoning as app/admin/clients/DocumentLink.tsx,
 * which is the client record's own and reads a different route).
 */

/** The bytes' own fingerprint, as the route's `X-Sha256` header wants it. */
async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function OpenExport({ file }: { file: AssessmentFile }) {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const label = FILE_ROLE_LABELS[file.role];

  const open = useCallback(async () => {
    setBusy(true);
    setError(null);
    setBlockedUrl(null);
    try {
      const res = await apiFetch(`/api/assessments/file/${file.documentId}/link`);
      if (!res.ok) {
        setError(
          res.status === 503 ? ATTACH_MESSAGES.store_unavailable : ATTACH_MESSAGES.link_failed,
        );
        return;
      }
      const { url } = FileLinkResponse.parse(await res.json());
      // noreferrer as well as noopener: the link carries a signature, and the
      // page it opens has no business knowing which screen sent it.
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      // A blocked popup is null and silent, and a button that appears to do
      // nothing reads as a missing file. Hand the link over instead.
      if (!opened) setBlockedUrl(url);
    } catch {
      setError(ATTACH_MESSAGES.link_failed);
    } finally {
      setBusy(false);
    }
  }, [apiFetch, file.documentId]);

  return (
    <span className="assessments__file">
      <Button
        variant="quiet"
        disabled={busy}
        onClick={() => void open()}
        aria-label={`${label}, opens in a new tab`}
      >
        {busy ? 'Opening…' : label}
      </Button>
      {blockedUrl ? (
        <span className="small" role="status">
          Your browser stopped the file opening.{' '}
          <a href={blockedUrl} target="_blank" rel="noopener noreferrer">
            Open it in a new tab
          </a>
        </span>
      ) : null}
      {error ? (
        <span className="field__hint field__hint--error small" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function ExportFiles({
  assessmentId,
  files,
  mayAttach,
  onAttached,
}: {
  assessmentId: string;
  files: readonly AssessmentFile[];
  /**
   * Offered on the version that stands and on no other. A replaced version is
   * a fact about a day that has been corrected; the evidence belongs against
   * the measurement the practice reads.
   */
  mayAttach: boolean;
  onAttached: () => void;
}) {
  const { apiFetch } = useAuth();
  const [role, setRole] = useState<AssessmentFileRole>('raw');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a filing so the input is a fresh element and stops naming a
  // file that has already been filed.
  const [chooserKey, setChooserKey] = useState(0);

  const attach = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      if (file.size === 0) {
        setError(ATTACH_MESSAGES.empty);
        return;
      }
      if (file.size > ASSESSMENT_FILE_LIMIT_BYTES) {
        setError(ATTACH_MESSAGES.too_large);
        return;
      }
      setBusy(true);
      try {
        const bytes = await file.arrayBuffer();
        const res = await apiFetch(`/api/assessments/${assessmentId}/file?role=${role}`, {
          method: 'PUT',
          headers: {
            'content-type': ASSESSMENT_FILE_MIME_TYPE,
            'x-sha256': await digestOf(bytes),
          },
          body: bytes,
        });
        if (!res.ok) {
          const answer = (await res.json().catch(() => null)) as {
            code?: string;
            error?: string;
          } | null;
          setError(ATTACH_REFUSALS[answer?.code ?? answer?.error ?? ''] ?? ATTACH_MESSAGES.failed);
          return;
        }
        setChooserKey((key) => key + 1);
        onAttached();
      } catch {
        setError(ATTACH_MESSAGES.failed);
      } finally {
        setBusy(false);
      }
    },
    [apiFetch, assessmentId, onAttached, role],
  );

  return (
    <div className="assessments__files">
      {files.length === 0 ? <span className="small muted">None attached</span> : null}
      {files.map((file) => (
        <OpenExport key={file.documentId} file={file} />
      ))}
      {mayAttach ? (
        <div className="assessments__attach">
          <Select
            id={`attach-role-${assessmentId}`}
            label="What the file is"
            value={role}
            onChange={(event) => setRole(event.target.value as AssessmentFileRole)}
          >
            {ASSESSMENT_FILE_ROLES.map((each) => (
              <option key={each} value={each}>
                {FILE_ROLE_LABELS[each]}
              </option>
            ))}
          </Select>
          <div className="field">
            <label htmlFor={`attach-${assessmentId}`} className="field__label">
              Attach the export
            </label>
            <input
              key={chooserKey}
              id={`attach-${assessmentId}`}
              className="field__input"
              type="file"
              accept={ASSESSMENT_FILE_MIME_TYPE}
              disabled={busy}
              onChange={(event) => void attach(event.target.files?.[0] ?? null)}
            />
            <p className="small muted">
              The software&rsquo;s own PDF, as it wrote it. Up to twenty megabytes.
            </p>
          </div>
          {busy ? (
            <span className="small muted" role="status">
              Filing the export…
            </span>
          ) : null}
          {error ? <Note tone="critical">{error}</Note> : null}
        </div>
      ) : null}
    </div>
  );
}
