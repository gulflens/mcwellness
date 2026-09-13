import { useCallback, useState } from 'react';
import {
  EDF_RECORDING_EXTENSION,
  NATIVE_RECORDING_EXTENSION,
  ASSESSMENT_FILE_MIME_TYPE,
  RECORDING_MIME_TYPE,
} from '@domain/assessment';
import {
  ExportFiledResponse,
  SESSION_EXPORT_LIMIT_BYTES,
  type ExportRefusalCode,
} from '../../api/sessions/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Note } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';

/**
 * The export the practice's software wrote, attached to the visit that
 * produced it, on the Summary step (docs/SPEC/session-capture.md section 3.6).
 *
 * The practitioner is standing over the laptop the export was just written on,
 * finishing the visit, which is the one moment the file and the record are in
 * the same place. So the control is here and nowhere else.
 *
 * **The upload is app/admin/assessments/ExportFiles.tsx's, followed rather
 * than re-derived.** The digest is computed here, in the browser, over the
 * bytes that are about to be sent, and the server recomputes it over the bytes
 * it actually received (app/api/sessions/export.ts): two fingerprints of the
 * same file, taken at each end, so a truncated upload does not become a filed
 * export and a retry after a dropped connection is recognised as the same file
 * rather than filed twice.
 *
 * **The extension goes, the name stays here.** The one kind that cannot be
 * told by its bytes is recognised by the extension the file was chosen under,
 * so that is what is sent — a few characters, never `file.name`. The name is
 * shown on this screen, because the practitioner needs to see which of several
 * files on their own desktop they picked; it is not sent, logged or stored,
 * because the practice's files are named after the people in them.
 *
 * **Optional, and it says so.** Nothing here can stop a check-out. A visit in
 * a living room with no signal closes with no export and the record carries a
 * quiet marker rather than a refusal — `domain/session/canCheckIn.ts` gates
 * entry, and nothing gates exit.
 *
 * **One export per visit.** `session.export_document_id` is singular, and the
 * door refuses a second, different file rather than replacing the first
 * (migration 307). So once one is attached the chooser goes and the marker
 * stands in its place: an input that could only ever be refused is worse than
 * no input.
 */

/** What the chooser suggests: the report, and both recordings by extension. */
const ACCEPTED = [
  ASSESSMENT_FILE_MIME_TYPE,
  `.${EDF_RECORDING_EXTENSION}`,
  `.${NATIVE_RECORDING_EXTENSION}`,
].join(',');

const MESSAGES = {
  empty: 'That file has nothing in it.',
  too_large: 'That file is larger than this door takes. Sixty-four megabytes is the limit.',
  failed: 'That export could not be filed. Try again.',
};

/**
 * Why the door refused, by the word it answered with — its `code` where it
 * names one and its `error` otherwise, because a refusal made before the route
 * is reached (the body cap, the media type) carries only the latter. The
 * wording follows the console's own (app/admin/assessments/copy.ts): the same
 * three kinds of file, refused for the same three reasons, should not be
 * described two different ways to two different people.
 *
 * Typed against `ExportRefusalCode` rather than `Record<string, string>`, so
 * this must name every code the route's own vocabulary carries — a code added
 * to `EXPORT_REFUSAL_CODES` (schema.ts) with no line added here fails to
 * compile instead of shipping a route that answers a screen with nothing to
 * say. The four keys past the union are the door's other, non-export-specific
 * refusals (a body-cap or role check that never reaches the export's own
 * vocabulary), named here because this screen still owes them a sentence.
 */
const REFUSALS: Record<
  ExportRefusalCode | 'payload_too_large' | 'storage_unavailable' | 'forbidden' | 'not_found',
  string
> = {
  not_a_pdf: 'That is not a PDF. A report is the software’s own PDF.',
  not_a_recording:
    'That is not a recording this door takes. A recording is an EDF file or the amplifier ' +
    'software’s own.',
  unsupported_media_type:
    'That is not a file this door takes. It takes the software’s PDF, an EDF recording, or the ' +
    'amplifier software’s own recording.',
  payload_too_large: MESSAGES.too_large,
  empty_body: MESSAGES.empty,
  digest_mismatch: 'The file changed on the way. Choose it again.',
  digest_missing: 'The file changed on the way. Choose it again.',
  storage_unavailable: 'The document store cannot be reached, so nothing was filed.',
  export_already_filed: 'This visit already has an export. Only one is kept.',
  session_closed: 'This visit is closed, so nothing more can be attached to it.',
  // Said only when the door has established neither of the two above. It
  // asserts no cause, because it does not know one.
  export_not_filed: 'That export could not be attached to this visit.',
  forbidden: 'Attaching an export to this visit is not yours to do.',
  not_found: 'That visit is no longer there.',
};

