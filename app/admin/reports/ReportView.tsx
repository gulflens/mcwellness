import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressReportContent, ReportKind } from '@domain/reports';
import {
  DeliverResponse,
  ReportResponse,
  SupersedeResponse,
  TwinResponse,
  type ReportRow,
} from '../../api/reports/schema';
import type { ReportResponse as Report } from '../../api/reports/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { kindLabel, mayBeSent } from './kinds';
import { Ribbon } from './Ribbon';
import { twinRefusalSentence } from './qeeg/refusals';
import { TWIN_REASON } from './qeeg/useQeegSigning';
import { languageWord, twinLines } from './qeeg/twinWords';

/**
 * View and deliver (docs/SPEC/reports-v1.md section 4.3): the filed PDF
 * through a short-lived signed link, the delivery history beneath it, and
 * **Send**, which offers only the contacts that may receive one.
 *
 * **Supersede asks for a reason.** It does not correct anything by itself: it
 * writes a new draft carrying the reason, marks this version replaced, and
 * hands the practitioner back to the editor to read it over and sign it. A
 * correction that issued itself would be a document nobody looked at.
 *
 * **The link is fetched when a button is pressed**, never rendered into the
 * page in advance: a link that sits in the markup ends up in a screenshot, a
 * bookmark or a log.
 *
 * **A brain map is signed in either language, each as its own report**
 * (docs/SPEC/reports-qeeg.md section 8). Its page says which language it is
 * in, names its other language, says in a sentence when it is out of step
 * with the report it was made from, and offers "Sign the other language" on a
 * signed one that has none yet, which starts that draft and hands it to the
 * brain-map form.
 */

const REFUSALS: Record<string, string> = {
  not_issued: 'A draft is not sent. Sign it first.',
  no_consent: 'This client has no live agreement to take part, so nothing may be sent.',
  contact_may_not_receive: 'That person’s record says they do not receive reports.',
  no_whatsapp_opt_in: 'That person has not agreed to be messaged on WhatsApp.',
  no_usable_number: 'There is no usable telephone number on that record.',
  no_email: 'There is no email address on that record.',
  no_document: 'This report has no filed document yet.',
  already_superseded: 'A newer version of this report already exists.',
  no_reason: 'Say in a sentence why a new version is needed.',
};

type Contact = { id: string; label: string };

/**
 * What a correction sends, by kind. The older kinds send the body the new
 * version starts from; a brain map starts from what was signed, and its door
 * refuses a body that sends one (app/api/reports/qeeg/supersede.ts).
 */
