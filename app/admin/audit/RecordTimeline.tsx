import { useCallback, useEffect, useMemo, useState } from 'react';
import { TimelineResponse, type TimelineEvent } from '../../api/audit/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { describeRoles } from '../../shell/routing';

/**
 * One client's audit trail in sentences (docs/SPEC/audit.md section 9.1):
 * newest first, grouped by day in the practice's time zone. The API composes
 * the sentences; this component only lays them out. Seeded by the trunk in
 * PR 6; owned by the audit-ui worktree (docs/SPEC/OWNERSHIP.md).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const PAGE = 50;

class ReasonRequired extends Error {}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; reasonRequired?: boolean }
  | {
      kind: 'ready';
      events: TimelineEvent[];
      nextBefore: string | null;
      hasMore: boolean;
      loadingMore: boolean;
    };

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

function groupByDay(events: readonly TimelineEvent[]): { day: string; events: TimelineEvent[] }[] {
  const groups: { day: string; events: TimelineEvent[] }[] = [];
  for (const event of events) {
    const day = dayFormat.format(new Date(event.occurredAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.events.push(event);
    } else {
      groups.push({ day, events: [event] });
    }
  }
  return groups;
}

export function RecordTimeline({ clientId }: { clientId: string }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const fetchPage = useCallback(
    async (before: string | null): Promise<TimelineResponse | null> => {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (before) params.set('before', before);
      const res = await apiFetch(`/api/clients/${clientId}/timeline?${params.toString()}`);
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === 'reason_required') throw new ReasonRequired();
      }
      if (!res.ok) return null;
      return TimelineResponse.parse(await res.json());
    },
    [apiFetch, clientId],
  );

  useEffect(() => {
    let live = true;
    fetchPage(null)
      .then((page) => {
        if (!live) return;
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
      .catch((error: unknown) => {
        if (live) setState({ kind: 'error', reasonRequired: error instanceof ReasonRequired });
      });
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (state.kind !== 'ready' || !state.hasMore || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    const page = await fetchPage(state.nextBefore).catch(() => null);
    if (page === null) {
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
  // The roles line is metadata about the actor, not the event: it shows once per run of
  // the same actor and roles, not on every line.
  const rolesShown = useMemo(() => {
    const shown = new Set<string>();
    let previous = '';
    for (const event of state.kind === 'ready' ? state.events : []) {
      const key = event.actor ? `${event.actor.name ?? ''}|${event.actor.roles.join(',')}` : '';
      if (event.actor && event.actor.roles.length > 0 && key !== previous) shown.add(event.id);
      previous = key;
    }
    return shown;
  }, [state]);

  if (state.kind === 'loading') return <Note>Loading the timeline.</Note>;
  if (state.kind === 'error')
    return <Note tone="critical">The timeline could not be loaded. Try again.</Note>;
  if (state.events.length === 0) return <Note>Nothing has touched this record yet.</Note>;

  return (
    <section className="timeline" aria-label="Timeline">
      {groups.map((group) => (
        <div key={group.day} className="timeline__group">
          <h4 className="timeline__day">{group.day}</h4>
          <ol className="timeline__list">
            {group.events.map((event) => (
              <li key={event.id} className={`timeline__event timeline__event--${event.kind}`}>
                <p className="timeline__sentence">{event.sentence}</p>
                <p className="timeline__meta micro">
                  {rolesShown.has(event.id) && event.actor ? (
                    <span>{describeRoles(event.actor.roles)}</span>
                  ) : null}
                  <time className="numeric" dateTime={event.occurredAt}>
                    {timeFormat.format(new Date(event.occurredAt))}
                  </time>
                </p>
                {event.reason ? (
                  <p className="timeline__reason small">Reason: {event.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {state.hasMore ? (
        <div className="timeline__more">
          <Button onClick={() => void loadMore()} disabled={state.loadingMore}>
            Show earlier
          </Button>
        </div>
      ) : null}
    </section>
  );
}
