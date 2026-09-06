import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import {
  AccessReportResponse,
  ActivityFilters,
  ActivityResponse,
  type AccessReportReader,
  type ActivityEvent,
} from '../../api/audit/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader, Select } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { describeRoles } from '../../shell/routing';
import './audit.css';

/**
 * Audit: the practice's whole trail, and who has read one record
 * (docs/SPEC/audit.md section 9, views 2 and 4).
 *
 * **The daily glance.** Newest first, in sentences, narrowable by who acted,
 * what kind of row it was, which action and which days. The API composes every
 * sentence from the catalogue in `domain/shared/audit-narrative.ts`, so this
 * screen lays out lines and renders no JSON — the rendering rule of section 9,
 * kept where it can be seen.
 *
 * **The access report** is the second half, and it is the reason this screen is
 * worth the trouble: the first time a household asks who has seen their
 * child's record, the answer is one press away. It is reached from a line of
 * the feed, because a line already names the record it touched and a picker of
 * every household would be a list of names on a page that is about oversight.
 *
 * **Nothing here shows a person's name but a member of the practice's own.** A
 * record is named by its number, which is what the console names records by
 * everywhere (.claude/rules/ui.md: opaque ids, never personal data in a URL).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const PAGE = 50;

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const stampFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** The trail's own words, said as a person would say them. */
const ENTITY_LABELS: Record<string, string> = {
  client: 'Client record',
  contact: 'Contact',
  consent: 'Agreement',
  document: 'Document',
  session: 'Visit',
  appointment: 'Appointment',
  assessment: 'Measurement',
  assessment_document: 'Measurement file',
  report: 'Report',
  report_delivery: 'Report delivery',
  invoice: 'Invoice',
  payment: 'Payment',
  entitlement: 'Session credit',
  audit_log: 'Trail',
};

const ACTION_LABELS: Record<string, string> = {
  insert: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  read: 'Opened',
  list: 'Listed',
};

function label(dictionary: Record<string, string>, word: string): string {
  return dictionary[word] ?? word;
}

type Filters = {
  actorId: string;
  entityType: string;
  action: string;
  from: string;
  to: string;
  clientId: string;
};

const NO_FILTERS: Filters = {
  actorId: '',
  entityType: '',
  action: '',
  from: '',
  to: '',
  clientId: '',
};

function queryOf(filters: Filters, before: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE) });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '') params.set(key, value);
  }
  if (before) params.set('before', before);
  return params.toString();
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'refused' }
  | {
      kind: 'ready';
      events: ActivityEvent[];
      nextBefore: string | null;
      hasMore: boolean;
      loadingMore: boolean;
    };

