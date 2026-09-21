import { useCallback, useEffect, useState } from 'react';
import { STAFF_ROLES, STAFF_ROLE_LABELS, type Role, type StaffRole } from '@domain/shared';
import { InviteResponse, TeamListResponse, type TeamMember } from '../../api/team/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { SettingsNav } from './SettingsNav';
import { TeamMemberDrawer } from './TeamMemberDrawer';
import './settings.css';

/**
 * Settings › Team: who works at the practice, and one press to open any of them
 * (trunk round 39, 2026-09-10, closing the completeness audit's first item;
 * the profile and the access switches, round 58, 2026-09-21).
 *
 * **Who may.** The list is the owner's and an admin's (`staff.manage`).
 * Everything else is the owner's alone (`staff.access.manage`) — add a person,
 * open a profile, switch a role, mint a temporary password, suspend a sign-in —
 * so an admin reads the rows and is offered no button at all. That is the
 * operator's decision of 21 September on reading round 57's security review: a
 * temporary password is a sign-in, so an admin who minted one for a colleague
 * holding Finance had the books by one remove
 * (docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md section
 * 5). `canManage` is read off the viewer's own row in the list, which carries
 * the same roles the API will ask the same rule about, so no button is offered
 * that it would refuse.
 *
 * **The row's own buttons are gone.** Four "Add …" presses could widen
 * somebody's access and never narrow it; they are switches in the drawer now,
 * and so are the temporary password and Suspend. The row keeps a job title
 * under the name — an owner's answer alone — and one Open.
 *
 * A new sign-in is created with a temporary password that this screen shows
 * once and never again — the operator's decision of 10 September — so the
 * person who pressed the button hands it over across a desk or by WhatsApp.
 * Nothing here deletes anybody.
 */

const LOAD_ERROR = 'The team could not be loaded. Try again.';
const ACTION_ERROR = 'That could not be done. Reload and try again.';
const IN_USE = 'That email address already has a sign-in.';

function roleLabel(role: string): string {
  return STAFF_ROLE_LABELS[role as Role] ?? role;
}

export function TeamPage() {
  const { apiFetch } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reload = () => setGeneration((g) => g + 1);

  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  /** Whose profile is open, by id: the drawer reads the rest for itself. */
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * Both held still across renders, because the drawer's `useDrawer` lists
   * `onClose` among its effect's dependencies: a fresh arrow function on every
   * render of this page would tear that effect down and set it up again each
   * time the list reloaded, and setting it up again *moves focus to the
   * drawer's close button*. Walked in a browser on 2026-09-21: switching a role
   * on reloaded the list, and the keyboard was thrown from the switch it had
   * just pressed to the close button.
   */
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const drawerChanged = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/team')
      .then(async (res) => {
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        const parsed = TeamListResponse.safeParse(await res.json());
        if (live && parsed.success) {
          setMembers(parsed.data.members);
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

  async function invite(): Promise<void> {
    setFormError(null);
    if (displayName.trim() === '' || email.trim() === '' || roles.length === 0) {
      setFormError('A name, an email address and at least one role.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), email: email.trim(), roles }),
      });
      if (res.status === 201) {
        const parsed = InviteResponse.safeParse(await res.json());
        if (parsed.success) {
          setCreated({ name: displayName.trim(), password: parsed.data.temporaryPassword });
          setAdding(false);
          setDisplayName('');
          setEmail('');
          setRoles([]);
          reload();
          return;
        }
      }
      if (res.status === 409) {
        setFormError(IN_USE);
        return;
      }
      if (res.status === 400) {
        setFormError('Check the name, the email address and the roles.');
        return;
      }
      setFormError(ACTION_ERROR);
    } catch {
      setFormError(ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  // Who is looking, from the list's own row for them: the same roles the API
  // will ask the same rule about, so no button is offered that it would refuse.
  const myRoles = ((members ?? []).find((member) => member.isYou)?.roles ?? []) as Role[];
  const canManage = myRoles.includes('owner');

  const columns: readonly Column<TeamMember>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <span className="team__person">
          <span>{row.displayName}</span>
          {/* Answered to an owner alone; an admin is sent null for it. */}
          {row.jobTitle === null ? null : <span className="small muted">{row.jobTitle}</span>}
        </span>
      ),
    },
    { key: 'email', header: 'Email', render: (row) => row.email ?? '—' },
    {
      key: 'roles',
      header: 'Roles',
      render: (row) => (
        <span className="team__roles">
          {row.roles.map((role) => (
            <span key={role}>{roleLabel(role)}</span>
          ))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      fit: true,
      render: (row) =>
        row.status === 'active' ? 'Active' : row.status === 'suspended' ? 'Suspended' : 'Archived',
    },
    // Left out altogether for an admin, rather than rendered empty: a column
    // that holds nothing is still a heading and a hairline down the page, and
    // the reader is left looking for what is supposed to be in it.
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            fit: true,
            render: (row: TeamMember) => (
              <span className="team__actions">
                <Button variant="quiet" onClick={() => setOpenId(row.id)}>
                  Open
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="page">
      <SettingsNav />
      <PageHeader
        title="Team"
        aside="Who works at the practice. An owner opens a person to correct their details and to switch their access on or off; an admin reads the list and changes nothing on it."
        action={
          canManage && !adding ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add a person
            </Button>
          ) : null
        }
      />
      {created ? (
        <Note tone="attention">
          Temporary password for {created.name}:{' '}
          <code className="team__password">{created.password}</code> — hand it over in person or by
          WhatsApp. It is shown once and not kept; they change it under Password once signed in.
        </Note>
      ) : null}
      {adding ? (
        <form
          className="team__form"
          onSubmit={(e) => {
            e.preventDefault();
            void invite();
          }}
        >
          <Field
            id="team-name"
            label="Name"
            value={displayName}
            maxLength={120}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Field
            id="team-email"
            label="Email address"
            type="text"
            inputMode="email"
            value={email}
            maxLength={200}
            onChange={(e) => setEmail(e.target.value)}
          />
          <fieldset className="team__fieldset">
            <legend className="field__label">Roles</legend>
            <div className="team__roles">
              {STAFF_ROLES.map((role) => (
                <label key={role} className="team__check">
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={(e) =>
                      setRoles((held) =>
                        e.target.checked ? [...held, role] : held.filter((r) => r !== role),
                      )
                    }
                  />{' '}
                  {roleLabel(role)}
                </label>
              ))}
            </div>
          </fieldset>
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="team__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Create sign-in
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setAdding(false);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {failed ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {!failed && members === null ? <Note>Loading.</Note> : null}
      {members !== null ? (
        <Table
          caption="The practice's staff and their roles"
          columns={columns}
          rows={members}
          rowKey={(row) => row.id}
          empty={<Note>Nobody yet.</Note>}
        />
      ) : null}
      {openId === null ? null : (
        <TeamMemberDrawer
          memberId={openId}
          onClose={closeDrawer}
          // The row shows a name, an email address, the roles, the status and a
          // job title, and the drawer can change every one of them.
          onChanged={drawerChanged}
        />
      )}
    </section>
  );
}
