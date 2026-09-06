import { useCallback, useEffect, useState } from 'react';
import type { ProgressReportContent, SessionReportContent } from '@domain/reports';
import {
  DraftResponse,
  GatherResponse,
  IssueResponse,
  ReportResponse,
  VisitsResponse,
  type VisitChoice,
} from '../../api/reports/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { Ribbon } from './Ribbon';
import { mayOfferSigning } from './reportsAccess';

/**
 * The draft editor (docs/SPEC/reports-v1.md section 4.2), over both kinds.
 *
 * **One column, the report's own sections in order.** The gathered figures are
 * shown as they will print and are not editable — a figure a practitioner
 * could retype is a figure that can disagree with the record — and beside them
 * are the fields only a person writes.
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
 * **The draft is saved before every preview and before signing.** It used to
 * save only when nothing had been saved yet, so anything typed after the last
 * save was neither previewed nor signed, and the document a household received
 * could differ from the page on screen. Saving first costs a request and
 * removes a whole class of "but it said something else".
 *
 * **Two kinds, one form.** A progress report covers a stretch; a session
 * report follows one completed visit, chosen from the visits the practice
 * actually made. The kind is fixed when the draft is created and never changes
 * afterwards — they are different documents, not two views of one.
 *
 * **An existing draft opens here.** A draft row on the tab lands in this
 * editor loaded with what was saved, and so does the corrected draft a
 * supersede writes. Before that a draft could be signed only through the API,
 * which is not a screen at all.
 */

type Editing = {
  id: string | null;
  coverageFrom: string;
  coverageTo: string;
  locale: 'en' | 'ar';
  sessionId: string | null;
  /** Progress: the practitioner's own two paragraphs. */
  summary: string;
  suggestion: string;
  /** Session: the practitioner's own two paragraphs. */
  note: string;
  beforeNextVisit: string;
  /** Keyed by the goal's own id, which the body carries (reports-01.md). */
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
  visit_required: 'A session report follows one visit. Choose which.',
  no_such_visit: 'That visit is not one a report can be written about.',
};

function empty(now: Date, kind: 'session' | 'progress'): Editing {
  const initial = defaultCoverage(now);
  return {
    id: null,
    coverageFrom: kind === 'progress' ? initial.from : '',
    coverageTo: kind === 'progress' ? initial.to : '',
    locale: 'en',
    sessionId: null,
    summary: '',
    suggestion: '',
    note: '',
    beforeNextVisit: '',
    movementByGoal: {},
  };
}

