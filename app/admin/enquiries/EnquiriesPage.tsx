import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ENQUIRY_PAGE,
  ENQUIRY_SOURCES,
  ENQUIRY_STATUSES,
  enquiryWaitingDays,
  type EnquiringFor,
  type EnquirySource,
  type EnquiryStatus,
  type EnquiryTally,
  type Interest,
} from '@domain/enquiry';
import { EnquiryListResponse, type Enquiry } from '../../api/enquiries/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import { DOWNLOAD_REFUSED, downloadCsv } from '../accounting/download';
import './enquiries.css';

/**
 * The website's enquiries (docs/superpowers/specs/2026-09-09-enquiries-design.md):
 * a table, newest first, and for each new one the two things a person can do —
 * turn it into a lead, or dismiss it with a reason. Once actioned a row keeps
 * nothing personal, so the table shows what happened and who did it.
 *
 * Three tables, one at a time (the operator's ask of 19 September 2026):
 * what is still waiting, what became a lead, and what was dismissed. At an
 * expo's volume one table of all three is a table nobody can work from, and a
 * dismissed row has nothing left in it but a reason. Each is asked of the
 * server by its status, a page at a time, so no number of dismissed rows can
 * crowd out one that is waiting, and the dismissed are not fetched at all
 * until somebody opens them. It is still one table in the database: see
 * `domain/enquiry/list.ts` for why.
 *
 * From trunk round 50 the expo's enquiries land here too, under a filter by
 * source so the stand's leads can be followed up as one list, with the two
 * answers only that form asks in the Details column, a file of the expo's
 * waiting leads to download, and the poster the stand prints its code from.
 *
 * Seen by the owner, an admin and the lead practitioner; the API refuses
 * everyone else and this screen is not offered to them. English only, like
 * the rest of the console.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** With the year: what was dismissed or converted is kept, and reaches back further than a season. */
const datedStamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'Active',
  converted: 'Converted',
  dismissed: 'Dismissed',
};

const CAPTIONS: Record<EnquiryStatus, string> = {
  new: 'Active enquiries, newest first',
  converted: 'Converted enquiries, newest first',
  dismissed: 'Dismissed enquiries, newest first',
};

/** What an empty table says, by the table and by where the rows would have come from. */
const NOTHING: Record<EnquiryStatus, Record<'all' | EnquirySource, string>> = {
  new: {
    all: 'Nothing waiting. New enquiries land here.',
    website: 'Nothing waiting from the website.',
    discovery_call: 'Nothing waiting from a discovery call.',
    expo: 'Nothing waiting from the expo. The code on the stand lands here.',
  },
  converted: {
    all: 'No enquiry has become a lead yet.',
    website: 'No website enquiry has become a lead yet.',
    discovery_call: 'No discovery call has become a lead yet.',
    expo: 'No expo enquiry has become a lead yet.',
  },
  dismissed: {
    all: 'Nothing has been dismissed.',
    website: 'No website enquiry has been dismissed.',
    discovery_call: 'No discovery call has been dismissed.',
    expo: 'No expo enquiry has been dismissed.',
  },
};

const SOURCE_LABELS: Record<Enquiry['source'], string> = {
  website: 'Website',
  discovery_call: 'Discovery call',
  expo: 'Expo',
};

const ENQUIRING_FOR_LABELS: Record<EnquiringFor, string> = {
  self: 'themselves',
  child: 'a child',
  family_member: 'a family member',
  someone_else: 'someone else',
};

const INTEREST_LABELS: Record<Interest, string> = {
  brain_map: 'a brain map',
  neurofeedback: 'neurofeedback',
  both: 'both',
};

type SourceFilter = 'all' | EnquirySource;

const LOAD_ERROR = 'The enquiries could not be loaded. Try again.';
/** The file is a copy the scrub and an erasure never reach, so the office is told what to do with it. */
const FILE_NOTE =
  'The expo leads file holds names and numbers. Keep it on the practice’s own device and delete it once the follow-up is done.';
const ACTION_ERROR = 'That could not be done. Reload and try again.';
const OLDER_ERROR = 'The older enquiries could not be loaded. Try again.';

