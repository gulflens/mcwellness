import type { HomeResponse, MoneySummary, Notice, PortalClient } from '../api/portal/schema';
import { Note } from '../shell/components/Controls';
import { ClientHeading, Screen, Sections } from './Layout';
import { PHRASES, useWords } from './i18n';
import { usePortalHome } from './PortalRoot';

/**
 * `/portal` — the screen somebody opens at eleven at night
 * (docs/SPEC/client-portal.md section 3.1).
 *
 * The next visit, what each client's money comes to, anything waiting on the
 * household, and how to ask for a visit. In that order, because that is the
 * order the questions arrive in.
 *
 * **The portal does not book, and does not pretend to.** The last block is one
 * sentence and a WhatsApp button on the practice's own number, composed in the
 * browser and opened in the person's own WhatsApp — a hand-off in the sending
 * seam's sense (docs/SEAMS.md), with nothing leaving this server. A practice
 * that has recorded no number gets the sentence and no button.
 */

/** The `wa.me` link, built at the moment it is pressed and never rendered early. */
function whatsAppHref(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}`;
}

function MoneyLine({ money }: { money: MoneySummary }) {
  const words = useWords();
  const owed = money.outstandingFils;
  const label = owed > 0 ? words.t('owed') : owed < 0 ? words.t('inCredit') : words.t('settled');
  return (
    <dl className="portal__facts">
      <dt>{label}</dt>
      <dd>
        {owed === 0 ? (
          <span>{words.t('amountsInAed')}</span>
        ) : (
          <span className="numeric portal__figure">{words.money(Math.abs(owed))}</span>
        )}
      </dd>
      {money.sessionsTotal !== null && money.sessionsUsed !== null ? (
        <>
          <dt>{words.t('packages')}</dt>
          <dd className="numeric">
            {words.phrase(PHRASES.sessionOf(money.sessionsUsed, money.sessionsTotal))}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const words = useWords();
  if (notice.kind === 'consent_newer_wording') {
    return (
      <div className="portal__row">
        <span>{words.purpose(notice.detail)}</span>
        <span className="portal__row-note small">{words.t('newerWording')}</span>
      </div>
    );
  }
  return (
    <div className="portal__row">
      <span>
        {notice.detail === 'erasure' ? words.t('askForErasure') : words.t('askToWithdraw')}
      </span>
      <span className="portal__row-note small">
        {notice.kind === 'request_open' ? words.t('requestOpen') : words.t('requestHandled')}
      </span>
    </div>
  );
}

export function HomeScreen() {
  const words = useWords();
  const home = usePortalHome();

  if (home.kind === 'loading') return <Note>{words.t('loading')}</Note>;
  if (home.kind === 'refused') return <Note tone="critical">{words.t('notYours')}</Note>;
  if (home.kind === 'error') return <Note tone="critical">{words.t('loadFailed')}</Note>;

  const data: HomeResponse = home.data;
  const next = data.nextVisit;
  const nextClient = data.clients.find((client) => client.id === next?.clientId) ?? null;
  const several = data.clients.length > 1;

  return (
    <Screen>
      <section className="portal__section">
        <h1>{words.t('nextVisit')}</h1>
        {next === null ? (
          <Note>{words.t('nothingBooked')}</Note>
        ) : (
          <dl className="portal__facts">
            {several && nextClient ? (
              <>
                <dt>{words.t('portal')}</dt>
                <dd>{nextClient.name}</dd>
              </>
            ) : null}
            <dt>{words.t('date')}</dt>
            <dd className="numeric">{words.date(next.date)}</dd>
            <dt>{words.t('arrivalWindow')}</dt>
            <dd className="numeric">{words.window(next.windowStart, next.windowEnd)}</dd>
            <dt>{words.t('visits')}</dt>
            <dd>
              {words.locale === 'ar' && next.serviceNameAr ? next.serviceNameAr : next.serviceName}
            </dd>
            <dt>{words.t('addressLabel')}</dt>
            <dd>{words.delivery(next.deliveryMode)}</dd>
          </dl>
        )}
      </section>

      {data.money.length > 0 ? (
        <section className="portal__section">
          <h2>{words.t('balance')}</h2>
          <Sections
            clients={data.clients.filter((client) => client.moneyVisible)}
            render={(client: PortalClient) => {
              const money = data.money.find((row) => row.clientId === client.id);
              return money ? <MoneyLine money={money} /> : null;
            }}
          />
        </section>
      ) : null}

      {data.notices.length > 0 ? (
        <section className="portal__section">
          <h2>{words.t('waitingOnYou')}</h2>
          <Sections
            clients={data.clients}
            render={(client: PortalClient) => {
              const notices = data.notices.filter((notice) => notice.clientId === client.id);
              return notices.length === 0 ? null : (
                <div className="portal__list">
                  {notices.map((notice) => (
                    <NoticeLine key={`${notice.kind}-${notice.entityId}`} notice={notice} />
                  ))}
                </div>
              );
            }}
          />
        </section>
      ) : null}

      <section className="portal__section">
        <h2>{words.t('askForVisit')}</h2>
        <p>{words.t('askForVisitBody')}</p>
        {data.practice.whatsappNumber === null ? (
          <Note>{words.t('noWhatsapp')}</Note>
        ) : (
          <p className="portal__actions">
            <a
              className="button button--primary"
              href={whatsAppHref(data.practice.whatsappNumber)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {words.t('messageThePractice')}
            </a>
          </p>
        )}
      </section>
    </Screen>
  );
}

export { ClientHeading };
