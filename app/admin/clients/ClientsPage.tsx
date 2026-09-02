import { useEffect, useMemo, useState } from 'react';
import { CLIENT_STATUSES, ClientListResponse, type ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Field, Note, PageHeader, Select } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';

/**
 * The admin console's client table (docs/SPEC/client-record.md section 4.1),
 * with the columns the data can fill today. Seeded by the trunk in PR 5; the
 * client-record worktree owns it from there.
 */

const EMIRATES: Record<string, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};

const RELATIONSHIPS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; response: ClientListResponse };

export function ClientsPage() {
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<string>('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (query.trim()) params.set('q', query.trim());
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const timer = setTimeout(() => {
      void apiFetch(`/api/clients${suffix}`)
        .then(async (res) => {
          if (!live) return;
          if (!res.ok) {
            setState({ kind: 'error', message: 'The client list could not be loaded. Try again.' });
            return;
          }
          setState({ kind: 'ready', response: ClientListResponse.parse(await res.json()) });
        })
        .catch(() => {
          if (live)
            setState({ kind: 'error', message: 'The client list could not be loaded. Try again.' });
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [apiFetch, status, query]);

  const columns = useMemo<Column<ClientRow>[]>(
    () => [
      { key: 'mrn', header: 'Record', numeric: true, render: (row) => row.mrn },
      {
        key: 'name',
        header: 'Name',
        render: (row) => (
          <span className="name">
            <span>
              {row.givenName} {row.familyName}
            </span>
            {row.givenNameAr ? (
              <span className="name__ar small muted" lang="ar" dir="rtl">
                {row.givenNameAr} {row.familyNameAr}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'age',
        header: 'Age',
        numeric: true,
        render: (row) => (row.age === null ? '' : String(row.age)),
      },
      { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
      {
        key: 'contact',
        header: 'Primary contact',
        render: (row) =>
          row.contact ? (
            <span className="contact">
              <span>{RELATIONSHIPS[row.contact.relationship] ?? row.contact.relationship}</span>
              {row.contact.phone ? (
                <span className="numeric muted">{row.contact.phone}</span>
              ) : null}
            </span>
          ) : (
            ''
          ),
      },
      {
        key: 'emirate',
        header: 'Emirate',
        render: (row) => (row.emirate ? (EMIRATES[row.emirate] ?? row.emirate) : ''),
      },
    ],
    [],
  );

  const count = state.kind === 'ready' ? state.response.clients.length : null;

  return (
    <section className="page">
      <PageHeader
        title="Clients"
        aside={
          count === null ? null : (
            <span className="numeric">{count === 1 ? '1 client' : `${count} clients`}</span>
          )
        }
      />
      <div className="toolbar">
        <Field
          id="client-search"
          className="field--search"
          label="Search"
          type="search"
          autoFocus={
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(min-width: 720px)').matches
          }
          placeholder="Name or record number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          id="client-status"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any status</option>
          {CLIENT_STATUSES.filter((s) => s !== 'erased').map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      {state.kind === 'loading' ? <Note>Loading the client list.</Note> : null}
      {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}
      {state.kind === 'ready' ? (
        <Table
          caption="Clients of the practice"
          columns={columns}
          rows={state.response.clients}
          rowKey={(row) => row.id}
          empty={
            state.response.note === 'schedule'
              ? 'You see the clients on your schedule, and there is no schedule yet. The scheduling work brings it.'
              : 'No clients match.'
          }
        />
      ) : null}
    </section>
  );
}
