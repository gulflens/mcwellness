import { useEffect, useState } from 'react';
import {
  DECLINED_KEPT_DAYS,
  PUBLISHED_TESTIMONIALS_MAX,
  TESTIMONIAL_STATUSES,
  type MoveDirection,
  type TestimonialStatus,
} from '@domain/testimonial';
import { TestimonialListResponse, type Testimonial } from '../../api/testimonials/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import './reviews.css';

/**
 * The reviews people send from the website's Testimonials page
 * (docs/SPEC/testimonials.md section 5). "Every testimonial is reviewed before
 * it appears here", the page says, and this is where that happens.
 *
 * Three tables, one at a time, as Enquiries has: what is waiting, what is on
 * the website, and what was declined. A waiting review is approved onto the
 * website or declined. A published one can be moved up or down among the
 * others in its own language — the order the website shows them in — or
 * withdrawn, which takes it off the website within a minute (the published
 * list may be cached that long); that is also how a person's request to take
 * theirs down is met. The website is sent the first thirty of each language,
 * and a review placed below that is marked as not shown.
 *
 * **When the queue is full.** The door stops taking new reviews past thirty
 * an hour or while five hundred wait, and still answers the sender as if it
 * had, so a script learns nothing (migration 978). The office is told here
 * instead, and Decline all shown clears a flooded Pending list in one press. Nobody edits what somebody
 * wrote: the screen offers no way to, and the database refuses one
 * (migration 978).
 *
 * Seen by the owner and an admin; the API refuses everyone else and this
 * screen is not offered to them. English only, like the rest of the console:
 * an Arabic review is shown as written, in its own direction, and every word
 * around it is English.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const STATUS_LABELS: Record<TestimonialStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
};

const CAPTIONS: Record<TestimonialStatus, string> = {
  pending: 'Reviews waiting for a decision, newest first',
  approved: 'Reviews on the website, in the order the website shows them',
  declined: 'Reviews declined or withdrawn, most recent decision first',
};

const NOTHING: Record<TestimonialStatus, string> = {
  pending: 'Nothing is waiting. A review sent from the website appears here first.',
  approved: 'Nothing is on the website yet.',
  declined: 'Nothing has been declined.',
};

const LANGUAGE_LABELS = { en: 'English', ar: 'Arabic' } as const;

const LOAD_ERROR = 'The reviews could not be loaded. Reload the page to try again.';
const ACTION_ERROR = 'That could not be done. Reload and try again.';
const DECLINED_NOTE = `A declined or withdrawn review is deleted ${DECLINED_KEPT_DAYS} days after the decision. It is never shown on the website.`;
const APPROVED_NOTE =
  'The website shows these in this order, each language on its own page. A review approved since the list was last arranged goes to the top. Withdraw takes a review off the website within a minute, including when the person who wrote it asks.';
const TURNING_AWAY =
  'New reviews are being turned away — the queue is full; decline or approve some.';
const NOT_SHOWN = `Not shown on the website (only the first ${PUBLISHED_TESTIMONIALS_MAX} are)`;

type Counts = Record<TestimonialStatus, number>;

export function ReviewsPage() {
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<TestimonialStatus>('pending');
  const [rows, setRows] = useState<Testimonial[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  /** Decline all shown: the confirm step is open. */
  const [decliningAll, setDecliningAll] = useState(false);
  const [turningAway, setTurningAway] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/testimonials?status=${status}`)
      .then(async (res) => {
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        const parsed = TestimonialListResponse.safeParse(await res.json());
        if (!live) return;
        if (parsed.success) {
          setRows(parsed.data.testimonials);
          setCounts(parsed.data.counts);
          setTurningAway(parsed.data.turningAway);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [apiFetch, status, generation]);

  function open(next: TestimonialStatus): void {
    if (next === status) return;
    setRows(null);
    setError(null);
    setWithdrawing(null);
    setDecliningAll(false);
    setStatus(next);
  }

  /** Every waiting review on the table, declined in one press once confirmed. */
  async function declineAll(ids: readonly string[]): Promise<void> {
    setBusy('all');
    setError(null);
    try {
      const res = await apiFetch('/api/testimonials/decline-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        setError(ACTION_ERROR);
        return;
      }
      setDecliningAll(false);
      setGeneration((g) => g + 1);
    } catch {
      setError(ACTION_ERROR);
    } finally {
      setBusy(null);
    }
  }

  /** One press: a decision or a move. The list is asked for again either way. */
  async function act(row: Testimonial, path: string, body: object = {}): Promise<void> {
    setBusy(row.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/testimonials/${row.id}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(ACTION_ERROR);
        return;
      }
      setWithdrawing(null);
      setGeneration((g) => g + 1);
    } catch {
      setError(ACTION_ERROR);
    } finally {
      setBusy(null);
    }
  }

  const move = (row: Testimonial, direction: MoveDirection) => void act(row, 'move', { direction });

  // Where each published review stands in its own language's list: the
  // website shows each language on its own page, so a review moves among
  // those and is first or last of those alone.
  const shown = rows ?? [];
  const placeOf = new Map<string, { place: number; last: boolean }>();
  for (const language of ['en', 'ar'] as const) {
    const ofLanguage = shown.filter((row) => row.language === language);
    ofLanguage.forEach((row, index) =>
      placeOf.set(row.id, { place: index + 1, last: index === ofLanguage.length - 1 }),
    );
  }

  const who: Column<Testimonial> = {
    key: 'name',
    header: 'Name',
    render: (row) => (
      <div className="reviews__who">
        <span>{row.displayName}</span>
        {row.context ? <span className="small muted">{row.context}</span> : null}
      </div>
    ),
  };
  const rating: Column<Testimonial> = {
    key: 'rating',
    header: 'Rating',
    fit: true,
    render: (row) => <span className="numeric">{`${row.rating} of 5`}</span>,
  };
  const language: Column<Testimonial> = {
    key: 'language',
    header: 'Language',
    fit: true,
    render: (row) => LANGUAGE_LABELS[row.language],
  };
  const words: Column<Testimonial> = {
    key: 'review',
    header: 'Review',
    // The words as written, in their own direction: `dir="auto"` lets an
    // Arabic review read right to left inside an English screen, and `lang`
    // tells a screen reader which voice to read it in.
    render: (row) => (
      <p className="reviews__body" dir="auto" lang={row.language}>
        {row.body}
      </p>
    ),
  };
  const decided: Column<Testimonial> = {
    key: 'decided',
    header: status === 'approved' ? 'Approved' : 'Declined',
    render: (row) =>
      row.decidedAt ? (
        <div className="reviews__who">
          <span className="numeric">{stamp.format(new Date(row.decidedAt))}</span>
          {row.decidedByName ? <span className="small muted">{row.decidedByName}</span> : null}
        </div>
      ) : null,
  };

  const pendingColumns: readonly Column<Testimonial>[] = [
    {
      key: 'received',
      header: 'Received',
      fit: true,
      render: (row) => <span className="numeric">{stamp.format(new Date(row.submittedAt))}</span>,
    },
    who,
    rating,
    language,
    words,
    {
      key: 'actions',
      header: '',
      fit: true,
      render: (row) => (
        <div className="reviews__actions">
          <Button
            disabled={busy === row.id}
            aria-label={`Approve ${row.displayName}`}
            onClick={() => void act(row, 'approve')}
          >
            Approve
          </Button>
          <Button
            variant="quiet"
            disabled={busy === row.id}
            aria-label={`Decline ${row.displayName}`}
            onClick={() => void act(row, 'decline')}
          >
            Decline
          </Button>
        </div>
      ),
    },
  ];

  const approvedColumns: readonly Column<Testimonial>[] = [
    {
      key: 'place',
      header: 'Place',
      fit: true,
      numeric: true,
      render: (row) => placeOf.get(row.id)?.place ?? '',
    },
    {
      ...who,
      // The website is sent the first thirty of each language; one placed
      // below that is approved and not on the page, which the office needs to
      // see before wondering why.
      render: (row) => (
        <div className="reviews__who">
          <span>{row.displayName}</span>
          {row.context ? <span className="small muted">{row.context}</span> : null}
          {(placeOf.get(row.id)?.place ?? 0) > PUBLISHED_TESTIMONIALS_MAX ? (
            <span className="small muted">{NOT_SHOWN}</span>
          ) : null}
        </div>
      ),
    },
    rating,
    language,
    words,
    decided,
    {
      key: 'actions',
      header: '',
      fit: true,
      render: (row) => {
        const at = placeOf.get(row.id);
        if (withdrawing === row.id) {
          return (
            <div className="reviews__actions">
              <span>Take it off the website?</span>
              <Button disabled={busy === row.id} onClick={() => void act(row, 'withdraw')}>
                Withdraw
              </Button>
              <Button variant="quiet" onClick={() => setWithdrawing(null)}>
                Cancel
              </Button>
            </div>
          );
        }
        return (
          <div className="reviews__actions">
            <Button
              variant="quiet"
              disabled={busy !== null || at?.place === 1}
              aria-label={`Move ${row.displayName} up`}
              onClick={() => move(row, 'up')}
            >
              Move up
            </Button>
            <Button
              variant="quiet"
              disabled={busy !== null || at?.last !== false}
              aria-label={`Move ${row.displayName} down`}
              onClick={() => move(row, 'down')}
            >
              Move down
            </Button>
            <Button
              variant="quiet"
              disabled={busy === row.id}
              aria-label={`Withdraw ${row.displayName}`}
              onClick={() => setWithdrawing(row.id)}
            >
              Withdraw
            </Button>
          </div>
        );
      },
    },
  ];

  const declinedColumns: readonly Column<Testimonial>[] = [who, rating, language, words, decided];

  return (
    <section className="page">
      <PageHeader
        title="Reviews"
        aside="What people sent from the website's Testimonials page. Nothing appears on the website until it is approved here, and a review is never edited: it is published as written, or not at all."
      />
      {counts !== null ? (
        <nav className="sections" aria-label="Reviews by status">
          {TESTIMONIAL_STATUSES.map((of) => (
            <button
              key={of}
              type="button"
              className={`sections__tab${status === of ? ' sections__tab--current' : ''}`}
              aria-current={status === of ? 'page' : undefined}
              onClick={() => open(of)}
            >
              {STATUS_LABELS[of]} ({counts[of]})
            </button>
          ))}
        </nav>
      ) : null}
      {turningAway ? <Note tone="attention">{TURNING_AWAY}</Note> : null}
      {status === 'pending' && rows !== null && rows.length > 0 ? (
        decliningAll ? (
          <div className="reviews__actions">
            <span>
              Decline all {rows.length} {rows.length === 1 ? 'review' : 'reviews'} shown? They will
              never be published.
            </span>
            <Button
              disabled={busy !== null}
              onClick={() => void declineAll(rows.map((row) => row.id))}
            >
              {`Decline all ${rows.length}`}
            </Button>
            <Button variant="quiet" onClick={() => setDecliningAll(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="reviews__actions">
            <Button variant="quiet" disabled={busy !== null} onClick={() => setDecliningAll(true)}>
              Decline all shown
            </Button>
          </div>
        )
      ) : null}
      {status === 'approved' ? <Note>{APPROVED_NOTE}</Note> : null}
      {status === 'declined' ? <Note>{DECLINED_NOTE}</Note> : null}
      {error ? <Note tone="critical">{error}</Note> : null}
      {failed ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {!failed && rows === null ? <Note>Loading.</Note> : null}
      {rows !== null ? (
        <Table
          caption={CAPTIONS[status]}
          columns={
            status === 'pending'
              ? pendingColumns
              : status === 'approved'
                ? approvedColumns
                : declinedColumns
          }
          rows={rows}
          rowKey={(row) => row.id}
          empty={<Note>{NOTHING[status]}</Note>}
        />
      ) : null}
    </section>
  );
}
