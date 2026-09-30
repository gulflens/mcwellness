import { useCallback, useEffect, useState } from 'react';
import { displayFromIso } from '@domain/shared';
import { BAND_IDS, DIMENSION_IDS } from '../../../../domain/reports/qeeg/catalogue/ids';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import type { Picked, QeegInitial } from '../../../../domain/reports/qeeg/types';
import { phrase } from '../../../../domain/reports/qeeg/wording';
import { PastRecordResponse, ReportResponse } from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Note } from '../../../shell/components/Controls';
import { noteSentence, pastRecordRefusalSentence } from './pastRecordWords';
import './qeeg.css';

/**
 * A past record from the practice's old report tool, read-only, as the
 * client's reports show it: "Past record" (docs/SPEC/reports-qeeg.md section
 * 11; brief R, item 7).
 *
 * **Read here, never previewed.** A past record has no pages of this app's:
 * the old tool printed it once, in its own words, and this app never prints
 * it again (point 4), so the preview door refuses it. This page shows what it
 * records, in the console's English, and every note of what could not be
 * carried (point 5).
 *
 * **Withdrawn with a reason** (point 7), by the owner or the lead
 * practitioner, when it was kept against the wrong client. The reason is
 * typed, so it travels in the body. A record a follow-up is compared with
 * cannot be withdrawn until that follow-up is compared with another, and the
 * page says so.
 */

const en = (key: string) => phrase(key, 'initial', 'en');

function chosen<Id extends string>(picked: Picked<Id>, keyOf: (id: Id) => string): string[] {
  const custom = Object.values(picked.custom)
    .filter((item) => item.chosen)
    .sort((a, b) => a.position - b.position)
    .map((item) => item.label.en);
  return [...picked.chosen.map((id) => en(keyOf(id))), ...custom];
}

function Chosen({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <>
      <dt>{title}</dt>
      <dd>{items.length === 0 ? 'None' : items.join(', ')}</dd>
    </>
  );
}

function Recorded({ content }: { content: QeegInitial }) {
  return (
    <dl className="report-view__facts">
      <Chosen title="Key findings" items={chosen(content.findings, (id) => `finding.${id}`)} />
      <Chosen title="Areas of focus" items={chosen(content.focus, (id) => `focus.${id}`)} />
      {BAND_IDS.map((band) => {
        const level = content.bands[band].level;
        return (
          <Chosen
            key={band}
            title={en(`band.${band}.name`)}
            items={level === null ? [] : [en(`level.band.${level}.label`)]}
          />
        );
      })}
      {DIMENSION_IDS.map((dimension) => {
        const score = content.dashboard[dimension].score;
        return (
          <Chosen
            key={dimension}
            title={en(`dimension.${dimension}.title`)}
            items={score === null ? [] : [`${score} of 10`]}
          />
        );
      })}
      <Chosen
        title="Recommendations"
        items={chosen(content.recommendations, (id) => `recommendation.${id}.name`)}
      />
      <Chosen title="Benefits" items={chosen(content.benefits, (id) => `benefit.${id}`)} />
      <dt>Summary</dt>
      <dd>{content.summary.en.text === '' ? 'None' : content.summary.en.text}</dd>
      <dt>Maps</dt>
      <dd className="numeric">{Object.keys(content.maps).length}</dd>
    </dl>
  );
}

export function PastRecordView({
  reportId,
  mayWithdraw,
  onBack,
}: {
  reportId: string;
  /** The owner or the lead practitioner (`report.import`). */
  mayWithdraw: boolean;
  onBack: () => void;
}) {
  const { apiFetch } = useAuth();
  const [record, setRecord] = useState<ReportResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (): Promise<ReportResponse | null> => {
    try {
      const res = await apiFetch(`/api/reports/${reportId}`);
      return res.ok ? ReportResponse.parse(await res.json()) : null;
    } catch {
      return null;
    }
  }, [apiFetch, reportId]);

  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (!live) return;
      setRecord(next);
      setState(next === null ? 'error' : 'ready');
    });
    return () => {
      live = false;
    };
  }, [read]);

  async function withdraw(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reports/${reportId}/withdraw-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          res.status === 400 && (body as { error?: unknown } | null)?.error === 'reason_required'
            ? 'Say in a sentence why it is withdrawn. The reason is kept with the record.'
            : pastRecordRefusalSentence(res.status, body),
        );
        return;
      }
      PastRecordResponse.parse(body);
      setWithdrawing(false);
      setReason('');
      const next = await read();
      setRecord(next);
    } catch {
      setError('The record could not be withdrawn. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <Note>Loading.</Note>;
  if (state === 'error' || record === null) {
    return <Note tone="critical">That record could not be loaded.</Note>;
  }

  const row = record.report;
  const checked = row.withdrawn ? null : validateQeegContent(record.content);
  const content = checked?.ok && checked.content.edition === 'initial' ? checked.content : null;
  const notes =
    content !== null && content.provenance.origin === 'legacy_tool' ? content.provenance.notes : [];

  return (
    <div className="report-view qeeg-past">
      <dl className="report-view__facts">
        <dt>Kind</dt>
        <dd>Past record from the old report tool</dd>
        <dt>Recorded on</dt>
        <dd>{row.recordedOn === null ? 'Not in the file' : displayFromIso(row.recordedOn)}</dd>
        <dt>Brought in on</dt>
        <dd>{displayFromIso(row.createdAt.slice(0, 10))}</dd>
        <dt>Status</dt>
        <dd>
          {row.withdrawn ? 'Withdrawn' : row.status === 'imported' ? 'Kept' : 'Being brought in'}
        </dd>
      </dl>
      <p className="small muted">
        Kept as the old tool recorded it. It is never signed, never sent and not shown to the
        household; the old tool printed it once, in its own words.
      </p>

      {row.withdrawn ? (
        <Note tone="attention">
          This record was withdrawn because it was kept against the wrong client. What it held has
          been cleared and its maps removed; the stamp of what was brought in stays.
        </Note>
      ) : content === null ? (
        <Note tone="critical">What this record holds could not be read.</Note>
      ) : (
        <>
          <Recorded content={content} />
          <h4 className="report-editor__heading">What could not be carried</h4>
          {notes.length === 0 ? (
            <p className="small">Everything in the file was carried.</p>
          ) : (
            <ul className="small" aria-label="What could not be carried">
              {notes.map((note) => (
                <li key={`${note.code}:${note.at ?? ''}`}>{noteSentence(note)}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="report-editor__actions">
        <Button variant="quiet" onClick={onBack}>
          Back to the list
        </Button>
      </div>

      {mayWithdraw && row.status === 'imported' && !row.withdrawn ? (
        <section className="report-editor__sign">
          {withdrawing ? (
            <>
              <label className="field__label" htmlFor="withdraw-reason">
                Why it is withdrawn
              </label>
              <textarea
                id="withdraw-reason"
                className="report-editor__note"
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
              <p className="small muted">
                What it holds is cleared and its maps removed. The stamp of what was brought in
                stays, with this reason.
              </p>
              <div className="report-editor__actions">
                <Button variant="primary" disabled={busy} onClick={() => void withdraw()}>
                  Withdraw it
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setWithdrawing(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={() => setWithdrawing(true)}>Withdraw this record</Button>
          )}
        </section>
      ) : null}

      {error ? <Note tone="critical">{error}</Note> : null}
    </div>
  );
}
