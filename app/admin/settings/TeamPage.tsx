import { useEffect, useState } from 'react';
import { STAFF_ROLES, STAFF_ROLE_LABELS, type Role, type StaffRole } from '@domain/shared';
import { InviteResponse, TeamListResponse, type TeamMember } from '../../api/team/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { SettingsNav } from './SettingsNav';
import './settings.css';

/**
 * Settings › Team: who works at the practice, and how a colleague is given a
 * way in (trunk round 39, 2026-09-10, closing the completeness audit's first
 * item). The owner and an admin see it; the API and row security agree.
 *
 * A new sign-in is created with a temporary password that this screen shows
 * once and never again — the operator's decision of 10 September — so the
 * person who pressed the button hands it over across a desk or by WhatsApp.
 * Suspending refuses a sign-in at the fence and can be undone; nothing here
 * deletes. Your own row has no suspend button, by rule.
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
  const [error, setError] = useState<string | null>(null);

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

  async function post(path: string, body: unknown): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) reload();
      else setError(ACTION_ERROR);
    } catch {
      setError(ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const columns: readonly Column<TeamMember>[] = [
    { key: 'name', header: 'Name', render: (row) => row.displayName },
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
      render: (row) =>
        row.status === 'active' ? 'Active' : row.status === 'suspended' ? 'Suspended' : 'Archived',
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <span className="team__actions">
          {STAFF_ROLES.filter((role) => !row.roles.includes(role)).map((role) => (
            <Button
              key={role}
              variant="quiet"
              disabled={busy}
              onClick={() => void post(`/api/team/${row.id}/roles`, { role })}
            >
              Add {roleLabel(role).toLowerCase()}
            </Button>
          ))}
          {row.isYou || row.status === 'archived' ? null : row.status === 'active' ? (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void post(`/api/team/${row.id}/status`, { status: 'suspended' })}
            >
              Suspend
            </Button>
          ) : (
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void post(`/api/team/${row.id}/status`, { status: 'active' })}
            >
              Reactivate
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <section className="page">
      <SettingsNav />
      <PageHeader
        title="Team"
        aside="Who works at the practice. A new sign-in is created with a temporary password shown once; suspending refuses a sign-in until it is reactivated."
        action={
          adding ? null : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add a person
            </Button>
          )
        }
      />
      {created ? (
        <Note tone="attention">
          Sign-in created for {created.name}. Temporary password:{' '}
          <code className="team__password">{created.password}</code> — hand it over in person or by
          WhatsApp. It is shown once and not kept.
        </Note>
      ) : null}
      {error ? <Note tone="critical">{error}</Note> : null}
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
    </section>
  );
}