function correctionBody(kind: ReportKind, reason: string, content: unknown): object {
  switch (kind) {
    case 'session':
    case 'progress':
      return { reason, content };
    case 'qeeg':
      return { reason };
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

export function ReportView({
  reportId,
  reports = [],
  maySupersede,
  maySend,
  onBack,
  onSuperseded,
  onTwinStarted,
}: {
  reportId: string;
  /** The client's reports, so a brain map's other language is named by its reference. */
  reports?: readonly ReportRow[];
  maySupersede: boolean;
  maySend: boolean;
  onBack: () => void;
  /** The other language of a signed brain map was started as a draft: open it. */
  onTwinStarted?: (draftId: string) => void;
  /**
   * Where the corrected draft went. The tab opens the editor on it, because a
   * correction the practitioner cannot then read over and sign is a correction
   * only the API can finish (section 4.3).
   */
  onSuperseded?: (draftId: string, kind: ReportKind) => void;
}) {
  const { apiFetch } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [contacts, setContacts] = useState<readonly Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [handoff, setHandoff] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [superseding, setSuperseding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Why the report could not be read, when the server gave a sentence for it. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentenceRef = useRef<string | null>(null);

  // Reading and setting are separate so the effect never calls setState in its
  // own body: it hands the answer to a callback, the way the record's own tabs
  // do, and a screen closed mid-flight sets nothing.
  const read = useCallback(async (): Promise<Report | null> => {
    try {
      const res = await apiFetch(`/api/reports/${reportId}`);
      if (!res.ok) {
        // A signed brain map whose file cannot be made again says why, in a
        // sentence of the server's (app/api/reports/get.ts); anything else
        // keeps the plain sentence below.
        const body: unknown = await res.json().catch(() => null);
        const sentence =
          res.status === 409 && typeof body === 'object' && body !== null
            ? (body as { sentence?: unknown }).sentence
            : null;
        sentenceRef.current = typeof sentence === 'string' ? sentence : null;
        return null;
      }
      sentenceRef.current = null;
      return ReportResponse.parse(await res.json());
    } catch {
      return null;
    }
  }, [apiFetch, reportId]);

  const reread = useCallback(async (): Promise<void> => {
    const next = await read();
    setReport(next);
    setLoadError(sentenceRef.current);
    setState(next === null ? 'error' : 'ready');
  }, [read]);

  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (!live) return;
      setReport(next);
      setLoadError(sentenceRef.current);
      setState(next === null ? 'error' : 'ready');
    });
    return () => {
      live = false;
    };
  }, [read]);

  // The contacts of this report's own client, from the record's own route.
  // Which of them may actually receive one is the server's answer at the
  // moment of sending, not this screen's to pre-empt.
  useEffect(() => {
    if (!report) return;
    let live = true;
    void apiFetch(`/api/clients/${report.report.clientId}`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as {
          contacts?: { id: string; relationship: string; canReceiveReports?: boolean }[];
        };
        const rows = (body.contacts ?? [])
          .filter((contact) => contact.canReceiveReports !== false)
          .map((contact) => ({ id: contact.id, label: contact.relationship }));
        if (!live) return;
        setContacts(rows);
        setContactId(rows[0]?.id ?? '');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [apiFetch, report]);

  async function open(): Promise<void> {
    if (!report?.url) return;
    if (window.open(report.url, '_blank', 'noopener,noreferrer') === null) {
      setError('The report could not be opened. Your browser blocked the window.');
    }
  }

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    setHandoff(null);
    try {
      const res = await apiFetch(`/api/reports/${reportId}/deliver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId, channel }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(REFUSALS[body?.code ?? ''] ?? 'The report could not be sent.');
        return;
      }
      const body = DeliverResponse.parse(await res.json());
      if (body.delivered) {
        setNote('Sent.');
      } else if (body.handoffUrl) {
        // A hand-off, not a broadcast: the practice presses send in its own
        // WhatsApp, and nothing leaves this system on the platform's account.
        setHandoff(body.handoffUrl);
      }
      await reread();
    } catch {
      setError('The report could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function startTwin(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reports/${reportId}/twin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': TWIN_REASON },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError(twinRefusalSentence(res.status, await res.json().catch(() => null)));
        return;
      }
      const body = TwinResponse.parse(await res.json());
      if (onTwinStarted) {
        onTwinStarted(body.report.id);
        return;
      }
      setNote('The other language has been started as a draft.');
      await reread();
    } catch {
      setError(twinRefusalSentence(0, null));
    } finally {
      setBusy(false);
    }
  }

  async function supersede(): Promise<void> {
    if (!report) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reports/${reportId}/supersede`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A brain map is corrected from what was signed, and its door takes
        // the reason alone (app/api/reports/qeeg/supersede.ts); the older
        // kinds send the body the new version starts from.
        body: JSON.stringify(correctionBody(report.report.kind, reason, report.content)),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(REFUSALS[body?.code ?? ''] ?? 'A new version could not be started.');
        return;
      }
      const body = SupersedeResponse.parse(await res.json());
      setSuperseding(false);
      setReason('');
      if (onSuperseded) {
        onSuperseded(body.report.id, body.report.kind);
        return;
      }
      setNote('A new version has been started as a draft. Read it over, then sign it.');
      await reread();
    } catch {
      setError('A new version could not be started.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <Note>Loading.</Note>;
  if (state === 'error' || !report) {
    return <Note tone="critical">{loadError ?? 'That report could not be loaded.'}</Note>;
  }

  const row = report.report;
  const language = languageWord(row);
  const twinSaid = twinLines(row, reports);
  const mayTwin =
    maySupersede &&
    row.kind === 'qeeg' &&
    row.status === 'issued' &&
    row.twinOfId === null &&
    row.twinId === null;
  const progress =
    row.kind === 'progress' ? (report.content as ProgressReportContent | null) : null;

  return (
    <div className="report-view">
      <dl className="report-view__facts">
        <dt>Reference</dt>
        <dd>{row.reference ?? 'Not yet signed'}</dd>
        <dt>Kind</dt>
        <dd>{kindLabel(row.kind)}</dd>
        {language !== null ? (
          <>
            <dt>Language</dt>
            <dd>{language}</dd>
          </>
        ) : null}
        {row.coverageFrom && row.coverageTo ? (
          <>
            <dt>Covers</dt>
            <dd>
              {row.coverageFrom} to {row.coverageTo}
            </dd>
          </>
        ) : null}
        <dt>Signed by</dt>
        <dd>{row.signedByName ?? 'Not yet signed'}</dd>
        {row.version > 1 ? (
          <>
            <dt>Version</dt>
            <dd>{row.version}</dd>
          </>
        ) : null}
      </dl>

      {twinSaid.length > 0 ? (
        <ul className="report-view__twin small">
          {twinSaid.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {row.outOfStep ? (
        <Note tone="attention">
          The report this one was made from has been corrected since, so this one is out of step
          with it. Start the other language again from the corrected report once it is signed.
        </Note>
      ) : null}

      {row.status === 'superseded' ? (
        <Note tone="attention">
          A newer version of this report has been issued. This one is kept because a household may
          already hold it.
        </Note>
      ) : null}

      {progress?.ribbon ? (
        <div className="ribbon-block">
          <Ribbon ribbon={progress.ribbon} />
          <span className="ribbon-block__legend small">
            One mark per session delivered. Taller is a cleaner recording; a hairline marks a brain
            map.
          </span>
        </div>
      ) : null}

      <div className="report-editor__actions">
        {report.url ? (
          <Button variant="primary" onClick={() => void open()}>
            Open the report
          </Button>
        ) : (
          <Note>This report has no filed document.</Note>
        )}
        <Button variant="quiet" onClick={onBack}>
          Back to the list
        </Button>
      </div>

      {maySend && mayBeSent(row.status) ? (
        <section>
          <h3 className="report-editor__heading">Send it to the household</h3>
          {contacts.length === 0 ? (
            <Note>Nobody on this record is marked as receiving reports.</Note>
          ) : (
            <>
              <Select
                id="deliver-contact"
                label="To"
                value={contactId}
                onChange={(event) => setContactId(event.currentTarget.value)}
              >
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.label}
                  </option>
                ))}
              </Select>
              <Select
                id="deliver-channel"
                label="How"
                value={channel}
                onChange={(event) => setChannel(event.currentTarget.value as 'whatsapp' | 'email')}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </Select>
              <div className="report-editor__actions">
                <Button disabled={busy || contactId === ''} onClick={() => void send()}>
                  Send
                </Button>
              </div>
            </>
          )}
          {handoff ? (
            <Note tone="attention">
              <a href={handoff} target="_blank" rel="noopener noreferrer">
                Open WhatsApp with the message written
              </a>
              , then press send there.
            </Note>
          ) : null}
        </section>
      ) : null}

      {report.deliveries.length > 0 ? (
        <section>
          <h3 className="report-editor__heading">Sent</h3>
          <ul className="report-view__deliveries">
            {report.deliveries.map((delivery) => (
              <li key={delivery.id} className="report-view__delivery small">
                <span>{delivery.contactLabel}</span>
                <span>{delivery.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                <span className="numeric">{delivery.sentAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mayTwin ? (
        <section className="report-editor__sign">
          <p>
            A brain-map report is signed in each language as a report of its own. This starts it in{' '}
            {row.locale === 'en' ? 'Arabic' : 'English'} as a draft made from this one, with the
            same findings, scores and maps; only that language’s versions of what was typed are
            written there.
          </p>
          <div className="report-editor__actions">
            <Button disabled={busy} onClick={() => void startTwin()}>
              Sign the other language
            </Button>
          </div>
        </section>
      ) : null}

      {maySupersede && row.status === 'issued' ? (
        <section className="report-editor__sign">
          {superseding ? (
            <>
              <label className="field__label" htmlFor="supersede-reason">
                Why a new version is needed
              </label>
              <textarea
                id="supersede-reason"
                className="report-editor__note"
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
              <p className="small muted">
                This report stays as it is and is marked as replaced. The household may already hold
                it, so nothing about it changes.
              </p>
              <div className="report-editor__actions">
                <Button variant="primary" disabled={busy} onClick={() => void supersede()}>
                  Start a new version
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setSuperseding(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={() => setSuperseding(true)}>Correct this report</Button>
          )}
        </section>
      ) : null}

      {note ? <Note>{note}</Note> : null}
      {error ? <Note tone="critical">{error}</Note> : null}
    </div>
  );
}
