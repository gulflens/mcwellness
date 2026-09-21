import { useRef, useState } from 'react';
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_OPENS,
  canReactivate,
  canResetPassword,
  canSwitchRole,
  type Role,
  type StaffRole,
} from '@domain/shared';
import { InviteResponse, type TeamProfile } from '../../api/team/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';

/**
 * The Access tab of a colleague's drawer: the four working roles as switches,
 * and beneath them the sign-in itself (design section 8). The owner's alone,
 * every press of it.
 *
 * **A switch, not a button that adds.** Until round 58 a row carried four "Add
 * …" presses and no way back: access could be widened and never narrowed. A
 * switch says what is true now and turns either way, and the line beneath each
 * one says in plain English what the role opens, so nobody has to know the
 * word "finance" means the books.
 *
 * **Offered only when it would succeed.** `canSwitchRole` — the same pure rule
 * the route asks, and the same one `app.revoke_staff_role` asks again beneath
 * that — decides what is pressable. A switch it refuses is disabled, and where
 * the reason is about that one role (somebody's last role) the sentence stands
 * under it rather than waiting for a press that cannot happen. A refusal from
 * the server is the race the rule cannot see, and then the switch goes back
 * where it was and says why.
 */

/**
 * The five codes a refusal can carry (`TEAM_REFUSALS`), each as one sentence.
 * The server sends the code and never the words: a sentence a person reads is
 * this screen's to write, and it must not change with a database's wording.
 */
const REFUSALS: Record<string, string> = {
  locked: 'An owner holds full access, and it is nobody’s to change.',
  last_role: 'A person keeps at least one role. To shut somebody out, suspend them.',
  not_yourself: 'Your own access is not yours to change. Ask the other owner.',
  not_a_working_role: 'That is not a role this screen switches.',
  conflict: 'Somebody else changed this person’s access just now. Reload and try again.',
};

const LOCK_LINE = 'Owner. Full access. Cannot be changed.';
const ACTION_ERROR = 'That could not be done. Reload and try again.';
const UNAVAILABLE = 'Sign-ins are unavailable just now. Try again in a moment.';

/** The code a refusal carries, or `''` when it carried none this screen knows. */
async function refusalCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? '';
}

