import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { enquiryWaitingDays } from '@domain/enquiry';
import { EnquiryListResponse, type Enquiry } from '../../api/enquiries/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import './enquiries.css';

/**
 * The website's enquiries (docs/superpowers/specs/2026-09-09-enquiries-design.md):
 * a table, new first, and for each new one the two things a person can do —
 * turn it into a lead, or dismiss it with a reason. Once actioned a row keeps
 * nothing personal, so the table shows what happened and who did it.
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

const SOURCE_LABELS: Record<Enquiry['source'], string> = {
  website: 'Website',
  discovery_call: 'Discovery call',
};

const LOAD_ERROR = 'The enquiries could not be loaded. Try again.';
const ACTION_ERROR = 'That could not be done. Reload and try again.';

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

  // Fetched once, and again after every action: the row that was just
  // converted or dismissed comes back scrubbed, and the list re-sorts itself.
  const [generation, setGeneration] = useState(0);
  const reload = () => setGeneration((g) => g + 1);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/enquiries')
      .then(async (res) => {
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        const parsed = EnquiryListResponse.safeParse(await res.json());
        if (live && parsed.success) {
          setEnquiries(parsed.data.enquiries);
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
  }, [apiFetch, generation]);

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
        setOutcome('Dismissed.');
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

  const columns: readonly Column<Enquiry>[] = [
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
        if (row.status === 'converted' && row.clientId) {
          return <Link to={`/admin/clients/${row.clientId}`}>Lead</Link>;
        }
        if (row.status === 'dismissed') {
          return (
            <span title={row.dismissReason ?? undefined}>
              Dismissed{row.actionedByName ? ` by ${row.actionedByName}` : ''}
            </span>
          );
        }
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
        aside="What the website's forms sent, newest first. Convert one to make it a lead on the client list, or dismiss it with a reason; either way the enquiry itself then keeps nothing personal."
      />
      {outcome ? <Note tone="attention">{outcome}</Note> : null}
      {error ? <Note tone="critical">{error}</Note> : null}
      {failed ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {!failed && enquiries === null ? <Note>Loading.</Note> : null}
      {enquiries !== null ? (
        <Table
          caption="Enquiries, new first"
          columns={columns}
          rows={enquiries}
          rowKey={(row) => row.id}
          empty={<Note>No enquiries yet. The website's forms land here.</Note>}
        />
      ) : null}
    </section>
  );
}
