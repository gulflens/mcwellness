import { canActor } from '@domain/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
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

/**
 * "Who has opened this record", to the Audit screen with this record named.
 *
 * **The press round 31 owed.** Round 31 reached the access report from a line
 * of the activity feed, which is not one press for a household with no line in
 * the pages that happen to be loaded; its fix round said the press belongs
 * beside the record's own timeline, where somebody already looking at a
 * household can ask who else has been
 * (docs/CHANGE-REQUESTS/trunk-notes.md, round 31's fix round, section 3;
 * docs/SPEC/audit.md section 9, view 4).
 *
 * **Shown only to whoever may read the report.** `audit.read` is the owner's,
 * an administrator's and the lead practitioner's; finance sees this tab and
 * reads money rather than the trail, so finance is not offered a link the
 * route would refuse. It is a courtesy and not a boundary — the route
 * (`app/api/audit/activity.ts`) and the row policy
 * (`db/policies/core/audit_log.sql`) are the boundary.
 *
 * The address is `/admin/audit`, which is where `app/shell/App.tsx` mounts the
 * screen, with the record as an opaque id: a uuid is not personal data, which
 * is what `.claude/rules/ui.md` keeps out of a query string.
 */
function WhoHasOpenedIt({ clientId }: { clientId: string }) {
  const { session } = useAuth();
  const actor = session.status === 'signed-in' ? session.actor : null;
  if (actor === null || !canActor(actor, { type: 'audit.read', clientId }, {}, new Date())) {
    return null;
  }
  return (
    <p className="timeline__access">
      <Link className="link" to={`/admin/audit?report=${clientId}`}>
        Who has opened this record
      </Link>
    </p>
  );
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

  // The press stands at the head of the tab whatever the feed below it is
  // doing: who has opened a record is a different question from what the
  // record's own trail says, and it is worth asking of a record nothing has
  // touched and of one whose timeline would not load.
  const head = <WhoHasOpenedIt clientId={clientId} />;

  if (state.kind === 'loading')
    return (
      <section className="timeline" aria-label="Timeline">
        {head}
        <Note>Loading the timeline.</Note>
      </section>
    );
  if (state.kind === 'error')
    return (
      <section className="timeline" aria-label="Timeline">
        {head}
        <Note tone="critical">The timeline could not be loaded. Try again.</Note>
      </section>
    );
  if (state.events.length === 0)
    return (
      <section className="timeline" aria-label="Timeline">
        {head}
        <Note>Nothing has touched this record yet.</Note>
      </section>
    );

  return (
    <section className="timeline" aria-label="Timeline">
      {head}
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
