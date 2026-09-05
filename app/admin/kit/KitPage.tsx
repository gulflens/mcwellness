import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KIT_KINDS, isCalibrationOverdue, type KitKind } from '@domain/session';
import { KitListResponse, KitOptionsResponse, type KitRow } from '../../api/kit/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { StatusChip, type StatusTone } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import { useDrawer } from '../../shell/components/useDrawer';
import './kit.css';

/**
 * Settings › Kit — the practice's own instruments
 * (docs/SPEC/practitioner-phone.md section 6.4).
 *
 * The console's own manner: a dense table, hairline rules, 44px rows, and a
 * right-side drawer rather than a modal (docs/DESIGN-BRIEF.md section 6.2).
 * The owner, an admin and the lead practitioner reach it; the route says the
 * same and `db/policies/session/kit.sql` refuses the rows underneath both.
 *
 * **The overdue ones carry the status dot and nothing louder.** An amplifier
 * out of calibration stops a check-in, which is where the practitioner is told
 * about it in words; here it is a row in a register, and a register is scanned.
 *
 * **A calibration is a date.** The drawer records the day the certificate was
 * issued and the day it runs out, which is the only date the practice actually
 * has. Everything else about an instrument — where it has been, what it has
 * been cleaned with — is a Phase 2 table hanging off this one
 * (docs/SPEC/00-data-model.md section 5), deliberately not here.
 */

