import type { ClientStatus } from './types';

/**
 * The lifecycle diagram in docs/SPEC/client-record.md section 3: lead becomes
 * active; active and paused move back and forth; active becomes closed, and
 * closed reactivates to active (an audited, reason-prompted move — section 9
 * lists "reactivation from closed" alongside erasure and consent withdrawal);
 * and any live status may become erased. Erased is terminal.
 */
const ALLOWED_TRANSITIONS: Record<ClientStatus, readonly ClientStatus[]> = {
  lead: ['active', 'erased'],
  active: ['paused', 'closed', 'erased'],
  paused: ['active', 'erased'],
  closed: ['active', 'erased'],
  erased: [],
};

/** A status this diagram was not written for permits no transition, rather than throwing. */
export function canTransition(from: ClientStatus, to: ClientStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
