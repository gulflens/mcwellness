import { visitOutcomeWord } from '../../domain/portal';
import { VisitsResponse, type PortalClient, type Visit } from '../api/portal/schema';
import { Note } from '../shell/components/Controls';
import { StatusChip, type StatusTone } from '../shell/components/StatusChip';
import { Sections } from './Layout';
import { useWords } from './i18n';
import { usePortalRead } from './usePortal';

/**
 * `/portal/visits` — when the practitioner is coming, and when they came
 * (docs/SPEC/client-portal.md section 3.2).
 *
 * Upcoming first, soonest first; past beneath, most recent first. The route
 * decides which visits appear at all and in what order — that is
 * `domain/portal`'s `visitsFor` — and this screen decides only how they read.
 *
 * **A window, never a point time.** "10:00 to 10:45" is what the practice
 * promises and what the household should expect; a single time would be a
 * promise nobody made.
 *
 * The outcome is a word with a dot beside it, the only hue on the screen, and
 * `cancelled_late` reads as "Cancelled" and nothing more: the fee, if the
 * practice charged one, is the money screen's business and a second word here
 * would be the portal telling somebody off.
 */

/** The three outcomes, in the three tones the shared chip already has. */
const TONE: Record<string, StatusTone> = {
  completed: 'ok',
  missed: 'attention',
  cancelled: 'neutral',
};

function VisitRow({ visit }: { visit: Visit }) {
  const words = useWords();
  const service =
    words.locale === 'ar' && visit.serviceNameAr ? visit.serviceNameAr : visit.serviceName;
  return (
    <div className="portal__row">
      <span className="numeric">{words.date(visit.date)}</span>
      <span>{service}</span>
      {visit.outcome === null ? (
        <>
          <span className="numeric">{words.window(visit.windowStart, visit.windowEnd)}</span>
          <span className="small muted">{words.delivery(visit.deliveryMode)}</span>
        </>
      ) : (
        <StatusChip
          label={visitOutcomeWord(visit.outcome, words.locale)}
          tone={TONE[visit.outcome] ?? 'neutral'}
        />
      )}
    </div>
  );
}

export function VisitsScreen() {
  const words = useWords();
  const visits = usePortalRead('/api/portal/visits', VisitsResponse);

  if (visits.kind === 'loading') return <Note>{words.t('loading')}</Note>;
  if (visits.kind === 'refused') return <Note tone="critical">{words.t('notYours')}</Note>;
  if (visits.kind === 'error') return <Note tone="critical">{words.t('loadFailed')}</Note>;

  const { clients, upcoming, past } = visits.data;

  const list = (rows: readonly Visit[], client: PortalClient) => {
    const mine = rows.filter((visit) => visit.clientId === client.id);
    return mine.length === 0 ? null : (
      <div className="portal__list">
        {mine.map((visit) => (
          <VisitRow key={visit.id} visit={visit} />
        ))}
      </div>
    );
  };

  return (
    <>
      <section className="portal__section">
        <h1>{words.t('upcoming')}</h1>
        {upcoming.length === 0 ? (
          <Note>{words.t('nothingUpcoming')}</Note>
        ) : (
          <Sections clients={clients} render={(client) => list(upcoming, client)} />
        )}
      </section>

      <section className="portal__section">
        <h2>{words.t('past')}</h2>
        {past.length === 0 ? (
          <Note>{words.t('nothingPast')}</Note>
        ) : (
          <Sections clients={clients} render={(client) => list(past, client)} />
        )}
      </section>
    </>
  );
}
