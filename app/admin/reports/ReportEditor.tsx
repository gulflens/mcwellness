import { useCallback, useEffect, useState } from 'react';
import type { ProgressReportContent } from '@domain/reports';
import { DraftResponse, GatherResponse, IssueResponse } from '../../api/reports/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { Ribbon } from './Ribbon';
import { mayOfferSigning } from './reportsAccess';

/**
 * The draft editor (docs/SPEC/reports-v1.md section 4.2).
 *
 * **One column, the report's own sections in order.** The gathered figures are
 * shown as they will print and are not editable — a figure a practitioner
 * could retype is a figure that can disagree with the record — and beside them
 * are the fields only a person writes: what has moved, the summary, what the
 * practice suggests next.
 *
 * **A preview of the exact PDF before signing**, and a confirmation saying in
 * plain words what signing means: this becomes a document, it cannot be
 * edited, a mistake is corrected by issuing a new version.
 *
 * The preview is rendered by the server, through the one renderer, from the
 * draft's own row (`app/api/reports/preview.ts`). There is no second
 * implementation and there must not be: a page drawn by a screen could
 * disagree with the document filed a moment later, and the whole point of
 * showing it is that a practitioner sees what a household will get. The only
 * difference is the reference, which is allocated at signing and never before,
 * and the page says so where the number will be.
 *
 * This version writes a **progress report**. The session report's own form is
 * the same shape over the other kind's fields and is deliberately not built
 * yet: the practice writes one when a visit was notable, and the operator has
 * not asked for it to lead.
 */

type Editing = {
  id: string | null;
  coverageFrom: string;
  coverageTo: string;
  locale: 'en' | 'ar';
  summary: string;
  suggestion: string;
  movementByGoal: Record<string, string>;
};

/** Ninety days back to today, which is the stretch a programme is read over. */
function defaultCoverage(now: Date): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const back = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return { from: back.toISOString().slice(0, 10), to };
}

const REFUSALS: Record<string, string> = {
  no_signing_credential: 'That practitioner holds no certificate that lets them sign a report.',
  credential_cannot_sign: 'That certificate does not carry the right to sign a report.',
  credential_lapsed: 'That certificate has lapsed. Renew it before signing.',
  credential_not_yet_valid: 'That certificate does not start until a later date.',
  already_issued: 'This report has already been signed.',
  invalid_content: 'Something in the report is not what the form expects.',
  coverage_required: 'A progress report needs a period to cover.',
};

