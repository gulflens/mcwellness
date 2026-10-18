import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
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
 * Emirates ID lookups stay on the Clients page, where the number is checked
 * whole before anything is sent.
 *
 * A floating surface (DESIGN.md, level 2): the native modal `<dialog>`, which
 * traps focus, closes on Escape and hands focus back to whatever opened it.
 * The results are a listbox driven from the field (`aria-activedescendant`),
 * so arrow keys move through them without the focus leaving the field.
 */

type Result =
  | { kind: 'section'; key: string; label: string; to: string }
  | { kind: 'client'; key: string; row: ClientRow };

/** Two characters before a client search is sent: one matches half the practice. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;
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
  open,
  onClose,
  sections,
  mayFindClients,
}: {
  open: boolean;
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
  const [clients, setClients] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; rows: ClientRow[] }
  >({ kind: 'idle' });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // `showModal` is missing in some test environments; the attribute is what
    // it would have set.
    if (open && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
      field.current?.focus();
    } else if (!open && element.open) {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [open]);

  // The client search, debounced, and dropped if a newer one has started.
  const term = query.trim();
  const searching = mayFindClients && term.length >= MIN_QUERY;
  useEffect(() => {
    if (!open || !searching) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setClients({ kind: 'loading' });
      void apiFetch(`/api/clients?q=${encodeURIComponent(term)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          return ClientListResponse.parse(await res.json()).clients.slice(0, MAX_CLIENTS);
        })
        .then((rows) => {
          if (live) setClients({ kind: 'ready', rows });
        })
        .catch(() => {
          if (live) setClients({ kind: 'error' });
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [apiFetch, open, searching, term]);

  const results = useMemo<Result[]>(() => {
    const found = matchSections(sections, query);
    if (!searching || clients.kind !== 'ready') return found;
    return [
      ...clients.rows.map((row) => ({ kind: 'client' as const, key: row.id, row })),
      ...found,
    ];
  }, [clients, query, searching, sections]);

  const current = Math.min(active, Math.max(results.length - 1, 0));

  function reset() {
    setQuery('');
    setClients({ kind: 'idle' });
    setActive(0);
  }

  function close() {
    reset();
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

  const optionId = (index: number) => `${listId}-option-${index}`;
  const status = !searching
    ? mayFindClients && term.length > 0
      ? 'Type one more letter to search clients.'
      : null
    : clients.kind === 'loading'
      ? 'Searching clients.'
      : clients.kind === 'error'
        ? 'Clients could not be searched. Try again.'
        : clients.kind === 'ready' && clients.rows.length === 0
          ? 'No clients match.'
          : null;

  return (
    <dialog
      ref={dialog}
      className="quick-find"
      aria-label="Find"
      onClose={() => {
        // Escape closes the dialog natively; keep the layout's state in step.
        if (open) close();
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
            aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
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
              id={optionId(index)}
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
