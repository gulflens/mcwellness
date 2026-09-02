import type { ClientStatus } from '../../api/clients/schema';

/** Status in words first; the small dot carries the one non-band hue the brief allows. */
const LABELS: Record<ClientStatus, string> = {
  lead: 'Lead',
  active: 'Active',
  paused: 'Paused',
  closed: 'Closed',
  erased: 'Erased',
};

export function StatusChip({ status }: { status: ClientStatus }) {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
