import { useState } from 'react';
import {
  checkExternalUpload,
  EXTERNAL_REPORT_MAX_BYTES,
  EXTERNAL_TITLE_MAX,
  type ExternalUploadRefusal,
} from '@domain/reports';
import { isoDateIn } from '@domain/shared';
import { ExternalUploadResponse } from '../../api/reports/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';

/**
 * "Upload a PDF report" on the client's Reports tab (docs/SPEC/reports-v1.md
 * section 12): a report the practice made in another tool — its desktop
 * brain-map report builder, for one — filed against this client as its PDF,
 * so it can be sent to the household and opened in their portal as a report
 * written here is.
 *
 * **Three things and the file**: a title, which is how the report is told
 * apart on this list and in the household's portal; the date the report
 * bears; and the PDF. Checked here by the same rule the server checks
 * (`domain/reports/external.ts`) — a PDF by its first bytes, never by its
 * name, at most twenty megabytes, a title, a date that has come — so a
 * person hears what is wrong before anything is sent. The size is asked
 * before the file is read at all.
 *
 * **The bytes go raw, with their fingerprint**, as the assessments' export
 * door takes them (app/admin/assessments/ExportFiles.tsx): the server
 * recomputes the digest over what arrived. The title goes in a header,
 * percent-encoded, never in the address — an address is what a proxy's log
 * keeps — and the file's own name is never sent: the practice's files are
 * named after the people in them.
 *
 * **Filed issued.** Nothing here is signed: the PDF is the signed artefact,
 * finished in the tool that made it. Once filed it opens on its own page
 * with Open and Send, and is corrected, if ever, by uploading the right file.
 *
 * English only, as every console screen is.
 */

const SENTENCES: Readonly<Record<ExternalUploadRefusal | 'no_file' | 'failed', string>> = {
  no_file: 'Choose the PDF to upload.',
  not_a_pdf: 'That file is not a PDF. Choose the PDF the report was saved as.',
  empty_file: 'That file is empty. Choose the PDF the report was saved as.',
  too_many_bytes: 'That file is larger than 20 MB. Save the report again at a smaller size.',
  no_title: 'Give the report a title, so it can be told apart on the list.',
  title_too_long: `Keep the title to ${EXTERNAL_TITLE_MAX} characters.`,
  no_date: 'Give the date on the report.',
  date_in_future: 'The date on the report cannot be after today.',
  failed: 'The report could not be uploaded. Try again.',
};

/** The server's refusals, by code, as a person reads them. */
const SERVER_SENTENCES: Readonly<Record<string, string>> = {
  ...SENTENCES,
  digest_mismatch: 'The file changed on the way. Choose it again.',
  digest_missing: 'The file changed on the way. Choose it again.',
  not_permitted: 'You may not upload a report for this client.',
  not_found: 'This client could not be found.',
  record_erased: 'This record has been erased. Nothing new is filed against it.',
  storage_unavailable: 'The document store cannot be reached. Try again shortly.',
};

/**
 * The practice's own day, as PastRecordImport.tsx reads it: the date field's
 * default and its upper bound. The server asks again in the practice's time
 * zone as it stands, which is the answer that binds.
 */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ExternalUpload({
  clientId,
  onDone,
  onCancel,
}: {
  clientId: string;
  /** The report filed, or the one these bytes were already filed as. */
  onDone: (reportId: string) => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  // Today once, when the form opens: the clock is not read again on every keystroke.
  const [today] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [title, setTitle] = useState('');
  const [reportDate, setReportDate] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(): Promise<void> {
    setError(null);
    if (file === null) {
      setError(SENTENCES.no_file);
      return;
    }
    // Before the file is read: twenty megabytes is not worth loading to refuse.
    if (file.size > EXTERNAL_REPORT_MAX_BYTES) {
      setError(SENTENCES.too_many_bytes);
      return;
    }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const checked = checkExternalUpload({
        title,
        reportDate,
        bytes: new Uint8Array(bytes),
        today,
      });
      if (!checked.ok) {
        setError(SENTENCES[checked.code]);
        return;
      }
      const query = new URLSearchParams({ clientId, reportDate: checked.reportDate });
      const res = await apiFetch(`/api/reports/external?${query.toString()}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'x-sha256': await digestOf(bytes),
          'x-report-title': encodeURIComponent(checked.title),
        },
        body: bytes,
      });
      if (!res.ok) {
        const answer = (await res.json().catch(() => null)) as {
          code?: string;
          error?: string;
        } | null;
        setError(SERVER_SENTENCES[answer?.code ?? answer?.error ?? ''] ?? SENTENCES.failed);
        return;
      }
      const { report } = ExternalUploadResponse.parse(await res.json());
      onDone(report.id);
    } catch {
      setError(SENTENCES.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="report-editor__section" aria-label="Upload a PDF report">
      <h3 className="report-editor__heading">Upload a PDF report</h3>
      <p className="small">
        A report made in another tool, filed here as it is. It is not signed in this app: the PDF is
        the report. Once uploaded it can be sent to the household and opened in their portal, under
        a reference of this app’s that the PDF itself does not print.
      </p>
      <Field
        id="external-title"
        label="Title"
        hint="How the report is named on this list and in the household’s portal."
        value={title}
        maxLength={EXTERNAL_TITLE_MAX}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      <DateField
        id="external-date"
        label="Date on the report"
        value={reportDate}
        max={today}
        onChange={setReportDate}
      />
      <label className="field__label" htmlFor="external-file">
        The PDF
      </label>
      <input
        id="external-file"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
      />
      <p className="small muted">A PDF of at most 20 MB.</p>
      {error ? <Note tone="critical">{error}</Note> : null}
      <div className="report-editor__actions">
        <Button variant="primary" disabled={busy} onClick={() => void upload()}>
          Upload
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
