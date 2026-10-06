import { useCallback, useEffect, useState } from 'react';
import { OFFERS_PER_MONTH } from '../../../domain/portal';
import { displayFromIso } from '../../../domain/shared';
import { OfficePushResponse, type OfficePushMessage } from '../../api/portal/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip, type StatusTone } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import { SettingsNav } from '../settings/SettingsNav';
import { PushRecordDrawer, SendPushDrawer } from './PushDrawers';
import './portal.css';

/**
 * Settings › Notifications — the Send screen (the push memo's decision 3 and
 * step 5 of its "What gets built", docs/OPERATOR/2026-09-17-push-notifications.md,
 * answered "as recommended" on 6 October 2026; docs/SPEC/client-portal.md
 * section 3.12).
 *
 * Write a message in English and Arabic, choose the kind, see how many it
 * will reach, and send it once. An announcement goes to every adult who has
 * turned notifications on; an offer only to those whose marketing consent is
 * on at that moment, at most two a calendar month. A young person's own login
 * never receives one.
 *
 * Below, the record of every message sent: when, which kind, what it said, to
 * how many people and devices, what the delivery found, and who sent it. Each
 * one opens to the people it went to and each one's consent standing at that
 * moment — what the practice would show a regulator, or a household.
 *
 * On a deployment without the practice's key pair it says push is not
 * configured and offers nothing to send.
 */

const KIND: Record<OfficePushMessage['kind'], { label: string; tone: StatusTone }> = {
  announcement: { label: 'Announcement', tone: 'neutral' },
  offer: { label: 'Offer', tone: 'attention' },
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function delivery(row: OfficePushMessage): string {
  if (row.delivery === null) return 'Not delivered yet';
  const { delivered, gone, failed } = row.delivery;
  const parts = [`${delivered} delivered`];
  if (gone > 0) parts.push(`${gone} gone`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(', ');
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; data: OfficePushResponse }
  | { kind: 'refused' }
  | { kind: 'error' };

type Open = { kind: 'none' } | { kind: 'send' } | { kind: 'record'; id: string };

export function NotificationsPage() {
  const { apiFetch } = useAuth();
  const [page, setPage] = useState<Loaded>({ kind: 'loading' });
  const [open, setOpen] = useState<Open>({ kind: 'none' });
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiFetch('/api/portal/push')
      .then(async (res) => {
        if (res.status === 403) return setPage({ kind: 'refused' });
        if (!res.ok) return setPage({ kind: 'error' });
        setPage({ kind: 'ready', data: OfficePushResponse.parse(await res.json()) });
      })
      .catch(() => setPage({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(load, [load]);

  const columns: readonly Column<OfficePushMessage>[] = [
    {
      key: 'sent',
      header: 'Sent',
      render: (row) => <span className="numeric">{displayFromIso(row.sentOn)}</span>,
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (row) => <StatusChip label={KIND[row.kind].label} tone={KIND[row.kind].tone} />,
    },
    { key: 'title', header: 'Title', render: (row) => row.title.en },
    {
      key: 'to',
      header: 'To',
      render: (row) => (
        <span className="small numeric">
          {plural(row.recipients, 'person', 'people')}, {plural(row.devices, 'device', 'devices')}
        </span>
      ),
    },
    {
      key: 'delivery',
      header: 'Delivery',
      render: (row) => <span className="small numeric">{delivery(row)}</span>,
    },
    { key: 'by', header: 'Sent by', render: (row) => row.sentBy ?? '' },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (row) => (
        <Button variant="quiet" onClick={() => setOpen({ kind: 'record', id: row.id })}>
          Record
        </Button>
      ),
    },
  ];

  const data = page.kind === 'ready' ? page.data : null;

  return (
    <section className="page">
      <SettingsNav />
      <PageHeader
        title="Notifications"
        aside="Phone notifications to the households that have turned them on. An announcement goes to every adult; an offer only to those whose marketing consent is on, at most two a calendar month. A young person's own login never receives one."
        action={
          data?.configured ? (
            <Button
              variant="primary"
              onClick={() => {
                setSaved(null);
                setOpen({ kind: 'send' });
              }}
            >
              Write a notification
            </Button>
          ) : null
        }
      />

      <div role="status">{saved ? <Note>{saved}</Note> : null}</div>
      {page.kind === 'loading' ? <Note>Loading the notifications.</Note> : null}
      {page.kind === 'refused' ? (
        <Note tone="critical">
          Notifications are the owner&rsquo;s and an admin&rsquo;s to send.
        </Note>
      ) : null}
      {page.kind === 'error' ? (
        <Note tone="critical">The notifications could not be loaded. Try again.</Note>
      ) : null}

      {data !== null && !data.configured ? (
        <Note tone="attention">
          Push is not configured. The practice&rsquo;s key pair is set on the host by the operator
          (pnpm push:keys), and until it is, nothing can be sent and households are not offered
          notifications.
        </Note>
      ) : null}

      {data !== null && data.configured ? (
        <dl className="push__reach">
          <dt>An announcement today</dt>
          <dd className="numeric">
            {plural(data.audience.announcement.people, 'person', 'people')} on{' '}
            {plural(data.audience.announcement.devices, 'device', 'devices')}
          </dd>
          <dt>An offer today</dt>
          <dd className="numeric">
            {plural(data.audience.offer.people, 'person', 'people')} on{' '}
            {plural(data.audience.offer.devices, 'device', 'devices')}
          </dd>
          <dt>Offers left this month</dt>
          <dd className="numeric">
            {data.offersLeft} of {OFFERS_PER_MONTH}
          </dd>
        </dl>
      ) : null}

      {data !== null ? (
        <Table
          caption="Every notification the practice has sent, newest first"
          columns={columns}
          rows={data.messages}
          rowKey={(row) => row.id}
          empty={<Note>No notification has been sent yet.</Note>}
        />
      ) : null}

      {open.kind === 'send' && data !== null ? (
        <SendPushDrawer
          audience={data.audience}
          offersLeft={data.offersLeft}
          onClose={() => setOpen({ kind: 'none' })}
          onDone={(sentence) => {
            setOpen({ kind: 'none' });
            setSaved(sentence);
            load();
          }}
        />
      ) : null}
      {open.kind === 'record' ? (
        <PushRecordDrawer id={open.id} onClose={() => setOpen({ kind: 'none' })} />
      ) : null}
    </section>
  );
}
