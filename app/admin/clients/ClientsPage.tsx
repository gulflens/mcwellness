import { useCallback, useEffect, useMemo, useState } from 'react';
import { isEmiratesIdShaped, wholeEmiratesIdDigits } from '../../api/clients/emirates-id-shape';
import { CLIENT_STATUSES, ClientListResponse, type ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader, Select } from '../../shell/components/Controls';
import { ClientStatusChip } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import './clients.css';
import { ClientDrawer } from './ClientDrawer';
import { EnrolmentWizard } from './EnrolmentWizard';

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

const LOAD_ERROR = 'The client list could not be loaded. Try again.';
// Says what the box has decided and why, without asserting what the person is
// typing: a record-number search that happens to open 784 gets the same line,
// and being told "an Emirates ID is fifteen digits" would be a claim about
// their own intent rather than a description of the rule.
const PARTIAL_EMIRATES_ID_HINT =
  'Numbers starting 784 are searched as an Emirates ID, and only once all fifteen digits are in. For a record number, type it as MW-000123.';
const IDENTITY_UNAVAILABLE =
  'Searching by Emirates ID is not set up on this installation yet. Search by name or record number.';

/**
 * An Emirates ID half typed: shaped like one, but not yet whole. It must
 * never be sent as a text search, because the fourteenth keystroke would put
 * fourteen of the fifteen digits in a query string — the very thing the
 * lookup route exists to avoid, leaked long before the last digit switched
 * transport. The shape rule itself lives beside the route that enforces the
 * same one (app/api/clients/emirates-id-shape.ts).
 */
function isPartialEmiratesId(term: string): boolean {
  return isEmiratesIdShaped(term) && wholeEmiratesIdDigits(term) === null;
}

/**
 * An Emirates ID is never put in the address: it goes to POST
 * /api/clients/lookup in a request body, where no proxy's access log can pick
 * it up (.claude/rules/ui.md; app/api/clients/list.ts says the same from the
 * other side). Anything else is the ordinary `?q=` search over names and
 * record numbers.
 *
 * The status filter is not applied to a lookup, deliberately: an identity
 * number names at most one client, and filtering it away would answer "no
 * such client" to someone holding that person's card.
 */
export function searchRequest(
  status: string,
  query: string,
): { url: string; init?: RequestInit } | 'partial-emirates-id' {
  const term = query.trim();
  const digits = wholeEmiratesIdDigits(term);
  if (digits !== null) {
    return {
      url: '/api/clients/lookup',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emiratesId: digits }),
      },
    };
  }
  // Nothing is sent at all until the number is whole. The table keeps whatever it
  // was showing, and a line under the box says what is still wanted.
  if (isPartialEmiratesId(term)) return 'partial-emirates-id';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (term) params.set('q', term);
  return { url: `/api/clients${params.size > 0 ? `?${params.toString()}` : ''}` };
}

export function ClientsPage() {
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<string>('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  // Bumped after the enrolment wizard closes, so the table picks up the lead it just
  // created (or any later step's write) without duplicating the fetch effect below.
  const [reloadToken, setReloadToken] = useState(0);
  // Closing the drawer reloads the table: a status changed on Overview (a lead
  // activated) must not leave the row behind it still saying what it said before.
  const closeDrawer = useCallback(() => {
    setSelected(null);
    setReloadToken((t) => t + 1);
  }, []);
  const selectClient = useCallback((row: ClientRow) => {
    setEnrolling(false);
    setSelected(row);
  }, []);
  const openWizard = useCallback(() => {
    setSelected(null);
    setEnrolling(true);
  }, []);
  const closeWizard = useCallback(() => {
    setEnrolling(false);
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    let live = true;
    const request = searchRequest(status, query);
    if (request === 'partial-emirates-id') return;
    const timer = setTimeout(() => {
      void apiFetch(request.url, request.init)
        .then(async (res) => {
          if (!live) return;
          if (!res.ok) {
            setState({
              kind: 'error',
              message: res.status === 503 ? IDENTITY_UNAVAILABLE : LOAD_ERROR,
            });
            return;
          }
          setState({ kind: 'ready', response: ClientListResponse.parse(await res.json()) });
        })
        .catch(() => {
          if (live) setState({ kind: 'error', message: LOAD_ERROR });
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [apiFetch, status, query, reloadToken]);

  const columns = useMemo<Column<ClientRow>[]>(
    () => [
      { key: 'mrn', header: 'Record', numeric: true, render: (row) => row.mrn },
      {
        key: 'name',
        header: 'Name',
        render: (row) => (
          <span className="name">
            <button type="button" className="link" onClick={() => selectClient(row)}>
              {row.givenName} {row.familyName}
            </button>
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
      {
        key: 'status',
        header: 'Status',
        render: (row) => <ClientStatusChip status={row.status} />,
      },
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
    [selectClient],
  );

  const count = state.kind === 'ready' ? state.response.clients.length : null;
  const partialEmiratesId = isPartialEmiratesId(query.trim());

  return (
    <section className="page">
      <PageHeader
        title="Clients"
        aside={
          count === null ? null : (
            <span className="numeric">{count === 1 ? '1 client' : `${count} clients`}</span>
          )
        }
        action={
          <Button variant="primary" onClick={openWizard}>
            Enrol a client
          </Button>
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
          placeholder="Name, record number or Emirates ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          hint={partialEmiratesId ? PARTIAL_EMIRATES_ID_HINT : undefined}
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
      {selected ? <ClientDrawer key={selected.id} client={selected} onClose={closeDrawer} /> : null}
      {enrolling ? <EnrolmentWizard onDone={closeWizard} /> : null}
    </section>
  );
}
