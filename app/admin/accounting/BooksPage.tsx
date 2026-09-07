import { useCallback, useEffect, useState } from 'react';
import { canActor } from '@domain/shared/actor';
import { AccountsResponse, SettingsResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import './books.css';
import { EntryDrawer } from './EntryDrawer';
import { JournalSection } from './JournalSection';
import { OverviewSection } from './OverviewSection';

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
function sectionFromHash(): SectionKey {
  const named = window.location.hash.replace(/^#/, '');
  return SECTIONS.some((entry) => entry.key === named) ? (named as SectionKey) : 'overview';
}

export function BooksPage() {
  const { apiFetch, session } = useAuth();
  const [section, setSectionState] = useState<SectionKey>(sectionFromHash);
  const setSection = useCallback((next: SectionKey) => {
    setSectionState(next);
    window.history.replaceState(null, '', `#${next}`);
  }, []);

  useEffect(() => {
    const onHashChange = () => setSectionState(sectionFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const actor = session.status === 'signed-in' ? session.actor : null;
  // The same rule the API enforces (domain/shared/actor.ts, 'accounting.write'):
  // the owner and finance post; nobody else writes in the books.
  const canWrite = actor !== null && canActor(actor, { type: 'accounting.write' }, {}, new Date());

  // Null until the opening posting call has answered, so the overview's own
  // read follows the write rather than racing it.
  const [posted, setPosted] = useState<number | null>(null);
  const [journalKey, setJournalKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

      {section === 'accounts' ? <Note>The chart of accounts is on its way.</Note> : null}
      {section === 'statements' ? <Note>The statements are on their way.</Note> : null}
      {section === 'settings' ? <Note>The books&apos; settings are on their way.</Note> : null}

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
    </section>
  );
}
