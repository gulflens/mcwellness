import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { canActor } from '@domain/shared/actor';
import { AccountsResponse, SettingsResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import './books.css';
import { AccountDrawer } from './AccountDrawer';
import { AccountsSection } from './AccountsSection';
import { EntryDrawer } from './EntryDrawer';
import { JournalSection } from './JournalSection';
import { OverviewSection } from './OverviewSection';
import { SettingsSection } from './SettingsSection';
import { StatementsSection } from './StatementsSection';

/**
 * The practice's books, in `BillingPage.tsx`'s exact shape: a page header,
 * sections chosen one at a time and named in the address bar, tables, and a
 * right-side drawer for anything written (docs/SPEC/accounting.md section 5).
 *
 * **The page posts when it opens.** Reads are reads (decision 10): rather than
 * a GET that quietly writes, the page asks `POST /api/accounting/post` once
 * when somebody who may write opens it, and reads the overview after. A person
 * who may only read the books sees them as the last posting run left them.
 *
 * Every figure here was computed on the server and is formatted by `money.ts`.
 */

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'journal', label: 'Journal' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'statements', label: 'Statements' },
  { key: 'settings', label: 'Settings' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

/** The section named in the address bar, or the first one. */
function sectionFrom(hash: string): SectionKey {
  const named = hash.replace(/^#/, '');
  return SECTIONS.some((entry) => entry.key === named) ? (named as SectionKey) : 'overview';
}

export function BooksPage() {
  const { apiFetch, session } = useAuth();
  // **The address is the section.** It was a piece of state with the address
  // written behind it, which cost this page a listener and could not hear the
  // rail at all: the rail links to a section by hash
  // (app/shell/components/Rail.tsx), and an in-app navigation fires no
  // `hashchange`, so the page would have sat on overview while the rail marked
  // something else. Read from the router instead, there is one fact, and the
  // tabs below and the rail beside each other cannot disagree.
  const { hash } = useLocation();
  const navigate = useNavigate();
  const section = sectionFrom(hash);
  const setSection = useCallback(
    (next: SectionKey) => {
      // Replace, not push: moving between the sections of one screen is not a
      // place in the history, and Back should leave the screen rather than walk
      // the tabs the reader has already looked at.
      navigate({ hash: `#${next}` }, { replace: true });
    },
    [navigate],
  );

  // A hash typed into the address bar is a same-document navigation: it fires
  // `hashchange` and no `popstate`, which is the one change the router cannot
  // see by itself. Handing it straight back to the router keeps a single
  // source for the section, and a reload or a link sent to a colleague still
  // lands where it says it will.
  useEffect(() => {
    const onHashChange = () => navigate({ hash: window.location.hash }, { replace: true });
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigate]);

  const actor = session.status === 'signed-in' ? session.actor : null;
  // The same rule the API enforces (domain/shared/actor.ts, 'accounting.write'):
  // the owner and finance post; nobody else writes in the books.
  const canWrite = actor !== null && canActor(actor, { type: 'accounting.write' }, {}, new Date());
  // Closing a year, moving the lock and the books' own settings are the
  // owner's alone (docs/SPEC/accounting.md section 3).
  const canChangeSettings =
    actor !== null && canActor(actor, { type: 'accounting.settings.write' }, {}, new Date());

  // Null until the opening posting call has answered, so the overview's own
  // read follows the write rather than racing it.
  const [posted, setPosted] = useState<number | null>(null);
  const [journalKey, setJournalKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  const [chart, setChart] = useState<AccountsResponse['accounts'] | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  const post = useCallback(async (): Promise<void> => {
    await apiFetch('/api/accounting/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reason': 'Opening the books' },
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }, [apiFetch]);

  useEffect(() => {
    // Only once the session has resolved: until then `actor` is null, `canWrite`
    // reads false, and the page would read the overview before it had posted.
    if (session.status !== 'signed-in' || posted !== null) {
      return;
    }
    if (!canWrite) {
      // Nothing to post, and nothing to wait for. The marker is set in a
      // promise rather than synchronously, so no state is set during an effect's
      // own render pass (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setPosted(Date.now()));
      return;
    }
    void post().then(() => setPosted(Date.now()));
  }, [canWrite, post, posted, session.status]);

  /** The chart and the settings, which the entry drawer needs and the page holds once. */
  const loadForDrawer = useCallback(() => {
    void apiFetch('/api/accounting/accounts')
      .then(async (res) => {
        if (!res.ok) return;
        setChart(AccountsResponse.parse(await res.json()).accounts);
      })
      .catch(() => undefined);
    void apiFetch('/api/accounting/settings')
      .then(async (res) => {
        if (!res.ok) return;
        setSettings(SettingsResponse.parse(await res.json()));
      })
      .catch(() => undefined);
  }, [apiFetch]);

  const openDrawer = useCallback(() => {
    setSuccessNote(null);
    loadForDrawer();
    setDrawerOpen(true);
  }, [loadForDrawer]);

  return (
    <section className="page">
      <PageHeader
        title="Books"
        action={
          <span className="header-action">
            {section === 'journal' && canWrite ? (
              <Button variant="secondary" onClick={openDrawer}>
                Post an entry
              </Button>
            ) : null}
            {section === 'accounts' && canWrite ? (
              <Button variant="secondary" onClick={() => setAccountDrawerOpen(true)}>
                Add account
              </Button>
            ) : null}
          </span>
        }
      />

      <nav className="sections" aria-label="Books sections">
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`sections__tab${section === entry.key ? ' sections__tab--current' : ''}`}
            aria-current={section === entry.key ? 'page' : undefined}
            onClick={() => setSection(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {successNote ? (
        <div role="status">
          <Note>{successNote}</Note>
        </div>
      ) : null}

      {section === 'overview' ? (
        <OverviewSection canWrite={canWrite} ready={posted !== null} onPost={post} />
      ) : null}

      {section === 'journal' ? (
        <JournalSection
          canWrite={canWrite}
          reloadKey={journalKey}
          onReloaded={() => setJournalKey((key) => key + 1)}
        />
      ) : null}

      {section === 'accounts' ? <AccountsSection reloadKey={chartKey} /> : null}
      {section === 'statements' ? <StatementsSection /> : null}
      {section === 'settings' ? <SettingsSection canChange={canChangeSettings} /> : null}

      {drawerOpen && chart && settings ? (
        <EntryDrawer
          accounts={chart}
          settings={settings}
          onClose={() => setDrawerOpen(false)}
          onPosted={(entry) => {
            setDrawerOpen(false);
            setSuccessNote(`${entry.entry.reference} is in the journal.`);
            setJournalKey((key) => key + 1);
          }}
        />
      ) : null}

      {accountDrawerOpen ? (
        <AccountDrawer
          onClose={() => setAccountDrawerOpen(false)}
          onAdded={(added) => {
            setAccountDrawerOpen(false);
            setSuccessNote(`${added.account.code} ${added.account.name} is in the chart.`);
            setChartKey((key) => key + 1);
          }}
        />
      ) : null}
    </section>
  );
}
