import { useEffect, useState } from 'react';
import { ClientListResponse, type ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Field, Note } from '../../shell/components/Controls';

/**
 * Finding one family, by record number or by name, through the client list
 * route the client-record stream already owns
 * (`GET /api/clients?q=`) — never a second search of billing's own.
 *
 * A single keystroke does not sweep the practice: the route treats a query
 * shorter than two characters as absent, and this waits a beat before asking
 * at all, so typing a name is one request rather than one per letter.
 */

const MIN_SEARCH_LENGTH = 2;
const SETTLE_MS = 250;

type State =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'error' }
  | { kind: 'ready'; clients: readonly ClientRow[] };

export function ClientPicker({
  id,
  label,
  selected,
  onSelect,
  error,
}: {
  id: string;
  label: string;
  selected: ClientRow | null;
  onSelect: (client: ClientRow | null) => void;
  error?: string;
}) {
  const { apiFetch } = useAuth();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      const timer = setTimeout(() => setState({ kind: 'idle' }), 0);
      return () => clearTimeout(timer);
    }
    let live = true;
    const timer = setTimeout(() => {
      setState({ kind: 'searching' });
      void apiFetch(`/api/clients?q=${encodeURIComponent(trimmed)}`)
        .then(async (res) => {
          if (!live) return;
          if (!res.ok) {
            setState({ kind: 'error' });
            return;
          }
          const body = ClientListResponse.parse(await res.json());
          setState({ kind: 'ready', clients: body.clients });
        })
        .catch(() => {
          if (live) setState({ kind: 'error' });
        });
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [apiFetch, query]);

  if (selected) {
    return (
      <div className="picked">
        <div className="field__label">{label}</div>
        <div className="picked__row">
          <span className="name">
            <span>
              {selected.givenName} {selected.familyName}
            </span>
            <span className="small muted">{selected.mrn}</span>
          </span>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              onSelect(null);
              setQuery('');
              setState({ kind: 'idle' });
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="picker">
      <Field
        id={id}
        label={label}
        type="search"
        value={query}
        placeholder="Record number or name"
        onChange={(event) => setQuery(event.target.value)}
        error={error}
      />
      {state.kind === 'error' ? (
        <Note tone="critical">The client list could not be searched. Try again.</Note>
      ) : null}
      {state.kind === 'ready' && state.clients.length === 0 ? (
        <p className="small muted">No client matches that.</p>
      ) : null}
      {state.kind === 'ready' && state.clients.length > 0 ? (
        <ul className="picker__results">
          {state.clients.slice(0, 8).map((client) => (
            <li key={client.id}>
              <button type="button" className="picker__result" onClick={() => onSelect(client)}>
                <span className="name">
                  <span>
                    {client.givenName} {client.familyName}
                  </span>
                  <span className="small muted">{client.mrn}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
