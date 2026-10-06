import { useEffect, useState } from 'react';
import { HelpersResponse, InviteResponse, type HelperRow } from '../../api/team/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';

/**
 * Helpers, in Settings › Team (round 76, docs/SPEC/dispatch.md section
 * 15.12): a member of the practitioner's family who drives and carries kit
 * on the day, signs in, and shares their own location while they help — and
 * reaches nothing else. The owner adds one, with a name, a sign-in address
 * and the practitioner they go with, and revokes one; an admin reads the list
 * and changes nothing on it, as with the staff (the operator's rule of 21
 * September 2026).
 *
 * A helper is listed here and not in the staff table above it: a helper has
 * no profile to keep and no working role to switch, and a working role
 * switched on for one by accident would open the client list to them.
 *
 * The temporary password is shown once and kept nowhere, exactly as a
 * colleague's is (the operator's decision of 10 September).
 */

const LOAD_ERROR = 'The helpers could not be loaded. Try again.';
const ACTION_ERROR = 'That could not be done. Reload and try again.';
const IN_USE = 'That email address already has a sign-in.';
const NOT_A_PRACTITIONER =
  'That practitioner is not working at the moment. Reload and choose again.';
const MISSING = 'A name, an email address and the practitioner they go with.';

function statusLabel(row: HelperRow): string {
  if (row.status === 'active') return row.accompanies === null ? 'Goes with nobody' : 'Active';
  return row.status === 'suspended' ? 'Revoked' : 'Archived';
}

export function TeamHelpers({ canManage }: { canManage: boolean }) {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<HelpersResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reload = () => setGeneration((g) => g + 1);

  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [practitionerId, setPractitionerId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  /** The helper whose "Revoke" was pressed once and waits for the second press. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/team/helpers')
      .then(async (res) => {
        const parsed = res.ok ? HelpersResponse.safeParse(await res.json()) : null;
        if (!live) return;
        if (parsed?.success) {
          setData(parsed.data);
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
  }, [apiFetch, generation]);

  async function add(): Promise<void> {
    setFormError(null);
    if (displayName.trim() === '' || email.trim() === '' || practitionerId === '') {
      setFormError(MISSING);
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/team/helpers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim(),
          practitionerId,
        }),
      });
      if (res.status === 201) {
        const parsed = InviteResponse.safeParse(await res.json());
        if (parsed.success) {
          setCreated({ name: displayName.trim(), password: parsed.data.temporaryPassword });
          setAdding(false);
          setDisplayName('');
          setEmail('');
          setPractitionerId('');
          reload();
          return;
        }
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(body.error === 'not_a_practitioner' ? NOT_A_PRACTITIONER : IN_USE);
        return;
      }
      if (res.status === 400) {
        setFormError('Check the name and the email address.');
        return;
      }
      setFormError(ACTION_ERROR);
    } catch {
      setFormError(ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: HelperRow): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/team/helpers/${row.userId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) setActionError(ACTION_ERROR);
    } catch {
      setActionError(ACTION_ERROR);
    } finally {
      setBusy(false);
      setConfirming(null);
      reload();
    }
  }

  const columns: readonly Column<HelperRow>[] = [
    { key: 'name', header: 'Name', render: (row) => row.displayName },
    {
      key: 'accompanies',
      header: 'Goes with',
      render: (row) => row.accompanies?.displayName ?? '—',
    },
    { key: 'status', header: 'Status', fit: true, render: statusLabel },
    {
      key: 'actions',
      header: '',
      fit: true,
      render: (row) =>
        !canManage || row.status !== 'active' ? null : confirming === row.userId ? (
          <span className="team__actions">
            <Button
              variant="primary"
              disabled={busy}
              aria-label={`Yes, revoke ${row.displayName}`}
              onClick={() => void revoke(row)}
            >
              Yes, revoke
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(null)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button
            variant="quiet"
            aria-label={`Revoke ${row.displayName}`}
            onClick={() => setConfirming(row.userId)}
          >
            Revoke
          </Button>
        ),
    },
  ];

  return (
    <section className="team__helpers" aria-labelledby="team-helpers-heading">
      <div className="team__helpers-head">
        <h2 id="team-helpers-heading">Helpers</h2>
        {canManage && !adding ? (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add a helper
          </Button>
        ) : null}
      </div>
      <p className="small muted">
        Family who help on the day. A helper signs in to share their own location while they help,
        and sees nothing else of the practice. Revoking one ends it, deletes their positions and
        shuts their sign-in.
      </p>
      {created ? (
        <Note tone="attention">
          Temporary password for {created.name}:{' '}
          <code className="team__password">{created.password}</code> — hand it over in person or by
          WhatsApp. It is shown once and not kept; they change it once signed in.
        </Note>
      ) : null}
      {adding ? (
        <form
          className="team__form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field
            id="helper-name"
            label="Helper’s name"
            value={displayName}
            maxLength={120}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Field
            id="helper-email"
            label="Helper’s email address"
            type="text"
            inputMode="email"
            value={email}
            maxLength={200}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            id="helper-practitioner"
            label="Goes with"
            value={practitionerId}
            onChange={(e) => setPractitionerId(e.target.value)}
          >
            <option value="">Choose a practitioner</option>
            {(data?.practitioners ?? []).map((practitioner) => (
              <option key={practitioner.practitionerId} value={practitioner.practitionerId}>
                {practitioner.displayName}
              </option>
            ))}
          </Select>
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="team__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Create the helper’s sign-in
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
      {actionError ? <Note tone="critical">{actionError}</Note> : null}
      {failed ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {data !== null ? (
        <Table
          caption="Helpers and whom each goes with"
          columns={columns}
          rows={data.helpers}
          rowKey={(row) => row.userId}
          empty={<Note>No helpers.</Note>}
        />
      ) : null}
    </section>
  );
}
