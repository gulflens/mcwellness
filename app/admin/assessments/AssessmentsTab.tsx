import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Comparison as ComparisonValue } from '@domain/assessment';
import {
  AssessmentListResponse,
  type AssessmentChain,
  type AssessmentRow,
} from '../../api/assessments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { Comparison } from './Comparison';
import { COMPARISON_MESSAGES } from './copy';
import { RecordDrawer } from './RecordDrawer';
import './assessments.css';

/**
 * The Assessments tab on the client record (docs/SPEC/assessment.md section
 * 3.1), mounted in `app/admin/clients/ClientDrawer.tsx`.
 *
 * A table in the console's manner: the date, the instrument, who recorded it,
 * whether a file is attached, and a word for its state. **A superseded version
 * sits beneath the one that replaced it, quiet, with its reason** — both stay,
 * because a measurement is a fact about a day and a fact about a day does not
 * change.
 *
 * Two actions: **Record**, and **Compare**, which is offered once two
 * measurements of one instrument exist.
 *
 * **The household never sees any of this.** Not the files, not the figures,
 * not the comparison; the route by which a measurement reaches a family is a
 * signed report and it is the only route (section 4). That is a rule in the
 * database rather than a screen with no link on it —
 * `db/policies/assessment/access.sql` grants a client contact nothing at all —
 * and this screen exists only in the console.
 */

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; chains: readonly AssessmentChain[] }
  | { kind: 'refused' }
  | { kind: 'error' };

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const INSTRUMENT_LABELS: Record<string, string> = {
  qeeg: 'Brain map',
  'questionnaire.sample': 'Questionnaire',
};

function on(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/**
 * Every measurement in the chain, current first, as flat rows for the table.
 *
 * The reason on a replaced line is **the reason it was replaced**, which lives
 * on the version that replaced it: `supersede_reason` says why the newer row
 * was written. So each superseded line takes the reason from the row above it
 * in the chain, which is what a reader is actually looking for beneath a
 * measurement that no longer stands (section 3.1).
 */
type Line = { row: AssessmentRow; superseded: boolean; reason: string | null };

function linesOf(chains: readonly AssessmentChain[]): Line[] {
  return chains.flatMap((chain) => {
    const versions = [chain.current, ...chain.superseded];
    return versions.map((row, index) => ({
      row,
      superseded: index > 0,
      reason: index === 0 ? null : (versions[index - 1]?.supersedeReason ?? null),
    }));
  });
}

export function AssessmentsTab({ clientId }: { clientId: string }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [comparison, setComparison] = useState<ComparisonValue | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // No `setState({ kind: 'loading' })` here: this runs from an effect on
  // first render, where a synchronous state change is a cascading render, and
  // on a reload after recording, where blanking a table the person is looking
  // at to say "loading" is worse than leaving it until the answer arrives.
  const load = useCallback(() => {
    void apiFetch(`/api/clients/${clientId}/assessments`)
      .then(async (res) => {
        if (res.status === 403 || res.status === 404) return setState({ kind: 'refused' });
        if (!res.ok) return setState({ kind: 'error' });
        const parsed = AssessmentListResponse.safeParse(await res.json());
        return setState(
          parsed.success ? { kind: 'ready', chains: parsed.data.assessments } : { kind: 'error' },
        );
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch, clientId]);

  useEffect(load, [load]);

  /**
   * Compare is offered once two current measurements of one instrument exist:
   * the two most recent of the first instrument that has two. Comparing a
   * superseded version with anything is not offered at all — the version that
   * stands is the measurement.
   */
  const pair = useMemo(() => {
    const chains = state.kind === 'ready' ? state.chains : [];
    const byInstrument = new Map<string, AssessmentRow[]>();
    for (const chain of chains) {
      const held = byInstrument.get(chain.current.instrument) ?? [];
      held.push(chain.current);
      byInstrument.set(chain.current.instrument, held);
    }
    for (const rows of byInstrument.values()) {
      if (rows.length >= 2) {
        const sorted = [...rows].sort((a, b) => (a.performedAt < b.performedAt ? -1 : 1));
        return [sorted[sorted.length - 2]!, sorted[sorted.length - 1]!] as const;
      }
    }
    return null;
  }, [state]);

  const compare = useCallback(async () => {
    if (!pair) return;
    setComparisonError(null);
    try {
      const res = await apiFetch(`/api/assessments/compare?ids=${pair[0].id},${pair[1].id}`);
      if (!res.ok) {
        const answer = (await res.json().catch(() => null)) as { code?: string } | null;
        setComparisonError(
          COMPARISON_MESSAGES[answer?.code ?? ''] ?? 'Those two could not be compared.',
        );
        return;
      }
      const body = (await res.json()) as { comparison: ComparisonValue };
      setComparison(body.comparison);
    } catch {
      setComparisonError('Those two could not be compared.');
    }
  }, [apiFetch, pair]);

  const columns: readonly Column<Line>[] = [
    {
      key: 'date',
      header: 'Taken on',
      numeric: true,
      render: (line) => on(line.row.performedAt),
    },
    {
      key: 'instrument',
      header: 'Instrument',
      render: (line) => INSTRUMENT_LABELS[line.row.instrument] ?? line.row.instrument,
    },
    {
      key: 'by',
      header: 'Recorded by',
      render: (line) =>
        line.row.performedBy ?? <span className="small muted">No longer with the practice</span>,
    },
    {
      key: 'files',
      header: 'Export',
      render: (line) =>
        line.row.files.length === 0 ? (
          <span className="small muted">None attached</span>
        ) : (
          <span className="small">
            {line.row.files.length} {line.row.files.length === 1 ? 'file' : 'files'}
          </span>
        ),
    },
    {
      key: 'state',
      header: 'State',
      render: (line) =>
        line.superseded ? (
          <span className="small">
            Replaced
            {line.reason ? <span className="assessments__reason small">{line.reason}</span> : null}
          </span>
        ) : (
          <span className="small">Stands</span>
        ),
    },
  ];

  return (
    <section className="assessments__section">
      <div className="assessments__actions">
        <Button variant="primary" onClick={() => setDrawerOpen(true)}>
          Record
        </Button>
        {pair ? <Button onClick={() => void compare()}>Compare</Button> : null}
      </div>

      {state.kind === 'loading' ? <Note>Loading the measurements.</Note> : null}
      {state.kind === 'refused' ? (
        <Note tone="critical">This record&rsquo;s measurements are not yours to read.</Note>
      ) : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The measurements could not be loaded. Try again.</Note>
      ) : null}

      {state.kind === 'ready' ? (
        <Table
          caption="Every measurement recorded for this client"
          columns={columns}
          rows={linesOf(state.chains)}
          rowKey={(line) => line.row.id}
          empty={<Note>Nothing has been measured for this client yet.</Note>}
        />
      ) : null}

      <div role="status">
        {comparisonError ? <Note tone="critical">{comparisonError}</Note> : null}
      </div>
      {comparison ? <Comparison comparison={comparison} /> : null}

      {drawerOpen ? (
        <RecordDrawer
          clientId={clientId}
          today={dayFormat.format(new Date())}
          onClose={() => setDrawerOpen(false)}
          onRecorded={() => {
            setDrawerOpen(false);
            setComparison(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}