/**
 * `REFUSALS[code]`, but for a `code` that is a plain string from the wire
 * rather than a known member of it — the door can in principle answer
 * anything, and a screen must not throw over a word it does not recognise.
 * The cast is confined to this one read; `REFUSALS`'s own declaration stays
 * exact, so an unhandled code still fails the build there.
 */
function messageFor(code: string): string {
  return (REFUSALS as Record<string, string>)[code] ?? MESSAGES.failed;
}

/** The extension a chosen file carries, lower-cased and without its dot. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * What to declare the bytes as. Taken from the extension rather than from the
 * browser's own `file.type`, which is empty for a format no browser knows —
 * which is both of the recordings.
 */
function declaredTypeFor(extension: string): string {
  return extension === 'pdf' ? ASSESSMENT_FILE_MIME_TYPE : RECORDING_MIME_TYPE;
}

/** The bytes' own fingerprint, as the route's `X-Sha256` header wants it. */
async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ExportStep({
  sessionId,
  attachedName,
  busy,
  onAttached,
  onBusy,
}: {
  sessionId: string;
  /**
   * The name of the file already attached, or null. Held by the runner rather
   * than here so that leaving the step and coming back does not offer to
   * attach a second one the door would refuse.
   */
  attachedName: string | null;
  /**
   * Whether an upload is in flight. Held by the runner for the same reason the
   * name is, and for one more: the check-out button lives in the step's dock
   * and has to know. A 33 MB recording on a home link is minutes, this control
   * unmounts the moment check-out is confirmed, and the request would carry on
   * into a visit that had closed underneath it — filed nowhere, reported to
   * nobody, and unattachable ever after (migration 960: a closed visit admits
   * no change at all).
   */
  busy: boolean;
  onAttached: (name: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { apiFetch } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      if (file.size === 0) {
        setError(MESSAGES.empty);
        return;
      }
      if (file.size > SESSION_EXPORT_LIMIT_BYTES) {
        setError(MESSAGES.too_large);
        return;
      }
      onBusy(true);
      try {
        const bytes = await file.arrayBuffer();
        const extension = extensionOf(file.name);
        const query = extension === '' ? '' : `?extension=${encodeURIComponent(extension)}`;
        const res = await apiFetch(`/api/sessions/${sessionId}/export${query}`, {
          method: 'PUT',
          headers: {
            'content-type': declaredTypeFor(extension),
            'x-sha256': await digestOf(bytes),
          },
          body: bytes,
        });
        if (!res.ok) {
          const answer = (await res.json().catch(() => null)) as {
            code?: string;
            error?: string;
          } | null;
          setError(messageFor(answer?.code ?? answer?.error ?? ''));
          return;
        }
        // Parsed rather than trusted, so a door that answered something else
        // is a failure here and not a screen saying a file is filed when the
        // answer never named one.
        ExportFiledResponse.parse(await res.json());
        onAttached(file.name);
      } catch {
        setError(MESSAGES.failed);
      } finally {
        // Always, and on the runner rather than here: an upload that failed
        // must never leave the check-out button warning about a request that
        // is over, and this control may already have unmounted.
        onBusy(false);
      }
    },
    [apiFetch, onAttached, onBusy, sessionId],
  );

  return (
    <section className="ratings">
      <h2>The session export</h2>
      <p className="small muted">
        The file your session software wrote for this visit. Optional — checking out does not wait
        for it.
      </p>
      {attachedName === null ? (
        <div className="field">
          <StatusChip label="No export attached" tone="neutral" />
          <label className="field__label" htmlFor="session-export">
            Attach the export
          </label>
          <input
            id="session-export"
            className="field__input"
            type="file"
            accept={ACCEPTED}
            disabled={busy}
            onChange={(event) => void attach(event.target.files?.[0] ?? null)}
          />
          <div className="field__hint small muted">
            The recording or the report, as the software wrote it. Up to sixty-four megabytes.
          </div>
        </div>
      ) : (
        <div className="field">
          <StatusChip label="Export attached" tone="ok" />
          {/* The name the practitioner chose, so they can see which file went.
              It never left this screen: the door receives the extension and
              nothing else. */}
          <div className="small muted">{attachedName}</div>
        </div>
      )}
      {busy ? (
        <p className="small muted" role="status">
          Attaching the export…
        </p>
      ) : null}
      {error ? <Note tone="critical">{error}</Note> : null}
    </section>
  );
}