const KIND_LABELS: Record<KitKind, string> = {
  amplifier: 'Amplifier',
  laptop: 'Laptop',
  electrode_set: 'Electrode set',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function on(iso: string | null): string {
  return iso === null ? '' : dateFormat.format(new Date(iso));
}

/**
 * A timestamp back as the date the drawer's own field wants, read in the
 * practice's own zone.
 *
 * It has to be Dubai and not UTC. The route stores a calibration date as Dubai
 * midnight (`app/api/kit/routes.ts`'s `atPracticeMidnight`), so
 * `2027-06-30T00:00:00+04:00` comes back out as an instant whose UTC date is
 * the 29th; a field filled from that and sent again would walk the calibration
 * back a day on every edit. `en-CA` is the locale whose numeric date is
 * already the `YYYY-MM-DD` an `<input type="date">` wants.
 */
const dateInputFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function asDateInput(iso: string | null): string {
  return iso === null ? '' : dateInputFormat.format(new Date(iso));
}

/**
 * What the register says about one item. Three states and no fourth: an item
 * the practice has stood down, one whose calibration has lapsed, and one that
 * is simply in service.
 */
function statusOf(row: KitRow, now: Date): { label: string; tone: StatusTone } {
  if (row.status === 'inactive') return { label: 'Stood down', tone: 'neutral' };
  const overdue = isCalibrationOverdue(
    {
      status: 'active',
      calibrationDueAt: row.calibrationDueAt === null ? null : new Date(row.calibrationDueAt),
    },
    now,
  );
  if (overdue) return { label: 'Calibration overdue', tone: 'critical' };
  return { label: 'In service', tone: 'ok' };
}

type Loaded<T> =
  { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'refused' } | { kind: 'error' };

type Draft = {
  serial: string;
  model: string;
  kind: KitKind;
  status: 'active' | 'inactive';
  assignedPractitionerId: string;
  lastCalibratedAt: string;
  calibrationDueAt: string;
};

function draftFrom(row: KitRow | null): Draft {
  return {
    serial: row?.serial ?? '',
    model: row?.model ?? '',
    kind: row?.kind ?? 'amplifier',
    status: row?.status ?? 'active',
    assignedPractitionerId: row?.assignedPractitionerId ?? '',
    lastCalibratedAt: asDateInput(row?.lastCalibratedAt ?? null),
    calibrationDueAt: asDateInput(row?.calibrationDueAt ?? null),
  };
}

/** What the field carries on the wire: a date, or nothing at all. */
function orNull(value: string): string | null {
  return value === '' ? null : value;
}

/**
 * What the drawer actually changed, and nothing else (section 6.4: "a
 * calibration is a PATCH of two dates").
 *
 * Sending the whole draft on every edit meant that changing an item's model
 * also re-sent both calibration dates, so a field the person never touched was
 * written back — and any rounding in the way it was read became a real move of
 * the date. A PATCH now carries the fields that differ from the item as it was
 * opened, so an edit to one thing is an edit to one thing.
 */
function changedFields(before: Draft, after: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (after.serial.trim() !== before.serial.trim()) body.serial = after.serial.trim();
  if (after.model.trim() !== before.model.trim()) body.model = after.model.trim();
  if (after.kind !== before.kind) body.kind = after.kind;
  if (after.status !== before.status) body.status = after.status;
  if (after.assignedPractitionerId !== before.assignedPractitionerId) {
    body.assignedPractitionerId = orNull(after.assignedPractitionerId);
  }
  if (after.lastCalibratedAt !== before.lastCalibratedAt) {
    body.lastCalibratedAt = orNull(after.lastCalibratedAt);
  }
  if (after.calibrationDueAt !== before.calibrationDueAt) {
    body.calibrationDueAt = orNull(after.calibrationDueAt);
  }
  return body;
}

const SAVE_ERRORS: Record<string, string> = {
  serial_exists: 'The practice already has an item with that serial number.',
  calibration_dates: 'A calibration cannot run out before the day it was done.',
  practitioner_not_found: 'That practitioner is not one this practice has working.',
  reason_required: 'Say why this is changing. The register keeps the reason.',
  invalid_request: 'Check the serial number and the model, then try again.',
};

function KitDrawer({
  item,
  practitioners,
  onClose,
  onSaved,
}: {
  /** Null when the drawer is adding an item rather than editing one. */
  item: KitRow | null;
  practitioners: readonly { id: string; displayName: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The item as it was opened, which is what an edit is measured against.
  const opened = useMemo(() => draftFrom(item), [item]);
  const [draft, setDraft] = useState<Draft>(opened);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const save = useCallback(async () => {
    const body =
      item === null
        ? {
            serial: draft.serial.trim(),
            model: draft.model.trim(),
            kind: draft.kind,
            assignedPractitionerId: orNull(draft.assignedPractitionerId),
            lastCalibratedAt: orNull(draft.lastCalibratedAt),
            calibrationDueAt: orNull(draft.calibrationDueAt),
          }
        : changedFields(opened, draft);
    if (Object.keys(body).length === 0) {
      // Nothing was changed, so there is nothing to say. Closing is the honest
      // answer; a PATCH with an empty body would be refused, and one carrying
      // the whole item would write fields nobody touched.
      onSaved();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(item === null ? '/api/kit' : `/api/kit/${item.id}`, {
        method: item === null ? 'POST' : 'PATCH',
        headers: {
          'content-type': 'application/json',
          // A change to the register changes what a practitioner may check in
          // with, so the trail keeps why. Adding an item needs none: the row
          // itself is the record of it arriving.
          ...(item === null ? {} : { 'x-reason': reason.trim() }),
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved();
        return;
      }
      const answer = (await res.json().catch(() => null)) as { code?: string } | null;
      setError(SAVE_ERRORS[answer?.code ?? ''] ?? 'That could not be saved. Try again.');
    } catch {
      setError('That could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }, [apiFetch, draft, item, onSaved, opened, reason]);

  const canSave =
    draft.serial.trim().length > 0 &&
    draft.model.trim().length > 0 &&
    (item === null || reason.trim().length > 0) &&
    !busy;

  return (
    <aside className="drawer" role="dialog" aria-labelledby="kit-drawer-title" ref={drawerRef}>
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="kit-drawer-title">{item === null ? 'Add an item' : item.serial}</h2>
          {item === null ? null : <p className="small muted">{item.model}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <div className="drawer__form">
          <Field
            id="kit-serial"
            label="Serial number"
            value={draft.serial}
            onChange={(e) => setDraft({ ...draft, serial: e.target.value })}
          />
          <Field
            id="kit-model"
            label="Model"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
          <Select
            id="kit-kind"
            label="What it is"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as KitKind })}
          >
            {KIT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
          <Select
            id="kit-assigned"
            label="Carried by"
            hint="Nobody means a spare on the shelf, and a spare blocks nobody's check-in."
            value={draft.assignedPractitionerId}
            onChange={(e) => setDraft({ ...draft, assignedPractitionerId: e.target.value })}
          >
            <option value="">Nobody</option>
            {practitioners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </Select>
          <Field
            id="kit-last-calibrated"
            label="Last calibrated"
            type="date"
            value={draft.lastCalibratedAt}
            onChange={(e) => setDraft({ ...draft, lastCalibratedAt: e.target.value })}
          />
          <Field
            id="kit-due"
            label="Calibration runs out"
            hint="Leave both empty for anything that is never calibrated."
            type="date"
            value={draft.calibrationDueAt}
            onChange={(e) => setDraft({ ...draft, calibrationDueAt: e.target.value })}
          />
          {item === null ? null : (
            <>
              <Select
                id="kit-status"
                label="In the register"
                hint="An item is stood down, never removed: a visit that ran on it still names it."
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as 'active' | 'inactive' })
                }
              >
                <option value="active">In service</option>
                <option value="inactive">Stood down</option>
              </Select>
              <Field
                id="kit-reason"
                label="Reason"
                hint="Kept on the register's own trail."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
          <div role="status">{error ? <Note tone="critical">{error}</Note> : null}</div>
          <div className="drawer__actions">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function KitPage() {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<Loaded<readonly KitRow[]>>({ kind: 'loading' });
  const [practitioners, setPractitioners] = useState<
    readonly { id: string; displayName: string }[]
  >([]);
  const [drawer, setDrawer] = useState<{ open: boolean; item: KitRow | null }>({
    open: false,
    item: null,
  });
  // A minute is plenty: a calibration lapses at a moment, and the row it
  // affects should not need a reload to say so.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const load = useCallback(() => {
    void apiFetch('/api/kit')
      .then(async (res) => {
        if (res.status === 403) return setState({ kind: 'refused' });
        if (!res.ok) return setState({ kind: 'error' });
        const parsed = KitListResponse.safeParse(await res.json());
        setState(parsed.success ? { kind: 'ready', data: parsed.data.kit } : { kind: 'error' });
      })
      .catch(() => setState({ kind: 'error' }));
    void apiFetch('/api/kit/options')
      .then(async (res) => {
        if (!res.ok) return;
        const parsed = KitOptionsResponse.safeParse(await res.json());
        if (parsed.success) setPractitioners(parsed.data.practitioners);
      })
      .catch(() => {
        // The picker falls back to "Nobody" alone, which is still a usable
        // drawer: an item can be added and assigned later.
      });
  }, [apiFetch]);

  useEffect(load, [load]);

  const columns: readonly Column<KitRow>[] = [
    { key: 'serial', header: 'Serial', numeric: true, render: (row) => row.serial },
    { key: 'model', header: 'Model', render: (row) => row.model },
    {
      key: 'kind',
      header: 'What it is',
      render: (row) => <span className="small">{KIND_LABELS[row.kind]}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const status = statusOf(row, now);
        return <StatusChip label={status.label} tone={status.tone} />;
      },
    },
    {
      key: 'assigned',
      header: 'Carried by',
      render: (row) =>
        row.assignedTo === null ? <span className="small muted">Nobody</span> : row.assignedTo,
    },
    {
      key: 'calibrated',
      header: 'Last calibrated',
      numeric: true,
      render: (row) => on(row.lastCalibratedAt),
    },
    { key: 'due', header: 'Runs out', numeric: true, render: (row) => on(row.calibrationDueAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (row) => <Button onClick={() => setDrawer({ open: true, item: row })}>Open</Button>,
    },
  ];

  return (
    <section className="page">
      <PageHeader
        title="Kit"
        aside="Every instrument the practice owns, who carries it and when its calibration runs out. A check-in is refused on an amplifier whose calibration has lapsed."
        action={
          <Button variant="primary" onClick={() => setDrawer({ open: true, item: null })}>
            Add an item
          </Button>
        }
      />

      {state.kind === 'refused' ? (
        <Note tone="critical">
          The register is the owner&rsquo;s, an admin&rsquo;s and the lead practitioner&rsquo;s.
        </Note>
      ) : null}
      {state.kind === 'loading' ? <Note>Loading the register.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The register could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'ready' ? (
        <Table
          caption="Every instrument the practice owns, with its calibration"
          columns={columns}
          rows={state.data}
          rowKey={(row) => row.id}
          empty={<Note>Nothing is on the register yet.</Note>}
        />
      ) : null}

      {drawer.open ? (
        <KitDrawer
          item={drawer.item}
          practitioners={practitioners}
          onClose={() => setDrawer({ open: false, item: null })}
          onSaved={() => {
            setDrawer({ open: false, item: null });
            load();
          }}
        />
      ) : null}
    </section>
  );
}
