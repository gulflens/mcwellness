import type { Role } from '../shared/actor';
import type { ClientSummary, ViewClientContext, ViewingActor } from './types';

/**
 * Whether `actor` holds any of `roles` — the same test as `hasRole` in
 * domain/shared/actor.ts, restated here because that helper takes the full
 * `Actor` (tenant id and capabilities included) and `ViewingActor` is
 * deliberately narrower: this rule needs only who someone is, not what they
 * are certified to do.
 */
function hasAnyRole(actor: ViewingActor, ...roles: Role[]): boolean {
  return roles.some((role) => actor.roles.includes(role));
}

/**
 * Role, schedule and erasure-aware visibility for the client detail drawer
 * (docs/SPEC/client-record.md rules 6 and 8, section 2). RLS is the floor
 * beneath this; the API consults it before every read, mirroring the
 * `canActor` pattern in domain/shared/actor.ts. `now` is accepted for parity
 * with that pattern and for a future rule that consults the clock; nothing
 * here does today.
 */
export function canViewClient(
  actor: ViewingActor,
  client: ClientSummary,
  ctx: ViewClientContext,
  now: Date,
): { ok: boolean; needsReason: boolean } {
  void now;

  if (client.status === 'erased') {
    // Section 2 and section 8: only the owner and the lead practitioner may open an
    // erased record, and doing so always prompts for a reason.
    const canOpen = hasAnyRole(actor, 'owner', 'lead_practitioner');
    return { ok: canOpen, needsReason: canOpen };
  }

  if (hasAnyRole(actor, 'owner', 'admin', 'lead_practitioner', 'finance')) {
    return { ok: true, needsReason: false };
  }

  if (hasAnyRole(actor, 'practitioner') && ctx.scheduledClientIds.includes(client.id)) {
    return { ok: true, needsReason: false };
  }

  if (hasAnyRole(actor, 'client_contact') && ctx.contactClientIds.includes(client.id)) {
    return { ok: true, needsReason: false };
  }

  return { ok: false, needsReason: false };
}
