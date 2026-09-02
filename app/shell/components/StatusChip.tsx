import type { ClientStatus } from '../../api/clients/schema';

/** The four tones any part of the app may use. Ok, attention and critical
 * colour the dot from their tokens; neutral is the documented default
 * slate dot and carries no colour-only meaning (DESIGN.md's Do's and
 * Don'ts: never colour the word). */
export type StatusTone = 'ok' | 'attention' | 'critical' | 'neutral';

/** A status any screen can render: a word in ink, a 6px dot beside it. */
export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`status status--${tone}`}>
      <span className="status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Status in words first; the small dot carries the one non-band hue the brief allows. */
const LABELS: Record<ClientStatus, string> = {
  lead: 'Lead',
  active: 'Active',
  paused: 'Paused',
  closed: 'Closed',
  erased: 'Erased',
};

/**
 * The client record's own chip, unchanged since it first shipped: active,
 * paused and erased keep their own dot colours, closed keeps the default
 * slate dot, and lead keeps its hollow ring (DESIGN.md's Status Chip
 * section) — none of which the four flat tones above can express, so this
 * stays a thin wrapper over the shared chrome rather than a call into
 * `StatusChip`.
 */
export function ClientStatusChip({ status }: { status: ClientStatus }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
