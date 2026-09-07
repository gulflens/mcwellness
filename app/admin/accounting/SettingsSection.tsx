import { useCallback, useEffect, useState } from 'react';
import { SettingsResponse, YearsResponse, type YearRow } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { LockDrawer } from './LockDrawer';
import { ReasonDrawer } from './ReasonDrawer';
import { SettingsDrawer } from './SettingsDrawer';
import { formatDate, formatFils } from './money';

/**
 * The books' settings and the practice's financial years
 * (docs/SPEC/accounting.md section 5.5). Everything on this screen is read by
 * the owner and by finance; only the owner is offered a button, because closing
 * a year, moving the lock and changing the settings are the owner's alone.
 */

const CLOSE_REFUSALS: Record<string, string> = {
  year_not_closable:
    'The year is still running, or something dated inside it is not yet in the books.',
  reason_required: 'Say why the year is being closed.',
};
const REOPEN_REFUSALS: Record<string, string> = {
  year_not_closed: 'This year is already open.',
  reason_required: 'Say why the year is being reopened.',
};

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; settings: SettingsResponse; years: YearRow[] };

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="figures__figure">
      <p className="figures__label small muted">{label}</p>
      <p className="figures__value">{value}</p>
    </div>
  );
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function SettingsSection({ canChange }: { canChange: boolean }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [locking, setLocking] = useState(false);
  const [closing, setClosing] = useState<YearRow | null>(null);
  const [reopening, setReopening] = useState<YearRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    void Promise.all([apiFetch('/api/accounting/settings'), apiFetch('/api/accounting/years')])
      .then(async ([settingsRes, yearsRes]) => {
        if (!settingsRes.ok || !yearsRes.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({
          kind: 'ready',
          settings: SettingsResponse.parse(await settingsRes.json()),
          years: YearsResponse.parse(await yearsRes.json()).years,
        });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch, reloadKey]);

  if (state.kind === 'loading') {
    return <Note>Reading the books&apos; settings.</Note>;
  }
  if (state.kind === 'error') {
    return <Note tone="critical">The settings could not be read just now. Try again.</Note>;
  }

  const { settings, years } = state;
  const yearColumns: Column<YearRow>[] = [
    { key: 'starts', header: 'From', render: (row) => formatDate(row.startsOn) },
    { key: 'ends', header: 'To', render: (row) => formatDate(row.endsOn) },
    {
      key: 'status',
      header: 'State',
      render: (row) => (row.status === 'open' ? 'Open' : 'Closed'),
    },
    {
      key: 'why',
      header: 'Why',
      render: (row) => row.reopenReason ?? row.closeReason ?? '',
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) =>
        canChange ? (
          <Button
            variant="quiet"
            onClick={() => (row.status === 'open' ? setClosing(row) : setReopening(row))}
          >
            {row.status === 'open'
              ? `Close ${row.startsOn.slice(0, 4)}`
              : `Reopen ${row.startsOn.slice(0, 4)}`}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <section className="figures" aria-label="The books' settings">
        <Line label="The books start on" value={formatDate(settings.booksStartOn)} />
        <Line
          label="The financial year ends"
          value={`${settings.yearEndDay} ${MONTHS[settings.yearEndMonth - 1]}`}
        />
        <Line
          label="The books are locked through"
          value={settings.lockedThrough ? formatDate(settings.lockedThrough) : 'Nothing yet'}
        />
        <Line
          label="Corporate tax rate"
          value={`${settings.corporateTaxRateBasisPoints / 100} percent`}
        />
        <Line
          label="Taxable above"
          value={`AED ${formatFils(settings.corporateTaxThresholdFils)}`}
        />
        <Line
          label="Relief threshold"
          value={`AED ${formatFils(settings.smallBusinessReliefThresholdFils)}`}
        />
      </section>

      <Note>
        {settings.smallBusinessReliefElected
          ? 'Small Business Relief is elected.'
          : 'Small Business Relief is not elected.'}
      </Note>

      {settings.entryCount > 0 ? (
        <Note tone="muted">The year end can change only while the journal is empty.</Note>
      ) : null}

      {canChange ? (
        <div className="exports">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Change the settings
          </Button>
          <Button variant="secondary" onClick={() => setLocking(true)}>
            Lock through
          </Button>
        </div>
      ) : null}

      <Table
        caption="Financial years"
        columns={yearColumns}
        rows={years}
        rowKey={(row) => row.id}
        empty="No year has anything in it yet."
      />

      {editing ? (
        <SettingsDrawer
          settings={settings}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : null}

      {locking ? (
        <LockDrawer
          lockedThrough={settings.lockedThrough}
          onClose={() => setLocking(false)}
          onMoved={() => {
            setLocking(false);
            reload();
          }}
        />
      ) : null}

      {closing ? (
        <ReasonDrawer
          title="Close a financial year"
          what={`The year from ${formatDate(closing.startsOn)} to ${formatDate(
            closing.endsOn,
          )} will take no further entries.`}
          reasonLabel="Why this year is closed"
          submitLabel="Close the year"
          path={`/api/accounting/years/${closing.id}/close`}
          refusals={CLOSE_REFUSALS}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            reload();
          }}
        />
      ) : null}

      {reopening ? (
        <ReasonDrawer
          title="Reopen a financial year"
          what={`The year from ${formatDate(reopening.startsOn)} to ${formatDate(
            reopening.endsOn,
          )} will take entries again.`}
          reasonLabel="Why this year is reopened"
          submitLabel="Reopen the year"
          path={`/api/accounting/years/${reopening.id}/reopen`}
          refusals={REOPEN_REFUSALS}
          onClose={() => setReopening(null)}
          onDone={() => {
            setReopening(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}