export function ReportEditor({
  clientId,
  kind,
  reportId = null,
  onDone,
  onCancel,
}: {
  clientId: string;
  /** Chosen when the draft is created, and fixed for its life. */
  kind: 'session' | 'progress';
  /** An existing draft to open, or null to start a new one. */
  reportId?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { apiFetch, session } = useAuth();
  const actor = session.status === 'signed-in' ? session.actor : null;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [editing, setEditing] = useState<Editing>(() => empty(now, kind));
  const [gathered, setGathered] = useState<ProgressReportContent | SessionReportContent | null>(
    null,
  );
  const [visits, setVisits] = useState<readonly VisitChoice[]>([]);
  const [brainMapsRead, setBrainMapsRead] = useState(false);
  const [loading, setLoading] = useState(reportId !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Reading and setting are separate so an effect never calls setState in its
  // own body: it hands the answer to a callback, the way the record's own tabs
  // do, and an editor closed mid-flight sets nothing.

  /** An existing draft, loaded into the form exactly as it was saved. */
  const readDraft = useCallback(async (): Promise<ReportResponse | null> => {
    if (reportId === null) return null;
    try {
      const res = await apiFetch(`/api/reports/${reportId}`);
      if (!res.ok) return null;
      return ReportResponse.parse(await res.json());
    } catch {
      return null;
    }
  }, [apiFetch, reportId]);

  useEffect(() => {
    if (reportId === null) return;
    let live = true;
    void readDraft().then((found) => {
      if (!live) return;
      setLoading(false);
      if (found === null) {
        setError('That draft could not be opened.');
        return;
      }
      const row = found.report;
      // `content` is `unknown` at the API boundary on purpose (its shape is
      // the domain's to declare per kind), so it is read here as the two kinds
      // between them, each field optional.
      const body = (found.content ?? {}) as Partial<ProgressReportContent> &
        Partial<SessionReportContent>;
      const movement: Record<string, string> = {};
      for (const goal of body.goals ?? []) {
        movement[goal.id] = goal.movement;
      }
      setEditing({
        id: row.id,
        coverageFrom: row.coverageFrom ?? '',
        coverageTo: row.coverageTo ?? '',
        locale: row.locale,
        sessionId: body.sessionId ?? null,
        summary: body.summary ?? '',
        suggestion: body.suggestion ?? '',
        note: body.note ?? '',
        beforeNextVisit: body.beforeNextVisit ?? '',
        movementByGoal: movement,
      });
    });
    return () => {
      live = false;
    };
  }, [readDraft, reportId]);

  /** The visits a session report may be written about. */
  const readVisits = useCallback(async (): Promise<VisitChoice[] | null> => {
    try {
      const res = await apiFetch(`/api/reports/visits?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return null;
      return [...VisitsResponse.parse(await res.json()).visits];
    } catch {
      return null;
    }
  }, [apiFetch, clientId]);

  useEffect(() => {
    if (kind !== 'session') return;
    let live = true;
    void readVisits().then((found) => {
      if (!live || found === null) return;
      setVisits(found);
      setEditing((was) => (was.sessionId ? was : { ...was, sessionId: found[0]?.id ?? null }));
    });
    return () => {
      live = false;
    };
  }, [kind, readVisits]);

  /** The figures, from the record, for whichever kind this is. */
  const gather = useCallback(
    async (
      at: Pick<Editing, 'coverageFrom' | 'coverageTo' | 'sessionId' | 'locale'>,
    ): Promise<{ content: ProgressReportContent | SessionReportContent; maps: boolean } | null> => {
      const query =
        kind === 'progress'
          ? `/api/reports/gather?clientId=${encodeURIComponent(clientId)}` +
            `&from=${encodeURIComponent(at.coverageFrom)}&to=${encodeURIComponent(at.coverageTo)}`
          : `/api/reports/gather-session?clientId=${encodeURIComponent(clientId)}` +
            `&sessionId=${encodeURIComponent(at.sessionId ?? '')}` +
            `&locale=${encodeURIComponent(at.locale)}`;
      try {
        const res = await apiFetch(query);
        if (!res.ok) return null;
        const body = GatherResponse.parse(await res.json());
        return {
          content: body.content as ProgressReportContent | SessionReportContent,
          maps: body.brainMapsRead,
        };
      } catch {
        return null;
      }
    },
    [apiFetch, clientId, kind],
  );

  const { coverageFrom, coverageTo, sessionId, locale } = editing;
  useEffect(() => {
    if (kind === 'session' && sessionId === null) return;
    let live = true;
    void gather({ coverageFrom, coverageTo, sessionId, locale }).then((next) => {
      if (!live) return;
      if (next === null) {
        setError('The record could not be read.');
        return;
      }
      setGathered(next.content);
      setBrainMapsRead(next.maps);
    });
    return () => {
      live = false;
    };
    // The whole of what the figures depend on, and nothing that does not
    // change them: retyping a summary must not re-read the record.
  }, [gather, kind, coverageFrom, coverageTo, sessionId, locale]);

  /** The body as it stands on screen, for the server to put its figures back into. */
  function bodyNow(): Record<string, unknown> {
    if (kind === 'progress') {
      const progressNow = gathered as ProgressReportContent | null;
      return {
        summary: editing.summary,
        suggestion: editing.suggestion,
        goals: (progressNow?.goals ?? []).map((goal) => ({
          ...goal,
          // Paired back by the goal's own id, which the body carries. By
          // position, a goal added between the gathering and the save put a
          // sentence about sleep beside a goal about school.
          movement: editing.movementByGoal[goal.id] ?? '',
        })),
      };
    }
    return { note: editing.note, beforeNextVisit: editing.beforeNextVisit };
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
          kind,
          locale: editing.locale,
          coverageFrom: kind === 'progress' ? editing.coverageFrom : null,
          coverageTo: kind === 'progress' ? editing.coverageTo : null,
          sessionId: kind === 'session' ? editing.sessionId : null,
          content: bodyNow(),
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

  /**
   * Opens the exact page the household will get, before anybody signs it —
   * and saves first, always, so it is the page as it stands on screen.
   */
  async function preview(): Promise<void> {
    const id = await save();
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

  async function sign(): Promise<void> {
    // Saved first, always: what is signed is what is on screen.
    const id = await save();
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
  const progress = kind === 'progress' ? (gathered as ProgressReportContent | null) : null;
  const visit = kind === 'session' ? (gathered as SessionReportContent | null) : null;

  if (loading) return <Note>Loading.</Note>;

  return (
    <div className="report-editor">
      <section className="report-editor__section">
        <h3 className="report-editor__heading">
          {kind === 'progress' ? 'What the report covers' : 'Which visit'}
        </h3>
        {kind === 'progress' ? (
          <>
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
          </>
        ) : visits.length === 0 ? (
          <Note>
            No completed visit has been recorded for this client, so there is nothing to write a
            session report about yet.
          </Note>
        ) : (
          <Select
            id="report-visit"
            label="The visit this report follows"
            value={editing.sessionId ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setEditing((was) => ({ ...was, sessionId: value }));
            }}
          >
            {visits.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.on} — {choice.serviceName} — {choice.practitionerName}
              </option>
            ))}
          </Select>
        )}
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

      {progress ? (
        <>
          <section className="report-editor__section">
            <h3 className="report-editor__heading">The programme so far</h3>
            <div className="ribbon-block">
              <Ribbon ribbon={progress.ribbon} />
              <span className="ribbon-block__legend small">
                One mark per session delivered. Taller is a cleaner recording; a hairline marks a
                brain map.
              </span>
            </div>
            <dl className="report-editor__figures">
              <dt>Sessions delivered</dt>
              <dd>{progress.sessionsDelivered}</dd>
              <dt>Sessions on the programme</dt>
              <dd>{progress.sessionsEntitled}</dd>
            </dl>
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Goals</h3>
            {progress.goals.length === 0 ? (
              <Note>No goals have been set for this client.</Note>
            ) : (
              progress.goals.map((goal, at) => (
                <div key={goal.id}>
                  <p>
                    <strong>{goal.description}</strong>
                  </p>
                  <label className="field__label" htmlFor={`movement-${at}`}>
                    What has moved
                  </label>
                  <textarea
                    id={`movement-${at}`}
                    className="report-editor__note"
                    value={editing.movementByGoal[goal.id] ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEditing((was) => ({
                        ...was,
                        movementByGoal: { ...was.movementByGoal, [goal.id]: value },
                      }));
                    }}
                  />
                </div>
              ))
            )}
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Brain maps</h3>
            {progress.comparison ? (
              <dl className="report-editor__figures">
                {progress.comparison.lines.map((line) => (
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
      ) : null}

      {visit ? (
        <>
          <section className="report-editor__section">
            <h3 className="report-editor__heading">The visit</h3>
            <dl className="report-editor__figures">
              <dt>Date</dt>
              <dd>{visit.visitDate}</dd>
              <dt>Service</dt>
              <dd>{visit.serviceName}</dd>
              <dt>Practitioner</dt>
              <dd>{visit.practitionerName}</dd>
              {visit.durationMinutes === null ? null : (
                <>
                  <dt>Length</dt>
                  <dd>{visit.durationMinutes} minutes</dd>
                </>
              )}
              {visit.goalArea === null ? null : (
                <>
                  <dt>Goal area</dt>
                  <dd>{visit.goalArea}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Before and after</h3>
            {visit.ratings.length === 0 ? (
              <Note>Nothing was rated at this visit.</Note>
            ) : (
              <dl className="report-editor__figures">
                {visit.ratings.map((rating) => (
                  <div key={rating.key} style={{ display: 'contents' }}>
                    <dt>{rating.label}</dt>
                    <dd>
                      {rating.before ?? '–'} to {rating.after ?? '–'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">What was observed</h3>
            {visit.observationChips.length === 0 ? (
              <Note>Nothing was recorded beside the ratings.</Note>
            ) : (
              <p>{visit.observationChips.join(', ')}</p>
            )}
            <dl className="report-editor__figures">
              {visit.tolerance === null ? null : (
                <>
                  <dt>Tolerated</dt>
                  <dd>{visit.tolerance}</dd>
                </>
              )}
              {visit.engagement === null ? null : (
                <>
                  <dt>Engaged</dt>
                  <dd>{visit.engagement}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">Your note</h3>
            <textarea
              id="report-note"
              className="report-editor__note"
              aria-label="Your note"
              value={editing.note}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEditing((was) => ({ ...was, note: value }));
              }}
            />
          </section>

          <section className="report-editor__section">
            <h3 className="report-editor__heading">What to expect before the next visit</h3>
            <textarea
              id="report-before-next"
              className="report-editor__note"
              aria-label="What to expect before the next visit"
              value={editing.beforeNextVisit}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setEditing((was) => ({ ...was, beforeNextVisit: value }));
              }}
            />
          </section>
        </>
      ) : null}

      {gathered === null ? <Note>Reading the record.</Note> : null}

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