function firstLine(text: string | null): string {
  if (!text) return '';
  const line = text.split(/\r?\n/)[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function EnquiriesPage() {
  const { apiFetch } = useAuth();
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<EnquiryStatus>('new');
  const [counts, setCounts] = useState<EnquiryTally | null>(null);
  const [older, setOlder] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const addressOf = (before: string | null): string => {
    const query = new URLSearchParams({ status });
    if (source !== 'all') query.set('source', source);
    if (before !== null) query.set('before', before);
    return `/api/enquiries?${query.toString()}`;
  };

  // Fetched for the table that is open, and again after every action: the row
  // that was just converted or dismissed has left this table for its own.
  const [generation, setGeneration] = useState(0);
  const reload = () => setGeneration((g) => g + 1);

  useEffect(() => {
    let live = true;
    void apiFetch(addressOf(null))
      .then(async (res) => {
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        const parsed = EnquiryListResponse.safeParse(await res.json());
        if (live && parsed.success) {
          setEnquiries(parsed.data.enquiries);
          setCounts(parsed.data.counts);
          setOlder(parsed.data.older);
          setFailed(false);
        } else if (live) {
          setFailed(true);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // `addressOf` is this render's status and source, which are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, generation, status, source]);

  // Which table is on the screen, for a reply to check itself against. A page
  // asked for under Dismissed can arrive after somebody has gone back to
  // Active, and set beneath the wrong table it would put thirty dismissed rows
  // among the waiting ones.
  const view = `${status}|${source}|${generation}`;
  const onScreen = useRef(view);
  // Written after the render that changed it, never during one: a reply is
  // read in a later task, by which time this has run.
  useEffect(() => {
    onScreen.current = view;
  }, [view]);

  const pagedLine = useRef<HTMLDivElement>(null);
  // Raised by the press that fetched the last page. The button that held the
  // focus leaves the screen in the render that follows, so the focus is handed
  // on after it. A ref and not state: it is a note to the next effect, and
  // nothing on the screen reads it.
  const handFocusOn = useRef(false);
  useEffect(() => {
    if (older !== null || !handFocusOn.current) return;
    handFocusOn.current = false;
    pagedLine.current?.focus();
  }, [older]);

  /** The next page, set beneath what is already on the screen. */
  async function showOlder(): Promise<void> {
    // `aria-disabled` on the button and this, not `disabled`: a disabled button
    // drops the focus it is holding, and the person pressing it is holding it.
    if (older === null || loadingOlder) return;
    const askedFrom = view;
    setLoadingOlder(true);
    setError(null);
    try {
      const res = await apiFetch(addressOf(older));
      const parsed = res.ok ? EnquiryListResponse.safeParse(await res.json()) : null;
      // The table it was for has gone: the reply is for nobody.
      if (onScreen.current !== askedFrom) return;
      if (parsed?.success) {
        setEnquiries((shown) => [...(shown ?? []), ...parsed.data.enquiries]);
        setCounts(parsed.data.counts);
        if (parsed.data.older === null) handFocusOn.current = true;
        setOlder(parsed.data.older);
      } else {
        setError(OLDER_ERROR);
      }
    } catch {
      if (onScreen.current === askedFrom) setError(OLDER_ERROR);
    } finally {
      setLoadingOlder(false);
    }
  }

  /** Another table, from its top: what was on the screen belongs to the one just left. */
  function open(next: { status?: EnquiryStatus; source?: SourceFilter }): void {
    // Already open: there is nothing to fetch, so there must be nothing to
    // clear. Clearing here left the table empty for good, because the fetch
    // runs when the status or the source changes and neither had.
    if ((next.status ?? status) === status && (next.source ?? source) === source) return;
    setEnquiries(null);
    setOlder(null);
    setError(null);
    setDismissing(null);
    setReason('');
    if (next.status !== undefined) setStatus(next.status);
    if (next.source !== undefined) setSource(next.source);
  }

  async function convert(enquiry: Enquiry): Promise<void> {
    setBusy(enquiry.id);
    setError(null);
    setOutcome(null);
    try {
      const res = await apiFetch(`/api/enquiries/${enquiry.id}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { mrn: string };
        setOutcome(
          `Converted to a lead: ${body.mrn}. Open the record to add what the enquiry did not say.`,
        );
        reload();
      } else {
        setError(ACTION_ERROR);
      }
    } catch {
      setError(ACTION_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(enquiry: Enquiry): Promise<void> {
    if (reason.trim() === '') return;
    setBusy(enquiry.id);
    setError(null);
    setOutcome(null);
    try {
      const res = await apiFetch(`/api/enquiries/${enquiry.id}/dismiss`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (res.ok) {
        setOutcome('Dismissed. It is in the Dismissed table now.');
        setDismissing(null);
        setReason('');
        reload();
      } else {
        setError(ACTION_ERROR);
      }
    } catch {
      setError(ACTION_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function downloadExpoLeads(): Promise<void> {
    setError(null);
    setOutcome(null);
    const arrived = await downloadCsv(apiFetch, '/api/enquiries/expo.csv');
    if (!arrived) setError(DOWNLOAD_REFUSED);
  }

  const shown = enquiries ?? [];
  const countOf = (of: SourceFilter): number => counts?.[status][of] ?? 0;
  // Counted by the server over every waiting row, not over the page on the screen.
  const expoWaiting = (counts?.new.expo ?? 0) > 0;

  const received: Column<Enquiry> = {
    key: 'received',
    header: 'Received',
    render: (row) => datedStamp.format(new Date(row.receivedAt)),
  };
  const from: Column<Enquiry> = {
    key: 'source',
    header: 'From',
    render: (row) => SOURCE_LABELS[row.source],
  };
  const actioned = (header: string): Column<Enquiry> => ({
    key: 'actioned',
    header,
    render: (row) => (row.actionedAt ? datedStamp.format(new Date(row.actionedAt)) : '—'),
  });
  const by: Column<Enquiry> = {
    key: 'by',
    header: 'By',
    render: (row) => row.actionedByName ?? '—',
  };

  // Once actioned a row holds nobody, so these two tables have no column for a
  // name, a number or a message: only what happened, when, and who did it.
  const convertedColumns: readonly Column<Enquiry>[] = [
    received,
    from,
    actioned('Converted'),
    by,
    {
      key: 'lead',
      header: 'Lead',
      render: (row) =>
        row.clientId ? <Link to={`/admin/clients/${row.clientId}`}>Open the lead</Link> : '—',
    },
  ];
  const dismissedColumns: readonly Column<Enquiry>[] = [
    received,
    from,
    actioned('Dismissed'),
    by,
    { key: 'why', header: 'Why', render: (row) => row.dismissReason ?? '—' },
  ];

  const activeColumns: readonly Column<Enquiry>[] = [
    {
      key: 'received',
      header: 'Received',
      render: (row) => stamp.format(new Date(row.receivedAt)),
    },
    { key: 'name', header: 'Name', render: (row) => row.name ?? '—' },
    { key: 'number', header: 'WhatsApp', render: (row) => row.whatsappE164 ?? '—' },
    { key: 'source', header: 'From', render: (row) => SOURCE_LABELS[row.source] },
    {
      key: 'message',
      header: 'Message',
      render: (row) => (
        <span className="enquiries__message" title={row.message ?? undefined}>
          {firstLine(row.message)}
        </span>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (row) => {
        // What the discovery-call form asked, so the call goes the way the
        // person asked for it; the widget sends none of these.
        const lines = [
          row.enquiringFor ? `For: ${ENQUIRING_FOR_LABELS[row.enquiringFor]}` : null,
          row.interest ? `Interested in: ${INTEREST_LABELS[row.interest]}` : null,
          row.area ? `Area: ${row.area}` : null,
          row.concern ? `Asked about: ${row.concern}` : null,
          row.preferredTime ? `Prefers: ${row.preferredTime}` : null,
          row.contactMethod ? `Reach by: ${row.contactMethod}` : null,
        ].filter((line): line is string => line !== null);
        return lines.length === 0 ? (
          '—'
        ) : (
          <span className="enquiries__details">
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        // Still new after thirty days: surfaced, never dismissed by itself
        // (domain/enquiry/waiting.ts, the operator's decision of 10 September).
        const waiting = enquiryWaitingDays(row.status, row.receivedAt, new Date());
        return waiting === null ? (
          'New'
        ) : (
          <StatusChip label={`Waiting ${waiting} days`} tone="attention" />
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status !== 'new' ? null : dismissing === row.id ? (
          <div className="enquiries__dismiss">
            <Field
              id={`dismiss-${row.id}`}
              label="Why"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
            />
            <Button
              variant="quiet"
              disabled={busy === row.id || reason.trim() === ''}
              onClick={() => void dismiss(row)}
            >
              Dismiss
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setDismissing(null);
                setReason('');
              }}
            >
              Keep
            </Button>
          </div>
        ) : (
          <div className="enquiries__actions">
            <Button disabled={busy === row.id} onClick={() => void convert(row)}>
              Convert to lead
            </Button>
            <Button
              variant="quiet"
              disabled={busy === row.id}
              onClick={() => {
                setDismissing(row.id);
                setReason('');
              }}
            >
              Dismiss
            </Button>
          </div>
        ),
    },
  ];

  return (
    <section className="page">
      <PageHeader
        title="Enquiries"
        aside="What the website's forms and the expo's sent. What is still waiting is under Active: convert one to make it a lead on the client list, or dismiss it with a reason. Either way it moves to a table of its own, and the enquiry itself then keeps nothing personal."
        action={
          <div className="enquiries__actions">
            {expoWaiting ? (
              <Button onClick={() => void downloadExpoLeads()}>Download expo leads</Button>
            ) : null}
            <a className="link" href="/admin/enquiries/poster" target="_blank" rel="noopener">
              Expo poster
            </a>
          </div>
        }
      />
      {/*
        The same switcher Books and Billing use, styled by the shell's own
        stylesheet (tests/lint/tabs-are-always-styled.test.ts). The numbers
        are the server's count of every row, not of the page on the screen.
      */}
      {counts !== null ? (
        <nav className="sections" aria-label="Enquiries by status">
          {ENQUIRY_STATUSES.map((of) => (
            <button
              key={of}
              type="button"
              className={`sections__tab${status === of ? ' sections__tab--current' : ''}`}
              aria-current={status === of ? 'page' : undefined}
              onClick={() => open({ status: of })}
            >
              {STATUS_LABELS[of]} ({counts[of].all})
            </button>
          ))}
        </nav>
      ) : null}
      {expoWaiting ? <Note>{FILE_NOTE}</Note> : null}
      {outcome ? <Note tone="attention">{outcome}</Note> : null}
      {error ? <Note tone="critical">{error}</Note> : null}
      {failed ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {counts !== null ? (
        <div className="enquiries__filter" role="group" aria-label="From">
          {(['all', ...ENQUIRY_SOURCES] as const).map((of) => (
            <Button
              key={of}
              variant="quiet"
              aria-pressed={source === of}
              onClick={() => open({ source: of })}
            >
              {of === 'all' ? 'All' : SOURCE_LABELS[of]} ({countOf(of)})
            </Button>
          ))}
        </div>
      ) : null}
      {!failed && enquiries === null ? <Note>Loading.</Note> : null}
      {enquiries !== null ? (
        <>
          <Table
            caption={CAPTIONS[status]}
            columns={
              status === 'new'
                ? activeColumns
                : status === 'converted'
                  ? convertedColumns
                  : dismissedColumns
            }
            rows={shown}
            rowKey={(row) => row.id}
            empty={<Note>{NOTHING[status][source]}</Note>}
          />
          {/*
            Under any table longer than a page, and kept there once the last
            page is in: a status a screen reader is told of each time it
            changes, which is the only way it learns that rows were added
            beneath. When the last page arrives the button goes, and the focus
            it held is put here and not left to fall to the top of the page.
          */}
          {countOf(source) > ENQUIRY_PAGE ? (
            <div className="enquiries__older">
              <div role="status" tabIndex={-1} ref={pagedLine}>
                <Note>
                  {older !== null
                    ? `Showing ${shown.length} of ${countOf(source)}.`
                    : `Showing all ${shown.length}.`}
                </Note>
              </div>
              {older !== null ? (
                <Button aria-disabled={loadingOlder} onClick={() => void showOlder()}>
                  {loadingOlder ? 'Loading' : 'Show older'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
