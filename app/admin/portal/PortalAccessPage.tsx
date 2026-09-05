import { useCallback, useEffect, useState } from 'react';
import {
  AccessResponse,
  InviteResponse,
  OfficeRequestsResponse,
  type AccessRow,
  type InviteResponse as Invite,
  type OfficeRequest,
} from '../../api/portal/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip, type StatusTone } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import './portal.css';

/**
 * Settings › Portal — who has access to which record, and what the households
 * have asked for (docs/SPEC/client-portal.md section 3.8).
 *
 * Two tables, in the admin console's own vocabulary: dense, hairline rules, no
 * cards. The owner and an admin reach it; the route says the same and
 * `db/policies/portal/access.sql` refuses the rows underneath both.
 *
 * **The link is shown once.** The invitation route answers it and never can
 * again — only its sha256 is stored — so the panel below the table shows it
 * plainly with a WhatsApp button beside it. That button composes a `wa.me`
 * address in this browser and opens it in the practice's own WhatsApp: a
 * hand-off, with nothing leaving this server (docs/SEAMS.md).
 *
 * **No telephone number and no email address is in the table.** The columns say
 * whether a contact *has* one, because that decides whether a link can be
 * handed over at all; the number itself is read once, at the moment the
 * practice presses the button, and is never rendered into the page in advance.
 */

const TONE: Record<AccessRow['state'], StatusTone> = {
  none: 'neutral',
  invited: 'attention',
  active: 'ok',
  revoked: 'critical',
};

const STATE_LABELS: Record<AccessRow['state'], string> = {
  none: 'No access',
  invited: 'Invited',
  active: 'Active',
  revoked: 'Revoked',
};

const KIND_LABELS: Record<OfficeRequest['kind'], string> = {
  consent_withdrawal: 'Withdraw a consent',
  erasure: 'Erase the record',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function on(iso: string | null): string {
  return iso === null ? '' : dateFormat.format(new Date(iso));
}

/** The link, once, with the drafted message beside it. */
function IssuedLink({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = invite.message.en;
  const href =
    invite.phone === null
      ? null
      : `https://wa.me/${invite.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
          `${message}\n\n${invite.message.ar}`,
        )}`;

  return (
    <section className="portal-access__issued" aria-live="polite">
      <h3>The link, shown once</h3>
      <p className="small muted">
        This is the only time it can be read. Hand it over now; a lost link costs a new invitation,
        not a lookup.
      </p>
      <p className="portal-access__link">
        <code>{invite.url}</code>
      </p>
      <p className="small muted">Works until {on(invite.expiresAt)}.</p>
      <div className="portal-access__actions">
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(invite.url).then(() => setCopied(true));
          }}
        >
          Copy the link
        </Button>
        {href ? (
          <a
            className="button button--primary"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Send on WhatsApp
          </a>
        ) : (
          <span className="small muted">This contact has no telephone number on the record.</span>
        )}
        <Button variant="quiet" onClick={onClose}>
          Done
        </Button>
      </div>
      <div role="status">{copied ? <Note>The link is on the clipboard.</Note> : null}</div>
    </section>
  );
}

type Loaded<T> =
  { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'refused' } | { kind: 'error' };