export function ReportEditor({
  clientId,
  onDone,
  onCancel,
}: {
  clientId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { apiFetch, session } = useAuth();
  const actor = session.status === 'signed-in' ? session.actor : null;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const initial = defaultCoverage(now);

  const [editing, setEditing] = useState<Editing>({
    id: null,
    coverageFrom: initial.from,
    coverageTo: initial.to,
    locale: 'en',
    summary: '',
    suggestion: '',
    movementByGoal: {},
  });
  const [gathered, setGathered] = useState<ProgressReportContent | null>(null);
  const [brainMapsRead, setBrainMapsRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Reading and setting are separate so the effect never calls setState in its
  // own body: it hands the answer to a callback, the way the record's own tabs
  // do, and an editor closed mid-flight sets nothing.
  const gather = useCallback(
    async (
      from: string,
      to: string,
    ): Promise<{ content: ProgressReportContent; brainMapsRead: boolean } | null> => {
      try {
        const res = await apiFetch(
          `/api/reports/gather?clientId=${encodeURIComponent(clientId)}` +
            `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        );
        if (!res.ok) return null;
        const body = GatherResponse.parse(await res.json());
        return {
          content: body.content as ProgressReportContent,
          brainMapsRead: body.brainMapsRead,
        };
      } catch {
        return null;
      }
    },
    [apiFetch, clientId],
  );

  useEffect(() => {
    let live = true;
    void gather(editing.coverageFrom, editing.coverageTo).then((next) => {
      if (!live) return;
      if (next === null) {
        setError('The record could not be read.');
        return;
      }
      setGathered(next.content);
      setBrainMapsRead(next.brainMapsRead);
    });
    return () => {
      live = false;
    };
  }, [gather, editing.coverageFrom, editing.coverageTo]);

  /** Opens the exact page the household will get, before anybody signs it. */
  async function preview(): Promise<void> {
    const id = editing.id ?? (await save());
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reports/${id}/preview`);
      if (!res.ok) {
        setError('The preview could not be rendered.');
        return;
      }
      // Held as an object URL and revoked on the next tick: a preview carries
      // a household's own figures and has no business outliving the click.
      const url = URL.createObjectURL(await res.blob());
      if (window.open(url, '_blank', 'noopener,noreferrer') === null) {
        setError('The preview could not be opened. Your browser blocked the window.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('The preview could not be rendered.');
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/reports/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(editing.id ? { id: editing.id } : {}),
          clientId,
          kind: 'progress',
          locale: editing.locale,
          coverageFrom: editing.coverageFrom,
          coverageTo: editing.coverageTo,
          content: {
            ...(gathered ?? {}),
            summary: editing.summary,
            suggestion: editing.suggestion,
            goals: (gathered?.goals ?? []).map((goal, at) => ({
              ...goal,
              // The gathered goals carry no id in the body, so the editor keys
              // its own text by position and the server pairs it back by the
              // record's own order. The figures are the server's either way.
              movement: editing.movementByGoal[String(at)] ?? '',
            })),
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(REFUSALS[body?.code ?? ''] ?? 'The draft could not be saved.');
        return null;
      }
      const body = DraftResponse.parse(await res.json());
      setEditing((was) => ({ ...was, id: body.report.id }));
      return body.report.id;
    } catch {
      setError('The draft could not be saved.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sign(): Promise<void> {
    const id = editing.id ?? (await save());
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      // Who signs is the person doing it, and the server takes their own
      // practitioner row: it re-reads their credential at this moment and
      // refuses with a sentence if it has lapsed. Nothing here decides it, and
      // nothing here names a practitioner — a screen that could would be a
      // screen that could sign in somebody else's name.
      const res = await apiFetch(`/api/reports/${id}/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setError(REFUSALS[body?.code ?? ''] ?? 'The report could not be signed.');
        return;
      }
      IssueResponse.parse(await res.json());
      onDone();
    } catch {
      setError('The report could not be signed.');
    } finally {
      setBusy(false);
    }
  }

  const canSign = mayOfferSigning(actor, today);

  return (
    <div className="report-editor">
      <section className="report-editor__section">
        <h3 className="report-editor__heading">What the report covers</h3>
        <Field
          id="report-from"
          label="From"
          type="date"
          value={editing.coverageFrom}
          onChange={(event) => {
            // The value is read before the updater runs: React nulls
            // `currentTarget` once the handler returns, and a functional
            // updater runs after it.
            const value = event.currentTarget.value;
            setEditing((was) => ({ ...was, coverageFrom: value }));
          }}
        />
        <Field
          id="report-to"
          label="To"
          type="date"
          value={editing.coverageTo}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setEditing((was) => ({ ...was, coverageTo: value }));
          }}
        />
        <Select
          id="report-locale"
          label="Language of the practitioner's own words"
          hint="Every heading and label prints in both. What you write prints in the language you write it in."
          value={editing.locale}
          onChange={(event) => {
            const value = event.currentTarget.value as 'en' | 'ar';
            setEditing((was) => ({ ...was, locale: value }));
          }}
        >
          <option value="en">English</option>
          <option value="ar">Arabic</option>
        </Select>
      </section>

      {gathered ? (
        <>
          <section className="report-editor__section">
            <h3 className="report-editor__heading">The programme so far</h3>
            <div className="ribbon-block">
              <Ribbon ribbon={gathered.ribbon} />
              <span className="ribbon-block__legend small">
                One mark per session delivered. Taller is a cleaner recording; a hairline marks a
                brain map.
              </span>
            </div>
            <dl className="report-editor__figures">
              <dt>Sessions delivered</dt>
              <dd>{gathered.sessionsDelivered}</dd>
              <dt>Sessions on the programme</dt>
              <dd>{gathered.sessionsEntitled}</dd>
            </dl>
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Goals</h3>
            {gathered.goals.length === 0 ? (
              <Note>No goals have been set for this client.</Note>
            ) : (
              gathered.goals.map((goal, at) => (
                <div key={`${goal.description}-${at}`}>
                  <p>
                    <strong>{goal.description}</strong>
                  </p>
                  <label className="field__label" htmlFor={`movement-${at}`}>
                    What has moved
                  </label>
                  <textarea
                    id={`movement-${at}`}
                    className="report-editor__note"
                    value={editing.movementByGoal[String(at)] ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEditing((was) => ({
                        ...was,
                        movementByGoal: { ...was.movementByGoal, [String(at)]: value },
                      }));
                    }}
                  />
                </div>
              ))
            )}
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Brain maps</h3>
            {gathered.comparison ? (
              <dl className="report-editor__figures">
                {gathered.comparison.lines.map((line) => (
                  <div key={line.label} style={{ display: 'contents' }}>
                    <dt>
                      {line.label} ({line.unit})
                    </dt>
                    <dd>
                      {line.earlier} to {line.later}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <Note>
                {brainMapsRead
                  ? 'This client has fewer than two brain maps of one kind, so the report says nothing about them.'
                  : 'Brain maps are not recorded on this system yet, so the report says nothing about them.'}
              </Note>
            )}
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Your summary</h3>
            <textarea
              id="report-summary"
              className="report-editor__note"
              aria-label="Summary"
              value={editing.summary}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEditing((was) => ({ ...was, summary: value }));
              }}
            />
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">What the practice suggests next</h3>
            <textarea
              id="report-suggestion"
              className="report-editor__note"
              aria-label="What the practice suggests next"
              value={editing.suggestion}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEditing((was) => ({ ...was, suggestion: value }));
              }}
            />
          </section>
        </>
      ) : (
        <Note>Reading the record.</Note>
      )}

      {error ? <Note tone="critical">{error}</Note> : null}

      {confirming ? (
        <div className="report-editor__sign">
          <p>
            Signing this puts your name on it. It becomes a document the household can keep, and it
            cannot be edited afterwards — a mistake is corrected by issuing a new version, and both
            are kept.
          </p>
          <div className="report-editor__actions">
            <Button disabled={busy} onClick={() => void preview()}>
              See the page first
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void sign()}>
              Sign and issue
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div className="report-editor__actions">
          <Button disabled={busy} onClick={() => void save()}>
            Save the draft
          </Button>
          <Button disabled={busy} onClick={() => void preview()}>
            See the page
          </Button>
          {canSign ? (
            <Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>
              Sign this report
            </Button>
          ) : (
            <Note>
              A report is signed by a practitioner whose certificate says so. Yours does not, so
              this stays a draft for somebody who can sign it.
            </Note>
          )}
          <Button variant="quiet" disabled={busy} onClick={onCancel}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