function groupByDay(events: readonly ActivityEvent[]): { day: string; events: ActivityEvent[] }[] {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    const day = dayFormat.format(new Date(event.occurredAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}

/** Everyone who has opened one record, ever (section 9.4). */
function AccessReport({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { apiFetch } = useAuth();
  const [report, setReport] = useState<AccessReportResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // No `setReport(null)` here: the component is keyed on the record it is
  // about (below), so asking about a second one mounts a fresh one rather than
  // blanking this one from inside an effect — which React counts as a
  // cascading render and eslint refuses.
  useEffect(() => {
    let live = true;
    void apiFetch(`/api/audit/access-report?clientId=${encodeURIComponent(clientId)}`)
      .then(async (res) => {
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        const parsed = AccessReportResponse.safeParse(await res.json());
        if (live && parsed.success) setReport(parsed.data);
        else if (live) setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [apiFetch, clientId]);

  const columns: readonly Column<AccessReportReader>[] = [
    {
      key: 'who',
      header: 'Who',
      render: (reader) => (
        <>
          {reader.name ?? 'No longer with the practice'}
          {reader.roles.length > 0 ? (
            <span className="audit__roles small muted">{describeRoles(reader.roles)}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'what',
      header: 'What they opened',
      render: (reader) =>
        reader.entityTypes.map((entity) => label(ENTITY_LABELS, entity)).join(', '),
    },
    {
      key: 'times',
      header: 'Times',
      numeric: true,
      align: 'end',
      render: (reader) => reader.reads,
    },
    {
      key: 'first',
      header: 'First',
      numeric: true,
      render: (reader) => stampFormat.format(new Date(reader.firstAt)),
    },
    {
      key: 'last',
      header: 'Last',
      numeric: true,
      render: (reader) => stampFormat.format(new Date(reader.lastAt)),
    },
  ];

  return (
    <section className="audit__report" aria-label="Access report">
      <div className="audit__report-head">
        <h2 className="audit__heading">
          Everyone who has opened{' '}
          <span className="numeric">{report ? report.client.mrn : 'this record'}</span>
        </h2>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
      {failed ? (
        <Note tone="critical">
          That record&rsquo;s access report could not be read. An erased record opens for the owner
          and the lead practitioner alone, and needs a reason.
        </Note>
      ) : null}
      {!failed && report === null ? <Note>Putting the report together.</Note> : null}
      {report ? (
        <>
          <Table
            caption="Everyone who has opened this record, and when"
            columns={columns}
            rows={report.readers}
            rowKey={(reader) => reader.actorId ?? 'unknown'}
            empty={<Note>Nobody has opened this record yet.</Note>}
          />
          <p className="small muted">
            Put together {stampFormat.format(new Date(report.generatedAt))}. Every line is a read
            the application recorded when a row left the database.
          </p>
        </>
      ) : null}
    </section>
  );
}

export function AuditPage() {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [choices, setChoices] = useState<ActivityFilters>({
    actors: [],
    entityTypes: [],
    actions: [],
  });
  // **The one press.** A record's own timeline links here with the record in
  // the address (`app/admin/audit/RecordTimeline.tsx`), so somebody already
  // looking at a household can ask who else has been without first finding a
  // line for that household in whichever pages of the feed happen to be
  // loaded — which is what round 31's default 16 fell short of
  // (docs/CHANGE-REQUESTS/trunk-notes.md, round 31's fix round, section 3).
  //
  // Read once, on the first render, and then cleared from the address: the
  // report is a state of this screen from that moment on, so closing it closes
  // it and a reload opens the feed rather than re-opening a report somebody
  // had shut. A client id is an opaque uuid and not personal data, which is
  // what `.claude/rules/ui.md` keeps out of a query string.
  const [params, setParams] = useSearchParams();
  const [reportFor, setReportFor] = useState<string | null>(() => {
    // Anything may be typed into an address bar, so the value is held only
    // when it is a record id — the same rule the route itself holds
    // (`app/api/audit/activity.ts`'s `ClientQuery`, `z.uuid()`), read from the
    // same library rather than written out a second time as a pattern. A
    // malformed parameter opens nothing, rather than a panel whose note about
    // an erased record is untrue of a request the API refuses with 400.
    const asked = z.uuid().safeParse(params.get('report'));
    return asked.success ? asked.data : null;
  });

  useEffect(() => {
    if (!params.has('report')) return;
    const next = new URLSearchParams(params);
    next.delete('report');
    // `replace`, so the address the link came from is not left one press of
    // Back away from re-opening what was just closed.
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/audit/filters')
      .then(async (res) => {
        if (!res.ok) return;
        const parsed = ActivityFilters.safeParse(await res.json());
        if (live && parsed.success) setChoices(parsed.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [apiFetch]);

  const fetchPage = useCallback(
    async (before: string | null): Promise<ActivityResponse | 'refused' | null> => {
      const res = await apiFetch(`/api/audit/activity?${queryOf(filters, before)}`);
      if (res.status === 403) return 'refused';
      if (!res.ok) return null;
      const parsed = ActivityResponse.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    },
    [apiFetch, filters],
  );

  useEffect(() => {
    let live = true;
    fetchPage(null)
      .then((page) => {
        if (!live) return;
        if (page === 'refused') return setState({ kind: 'refused' });
        setState(
          page === null
            ? { kind: 'error' }
            : {
                kind: 'ready',
                events: page.events,
                nextBefore: page.nextBefore,
                hasMore: page.hasMore,
                loadingMore: false,
              },
        );
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.hasMore || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    const page = await fetchPage(state.nextBefore).catch(() => null);
    if (page === null || page === 'refused') {
      setState({ ...state, loadingMore: false });
      return;
    }
    setState({
      kind: 'ready',
      events: [...state.events, ...page.events],
      nextBefore: page.nextBefore,
      hasMore: page.hasMore,
      loadingMore: false,
    });
  };

  const groups = useMemo(() => (state.kind === 'ready' ? groupByDay(state.events) : []), [state]);
  const change = (part: Partial<Filters>) => setFilters((current) => ({ ...current, ...part }));

  return (
    <section className="page">
      <PageHeader
        title="Audit"
        aside="Everything that has touched this practice's records, newest first. Every line is written from the trail itself."
        action={
          <Button variant="quiet" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </Button>
        }
      />

      <div className="audit__filters">
        <Select
          id="audit-actor"
          label="Who"
          value={filters.actorId}
          onChange={(e) => change({ actorId: e.target.value })}
        >
          <option value="">Anybody</option>
          {choices.actors.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
        <Select
          id="audit-entity"
          label="Kind of row"
          value={filters.entityType}
          onChange={(e) => change({ entityType: e.target.value })}
        >
          <option value="">Anything</option>
          {choices.entityTypes.map((entity) => (
            <option key={entity} value={entity}>
              {label(ENTITY_LABELS, entity)}
            </option>
          ))}
        </Select>
        <Select
          id="audit-action"
          label="What happened"
          value={filters.action}
          onChange={(e) => change({ action: e.target.value })}
        >
          <option value="">Anything</option>
          {choices.actions.map((action) => (
            <option key={action} value={action}>
              {label(ACTION_LABELS, action)}
            </option>
          ))}
        </Select>
        <Field
          id="audit-from"
          label="From"
          type="date"
          value={filters.from}
          onChange={(e) => change({ from: e.target.value })}
        />
        <Field
          id="audit-to"
          label="To"
          type="date"
          value={filters.to}
          onChange={(e) => change({ to: e.target.value })}
        />
      </div>

      {filters.clientId !== '' ? (
        <p className="small muted">
          Showing one record only.{' '}
          <button type="button" className="audit__link" onClick={() => change({ clientId: '' })}>
            Show every record
          </button>
        </p>
      ) : null}

      {state.kind === 'loading' ? <Note>Loading the trail.</Note> : null}
      {state.kind === 'refused' ? (
        <Note tone="critical">The practice&rsquo;s trail is not yours to read.</Note>
      ) : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The trail could not be loaded. Try again.</Note>
      ) : null}

      {reportFor ? (
        <AccessReport key={reportFor} clientId={reportFor} onClose={() => setReportFor(null)} />
      ) : null}

      {state.kind === 'ready' && state.events.length === 0 ? (
        <Note>Nothing in the trail matches that.</Note>
      ) : null}

      {groups.map((group) => (
        <div key={group.day} className="audit__group">
          <h2 className="audit__day">{group.day}</h2>
          <ul className="audit__list">
            {group.events.map((event) => (
              <li key={event.id} className="audit__event">
                <span className="audit__time numeric">
                  {timeFormat.format(new Date(event.occurredAt))}
                </span>
                <span className="audit__sentence">
                  {event.sentence}
                  {event.reason ? (
                    <span className="audit__reason small muted">{event.reason}</span>
                  ) : null}
                </span>
                <span className="audit__record small muted">
                  {label(ENTITY_LABELS, event.entityType)}
                  {event.clientMrn ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="audit__link numeric"
                        onClick={() => change({ clientId: event.clientId ?? '' })}
                      >
                        {event.clientMrn}
                      </button>{' '}
                      <button
                        type="button"
                        className="audit__link"
                        onClick={() => setReportFor(event.clientId)}
                      >
                        Who has opened it
                      </button>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {state.kind === 'ready' && state.hasMore ? (
        <div className="audit__more">
          <Button onClick={() => void loadMore()} disabled={state.loadingMore}>
            {state.loadingMore ? 'Loading' : 'Show earlier'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
