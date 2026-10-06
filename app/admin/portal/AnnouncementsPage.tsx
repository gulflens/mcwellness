import { useCallback, useEffect, useState } from 'react';
import { OfficeAnnouncementsResponse, type OfficeAnnouncement } from '../../api/portal/schema';
import { displayFromIso } from '../../../domain/shared';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip, type StatusTone } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import { useAuth } from '../../shell/auth/AuthContext';
import { SettingsNav } from '../settings/SettingsNav';
import { AnnouncementDrawer, WithdrawAnnouncementDrawer } from './AnnouncementDrawer';
import './portal.css';

/**
 * Settings › Announcements — the practice's news on every household's portal
 * home (docs/SPEC/client-portal.md section 3.10; the push memo's decision 4,
 * docs/OPERATOR/2026-09-17-push-notifications.md, answered "as recommended"
 * on 6 October 2026).
 *
 * One table, in the console's own vocabulary, of every announcement the
 * practice has published: its English title, whether households see it now,
 * the days it is shown, and who published it when. "Write an announcement"
 * opens the drawer that writes, previews and publishes one. A standing one
 * offers Withdraw, and Correct, which publishes a new announcement in its
 * place; nothing here changes a published announcement's words.
 *
 * Nothing is sent to anybody. The households read it the next time they open
 * the portal, so no consent is asked and no vendor is involved. The owner and
 * an admin reach this screen; the routes say the same and
 * db/policies/portal/announcement.sql refuses the rows beneath both.
 */

const STATE: Record<OfficeAnnouncement['state'], { label: string; tone: StatusTone }> = {
  current: { label: 'Shown now', tone: 'ok' },
  scheduled: { label: 'Scheduled', tone: 'attention' },
  ended: { label: 'Ended', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

function shownWhen(row: OfficeAnnouncement): string {
  const from = row.visibleFrom ?? row.publishedOn;
  const until = row.visibleUntil;
  return until === null
    ? `From ${displayFromIso(from)}, until withdrawn`
    : `${displayFromIso(from)} to ${displayFromIso(until)}`;
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; data: OfficeAnnouncementsResponse }
  | { kind: 'refused' }
  | { kind: 'error' };

type Open =
  | { kind: 'none' }
  | { kind: 'write'; correcting: OfficeAnnouncement | null }
  | { kind: 'withdraw'; announcement: OfficeAnnouncement };

export function AnnouncementsPage() {
  const { apiFetch } = useAuth();
  const [list, setList] = useState<Loaded>({ kind: 'loading' });
  const [open, setOpen] = useState<Open>({ kind: 'none' });
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiFetch('/api/portal/announcements')
      .then(async (res) => {
        if (res.status === 403) return setList({ kind: 'refused' });
        if (!res.ok) return setList({ kind: 'error' });
        setList({ kind: 'ready', data: OfficeAnnouncementsResponse.parse(await res.json()) });
      })
      .catch(() => setList({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(load, [load]);

  const done = (sentence: string) => () => {
    setOpen({ kind: 'none' });
    setSaved(sentence);
    load();
  };

  const columns: readonly Column<OfficeAnnouncement>[] = [
    { key: 'title', header: 'Title', render: (row) => row.title.en },
    {
      key: 'state',
      header: 'On the portal',
      fit: true,
      render: (row) => <StatusChip label={STATE[row.state].label} tone={STATE[row.state].tone} />,
    },
    {
      key: 'shown',
      header: 'Shown',
      render: (row) => <span className="small numeric">{shownWhen(row)}</span>,
    },
    {
      key: 'published',
      header: 'Published',
      render: (row) => (
        <span className="small">
          <span className="numeric">{displayFromIso(row.publishedOn)}</span>
          {row.publishedBy ? <span className="muted"> by {row.publishedBy}</span> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (row) =>
        row.state === 'current' || row.state === 'scheduled' ? (
          <span className="portal-access__row-actions">
            <Button onClick={() => setOpen({ kind: 'write', correcting: row })}>Correct</Button>
            <Button
              variant="quiet"
              onClick={() => setOpen({ kind: 'withdraw', announcement: row })}
            >
              Withdraw
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <section className="page">
      <SettingsNav />
      <PageHeader
        title="Announcements"
        aside="Practice news on every adult household's portal home, in English and Arabic. Nothing is sent: households read it the next time they open the portal. A young person's own login never sees it."
        action={
          list.kind === 'ready' ? (
            <Button
              variant="primary"
              onClick={() => {
                setSaved(null);
                setOpen({ kind: 'write', correcting: null });
              }}
            >
              Write an announcement
            </Button>
          ) : null
        }
      />

      <div role="status">{saved ? <Note>{saved}</Note> : null}</div>
      {list.kind === 'loading' ? <Note>Loading the announcements.</Note> : null}
      {list.kind === 'refused' ? (
        <Note tone="critical">
          Announcements are the owner&rsquo;s and an admin&rsquo;s to manage.
        </Note>
      ) : null}
      {list.kind === 'error' ? (
        <Note tone="critical">The announcements could not be loaded. Try again.</Note>
      ) : null}
      {list.kind === 'ready' ? (
        <Table
          caption="Every announcement the practice has published, newest first"
          columns={columns}
          rows={list.data.announcements}
          rowKey={(row) => row.id}
          empty={<Note>No announcement has been published yet.</Note>}
        />
      ) : null}

      {open.kind === 'write' && list.kind === 'ready' ? (
        <AnnouncementDrawer
          today={list.data.today}
          correcting={open.correcting}
          onClose={() => setOpen({ kind: 'none' })}
          onDone={done(
            open.correcting
              ? 'The correction is published and the old announcement withdrawn.'
              : 'Published. Households see it the next time they open the portal.',
          )}
        />
      ) : null}
      {open.kind === 'withdraw' ? (
        <WithdrawAnnouncementDrawer
          announcement={open.announcement}
          onClose={() => setOpen({ kind: 'none' })}
          onDone={done('Withdrawn. It has left every household’s home.')}
        />
      ) : null}
    </section>
  );
}