export function PortalAccessPage() {
  const { apiFetch } = useAuth();
  const [access, setAccess] = useState<Loaded<AccessResponse>>({ kind: 'loading' });
  const [requests, setRequests] = useState<Loaded<OfficeRequestsResponse>>({ kind: 'loading' });
  const [issued, setIssued] = useState<Invite | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiFetch('/api/portal/access')
      .then(async (res) => {
        if (res.status === 403) return setAccess({ kind: 'refused' });
        if (!res.ok) return setAccess({ kind: 'error' });
        setAccess({ kind: 'ready', data: AccessResponse.parse(await res.json()) });
      })
      .catch(() => setAccess({ kind: 'error' }));
    void apiFetch('/api/portal/requests')
      .then(async (res) => {
        if (res.status === 403) return setRequests({ kind: 'refused' });
        if (!res.ok) return setRequests({ kind: 'error' });
        setRequests({ kind: 'ready', data: OfficeRequestsResponse.parse(await res.json()) });
      })
      .catch(() => setRequests({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(load, [load]);

  const act = useCallback(
    (contactId: string, action: 'invite' | 'revoke') => {
      setBusy(contactId);
      setError(null);
      void apiFetch(`/api/portal/access/${contactId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
        .then(async (res) => {
          if (!res.ok) {
            setError(
              action === 'invite'
                ? 'That invitation could not be issued. Try again.'
                : 'That access could not be ended. Try again.',
            );
            return;
          }
          if (action === 'invite') setIssued(InviteResponse.parse(await res.json()));
          load();
        })
        .catch(() => setError('That could not be done just now. Try again.'))
        .finally(() => setBusy(null));
    },
    [apiFetch, load],
  );

  const handle = useCallback(
    (id: string) => {
      setBusy(id);
      void apiFetch(`/api/portal/requests/${id}/handle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
        .then((res) => {
          if (!res.ok) setError('That request could not be marked as handled. Try again.');
          else load();
        })
        .catch(() => setError('That request could not be marked as handled. Try again.'))
        .finally(() => setBusy(null));
    },
    [apiFetch, load],
  );

  const accessColumns: readonly Column<AccessRow>[] = [
    { key: 'client', header: 'Client', render: (row) => row.clientName },
    { key: 'contact', header: 'Contact', render: (row) => row.name },
    {
      key: 'relationship',
      header: 'Relationship',
      render: (row) => <span className="small">{row.relationship}</span>,
    },
    {
      key: 'reachable',
      header: 'On the record',
      render: (row) => (
        <span className="small muted">
          {[row.hasPhone ? 'telephone' : null, row.hasEmail ? 'email' : null]
            .filter(Boolean)
            .join(', ') || 'neither'}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Access',
      render: (row) => (
        <>
          <StatusChip label={STATE_LABELS[row.state]} tone={TONE[row.state]} />
          {row.state === 'invited' && row.expiresAt ? (
            <span className="small muted"> expires {on(row.expiresAt)}</span>
          ) : null}
          {row.state === 'active' && row.since ? (
            <span className="small muted"> since {on(row.since)}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (row) => (
        <span className="portal-access__row-actions">
          <Button onClick={() => act(row.contactId, 'invite')} disabled={busy === row.contactId}>
            {row.state === 'none' ? 'Invite' : 'Resend'}
          </Button>
          {row.state === 'active' || row.state === 'invited' ? (
            <Button
              variant="quiet"
              onClick={() => act(row.contactId, 'revoke')}
              disabled={busy === row.contactId}
            >
              Revoke
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const requestColumns: readonly Column<OfficeRequest>[] = [
    { key: 'client', header: 'Client', render: (row) => row.clientName },
    { key: 'kind', header: 'Asked for', render: (row) => KIND_LABELS[row.kind] },
    {
      key: 'asked',
      header: 'Asked by',
      render: (row) => (
        <>
          {row.askedByName}
          <span className="small muted"> {row.askedByRelationship}</span>
        </>
      ),
    },
    { key: 'when', header: 'When', numeric: true, render: (row) => on(row.createdAt) },
    {
      key: 'note',
      header: 'Note',
      render: (row) => <span className="small">{row.note ?? ''}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (row) =>
        row.status === 'open' ? (
          <Button onClick={() => handle(row.id)} disabled={busy === row.id}>
            Mark as handled
          </Button>
        ) : (
          <span className="small muted">Handled {on(row.handledAt)}</span>
        ),
    },
  ];

  return (
    <section className="page">
      <PageHeader
        title="Portal"
        aside="Who can open a household's own record, and what the households have asked for. Handling a request is recorded here; the act itself happens on the record's own screens."
      />

      <div role="status">{error ? <Note tone="critical">{error}</Note> : null}</div>
      {access.kind === 'refused' || requests.kind === 'refused' ? (
        <Note tone="critical">
          Household access is the owner&rsquo;s and an admin&rsquo;s to manage.
        </Note>
      ) : null}

      {issued ? <IssuedLink invite={issued} onClose={() => setIssued(null)} /> : null}

      <h2 className="portal-access__heading">Access</h2>
      {access.kind === 'loading' ? <Note>Loading household access.</Note> : null}
      {access.kind === 'error' ? (
        <Note tone="critical">Household access could not be loaded. Try again.</Note>
      ) : null}
      {access.kind === 'ready' ? (
        <Table
          caption="Every contact on an active client, and the state of their access to the portal"
          columns={accessColumns}
          rows={access.data.access}
          rowKey={(row) => row.contactId}
          empty={<Note>No contacts are on the record yet.</Note>}
        />
      ) : null}

      <h2 className="portal-access__heading">Requests</h2>
      {requests.kind === 'loading' ? <Note>Loading the requests.</Note> : null}
      {requests.kind === 'error' ? (
        <Note tone="critical">The requests could not be loaded. Try again.</Note>
      ) : null}
      {requests.kind === 'ready' ? (
        <Table
          caption="What the households have asked the practice for"
          columns={requestColumns}
          rows={requests.data.requests}
          rowKey={(row) => row.id}
          empty={<Note>No household has asked for anything.</Note>}
        />
      ) : null}
    </section>
  );
}