export function TeamAccessTab({
  profile,
  viewerUserId,
  viewerRoles,
  onRoles,
  onStatus,
  onReload,
  onChanged,
}: {
  profile: TeamProfile;
  viewerUserId: string;
  viewerRoles: readonly Role[];
  /** The roles this person now holds, as the drawer's own copy of them. */
  onRoles: (roles: Role[]) => void;
  onStatus: (status: TeamProfile['status']) => void;
  /** Read the profile again: the answer to a race nobody here can untangle. */
  onReload: () => void;
  onChanged: () => void;
}) {
  const { apiFetch } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<StaffRole | null>(null);
  /**
   * Whether a request from this tab is in the air, asked of a ref rather than
   * of `busy`.
   *
   * **A switch is never disabled while its own request runs**, which is what a
   * `busy` flag on it would do, and which throws the keyboard off the control
   * it has just operated: a disabled element cannot hold focus, so Space on a
   * switch moved focus to the document body and the next Tab started again from
   * the top of the drawer (walked in a browser on 2026-09-21). The switch
   * already answers instantly — it moves first and goes back on a refusal — so
   * what is left to prevent is a second press racing the first, and that is
   * this ref, read synchronously where a state flag would still be false.
   */
  const inFlight = useRef(false);

  const held = profile.roles as Role[];

  async function flip(role: StaffRole, on: boolean): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPending(role);
    setBusy(true);
    // The switch moves first, because a press that answers nothing for half a
    // second reads as a control that does not work.
    onRoles(on ? [...held, role] : held.filter((r) => r !== role));
    try {
      const res = await apiFetch(`/api/team/${profile.id}/roles/${role}`, {
        method: on ? 'PUT' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        onChanged();
        return;
      }
      // Back where it was: `held` is what was true before the press.
      onRoles(held);
      const code = await refusalCode(res);
      setError(REFUSALS[code] ?? ACTION_ERROR);
      if (code === 'conflict') onReload();
    } catch {
      onRoles(held);
      setError(ACTION_ERROR);
    } finally {
      inFlight.current = false;
      setPending(null);
      setBusy(false);
    }
  }

  async function setStatus(status: 'active' | 'suspended'): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/team/${profile.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        onStatus(status);
        onChanged();
        return;
      }
      setError(REFUSALS[await refusalCode(res)] ?? ACTION_ERROR);
    } catch {
      setError(ACTION_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function mintPassword(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      // Declared as JSON with an empty body, as every write on this API must be
      // (app/api/_middleware/security.ts's `jsonOnly`), or the answer is a 415.
      const res = await apiFetch(`/api/team/${profile.id}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const parsed = res.ok ? InviteResponse.safeParse(await res.json()) : null;
      if (parsed?.success) {
        setPassword(parsed.data.temporaryPassword);
        return;
      }
      setError(res.status === 503 ? UNAVAILABLE : ACTION_ERROR);
    } catch {
      setError(ACTION_ERROR);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const mayReset = profile.status === 'active' && canResetPassword(viewerRoles, held);
  const maySuspend = !profile.locked && !profile.isYou && profile.status !== 'archived';

  return (
    <div className="team-access">
      {profile.locked ? <Note>{LOCK_LINE}</Note> : null}
      {error ? <Note tone="critical">{error}</Note> : null}
      {password ? (
        <Note tone="attention">
          Temporary password for {profile.displayName}:{' '}
          <code className="team__password">{password}</code> — hand it over in person or by
          WhatsApp. It is shown once and not kept; they change it under Password once signed in.
        </Note>
      ) : null}

      <fieldset className="team__fieldset">
        <legend className="team-access__heading">Roles</legend>
        <div className="team-access__roles">
          {STAFF_ROLES.map((role) => {
            const on = held.includes(role);
            const refusal = canSwitchRole({
              actorUserId: viewerUserId,
              targetUserId: profile.id,
              targetRoles: held,
              role,
              on: !on,
            });
            const opensId = `team-access-${role}-opens`;
            return (
              <div key={role} className="team-access__role">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-describedby={opensId}
                  aria-busy={pending === role}
                  disabled={refusal !== null}
                  className="access-switch"
                  onClick={() => void flip(role, !on)}
                >
                  <span className="access-switch__label">{STAFF_ROLE_LABELS[role]}</span>
                </button>
                <p id={opensId} className="small muted">
                  {STAFF_ROLE_OPENS[role]}
                </p>
                {/* The one refusal that is about this role rather than about the
                    whole row, so it is said where it applies. The lock line
                    above already covers an owner's row, and an owner reading
                    their own row is that same line. */}
                {refusal === 'last_role' ? (
                  <p className="small team-access__refusal">{REFUSALS.last_role}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      {mayReset || maySuspend ? (
        <section className="team-access__signin">
          <h3 className="team-access__heading">The sign-in</h3>
          <div className="team__actions">
            {mayReset ? (
              <Button disabled={busy} onClick={() => void mintPassword()}>
                New temporary password
              </Button>
            ) : null}
            {maySuspend ? (
              <Button
                disabled={busy}
                onClick={() => void setStatus(profile.status === 'active' ? 'suspended' : 'active')}
              >
                {canReactivate(profile.status) ? 'Reactivate' : 'Suspend'}
              </Button>
            ) : null}
          </div>
          {/* Said only where the button it describes is offered: an owner's own
              row has no Suspend, and a line about suspending beneath a row that
              cannot be suspended is furniture that is not true. */}
          {maySuspend ? (
            <p className="small muted">
              Suspending refuses this sign-in at the door until it is reactivated. Nothing here
              deletes anybody.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
