import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { isEmiratesIdShaped } from '../../api/clients/emirates-id-shape';
import { ClientListResponse, type ClientRow } from '../../api/clients/schema';
import { useAuth } from '../auth/AuthContext';
import { SearchIcon } from './Icons';
import type { RailSection } from './Rail';
import { ClientStatusChip } from './StatusChip';

/**
 * Quick-find (the critique of 2026-10-18, heuristic 7): from anywhere in the
 * console, Ctrl K or Cmd K, or Find on the rail, opens one field that finds a
 * section the person may open, or a client by name or record number.
 *
 * **Nothing new is read.** Clients come from the same list route the Clients
 * page searches, which checks `client.list`, filters by row-level security
 * and audits each row it returns, exactly as typing into that page's search
 * does. A person who may not list clients is never sent a request: the
 * layout passes `mayFindClients` from the same rule the rail shows Clients by.
 * Anything shaped like an Emirates ID is never sent from here, whole or in
 * part: the list route refuses one in a query string, but by then a proxy
 * has logged the URL. Those lookups stay on the Clients page, which checks
 * the number whole and posts it. Only as many clients are asked for as are
 * shown, because every row returned is audited as read.
 *
 * Mounted only while open, so closing forgets what was typed; focus goes back
 * to whatever had it before.
 *
 * A floating surface (DESIGN.md, level 2): the native modal `<dialog>`, which
 * traps focus and closes on Escape.
 * The results are a listbox driven from the field (`aria-activedescendant`),
 * so arrow keys move through them without the focus leaving the field.
 */

type Result =
  | { kind: 'section'; key: string; label: string; to: string }
  | { kind: 'client'; key: string; row: ClientRow };

/** Two characters before a client search is sent: one matches half the practice. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;
const MAX_CLIENTS = 8;

/** The sections whose names contain the words typed, in the rail's order. */
export function matchSections(sections: readonly RailSection[], query: string): Result[] {
  const term = query.trim().toLowerCase();
  const all = sections.flatMap((section) => [
    { kind: 'section' as const, key: section.key, label: section.label, to: section.to },
    ...(section.children ?? [])
      .filter((child) => !child.document)
      .map((child) => ({
        kind: 'section' as const,
        key: `${section.key}/${child.key}`,
        label: `${section.label}: ${child.label}`,
        to: child.to,
      })),
  ]);
  if (term === '') return all.filter((result) => !result.key.includes('/'));
  return all.filter((result) => result.label.toLowerCase().includes(term));
}

export function QuickFind({
  onClose,
  sections,
  mayFindClients,
}: {
  onClose: () => void;
  sections: readonly RailSection[];
  mayFindClients: boolean;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const { apiFetch } = useAuth();
  const listId = useId();
  const [query, setQuery] = useState('');
  // An answer belongs to the term it was asked for. Until the answer for what
  // is in the field now arrives, no client is offered, so Enter can never open
  // a client who matched an earlier term.
  const [answer, setAnswer] = useState<
    { term: string; kind: 'error' } | { term: string; kind: 'ready'; rows: ClientRow[] } | null
  >(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // `showModal` is missing in some test environments; the attribute is what
    // it would have set.
    if (element && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    field.current?.focus();
    return () => {
      before?.focus();
    };
  }, []);

  // The client search, debounced; an answer that arrives after the field has
  // moved on is kept under its own term and never shown.
  const term = query.trim();
  const idShaped = isEmiratesIdShaped(term);
  const searching = mayFindClients && term.length >= MIN_QUERY && !idShaped;
  useEffect(() => {
    if (!searching) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: term, limit: String(MAX_CLIENTS) });
      void apiFetch(`/api/clients?${params.toString()}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          return ClientListResponse.parse(await res.json()).clients;
        })
        .then((rows) => {
          if (live) setAnswer({ term, kind: 'ready', rows });
        })
        .catch(() => {
          if (live) setAnswer({ term, kind: 'error' });
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [apiFetch, searching, term]);

  const currentAnswer = searching && answer?.term === term ? answer : null;
  const found = currentAnswer?.kind === 'ready' ? currentAnswer.rows : null;

  const results = useMemo<Result[]>(() => {
    const sectionResults = matchSections(sections, query);
    if (!found) return sectionResults;
    return [
      ...found.map((row) => ({ kind: 'client' as const, key: row.id, row })),
      ...sectionResults,
    ];
  }, [found, query, sections]);

  const current = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (result: Result) => `${listId}-${result.kind}-${result.key}`;
  const activeResult = results[current];

  // The highlighted result stays in view as the arrow keys move through a list
  // longer than the panel.
  useEffect(() => {
    if (!activeResult) return;
    document.getElementById(optionId(activeResult))?.scrollIntoView?.({ block: 'nearest' });
    // optionId is derived from listId, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeResult]);

  function close() {
    onClose();
  }

  function choose(result: Result) {
    close();
    if (result.kind === 'section') navigate(result.to);
    else navigate(`/admin/clients?client=${result.row.id}&section=overview`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const result = results[current];
      if (result) {
        event.preventDefault();
        choose(result);
      }
    }
  }

  const status = !mayFindClients
    ? null
    : idShaped
      ? 'To find someone by Emirates ID, use the search on the Clients page.'
      : term.length === 0
        ? null
        : term.length < MIN_QUERY
          ? 'Type one more letter to search clients.'
          : currentAnswer === null
            ? 'Searching clients.'
            : currentAnswer.kind === 'error'
              ? 'Clients could not be searched. Try again.'
              : currentAnswer.rows.length === 0
                ? 'No clients match.'
                : currentAnswer.rows.length === 1
                  ? '1 client found.'
                  : `${currentAnswer.rows.length} clients found.`;

  return (
    <dialog
      ref={dialog}
      className="quick-find"
      aria-label="Find"
      onClose={() => {
        // Escape closes the dialog natively; keep the layout's state in step.
        close();
      }}
      onClick={(event) => {
        // A press on the backdrop, outside the panel, closes it.
        if (event.target === dialog.current) close();
      }}
    >
      <div className="quick-find__panel">
        <div className="quick-find__field">
          <SearchIcon />
          <input
            ref={field}
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeResult ? optionId(activeResult) : undefined}
            aria-autocomplete="list"
            aria-label={mayFindClients ? 'Find a client or a section' : 'Find a section'}
            placeholder={
              mayFindClients
                ? 'Client name, record number or a section'
                : 'A section of the console'
            }
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="quick-find__results">
          {results.map((result, index) => (
            <li
              key={`${result.kind}-${result.key}`}
              id={optionId(result)}
              role="option"
              aria-selected={index === current}
              className={
                index === current
                  ? 'quick-find__option quick-find__option--active'
                  : 'quick-find__option'
              }
              onMouseMove={() => setActive(index)}
              onClick={() => choose(result)}
            >
              {result.kind === 'client' ? (
                <>
                  <span className="quick-find__name">
                    {result.row.givenName} {result.row.familyName}
                  </span>
                  <span className="quick-find__meta small numeric">{result.row.mrn}</span>
                  <span className="quick-find__meta small">
                    <ClientStatusChip status={result.row.status} />
                  </span>
                </>
              ) : (
                <>
                  <span className="quick-find__name">{result.label}</span>
                  <span className="quick-find__meta small">Section</span>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="quick-find__status small" role="status">
          {status}
        </p>
      </div>
    </dialog>
  );
}
