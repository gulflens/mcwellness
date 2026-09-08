import { useCallback, useEffect, useState } from 'react';
import {
  EMIRATES,
  PractitionerListResponse,
  type PractitionerRow,
} from '../../api/practitioners/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { EMIRATE_LABELS } from './emirates';
import { PractitionerBaseDrawer } from './PractitionerBaseDrawer';
import { SettingsNav } from './SettingsNav';
import './settings.css';

/**
 * Settings › Practitioners: who treats, and where each one's driving day
 * starts (docs/SPEC/route-planning.md section 5.4, migration 913).
 *
 * The operator asked for this on 8 September 2026: *"This is Shauna's home,
 * every practioner can add their own address."* Until then the home base
 * reached production only by a data step (route-planning decision 14).
 *
 * **What the table shows, and what it will not show.** A name, whether a base
 * is recorded, and the emirate it is in. Not the coordinate: a table read
 * across a desk is the wrong place for the position of somebody's front door,
 * and a person who needs the number opens the drawer, which is one act the
 * trail already records. The route sends no address and no arrival notes at
 * all, so there is nothing else here to leave out.
 *
 * The office sees the whole practice. A practitioner sees one row, their own,
 * and the answer says so rather than letting a practice of three look like a
 * practice of one.
 */

/**
 * Where the drawer opens when there is no base yet. The practice's own
 * default emirate lives on `GET /api/practice`, which is the owner's and an
 * admin's alone, and a practitioner setting their own base must not be sent
 * to a screen they cannot read to fill in this one. So the list's first entry
 * stands in — Dubai, which is where the practice is — and the drawer is a
 * one-tap change for anybody it is wrong for.
 */
const FIRST_EMIRATE = EMIRATES[0];

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'refused' }
  | { kind: 'ready'; practitioners: PractitionerRow[]; scope: 'own' | null };

export function PractitionersPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState<PractitionerRow | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const { apiFetch } = useAuth();

  const load = useCallback(() => {
    void apiFetch('/api/practitioners')
      .then(async (res) => {
        if (res.status === 403) {
          setState({ kind: 'refused' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const answer = PractitionerListResponse.parse(await res.json());
        setState({
          kind: 'ready',
          practitioners: [...answer.practitioners],
          scope: answer.scope,
        });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const onSaved = useCallback((saved: PractitionerRow) => {
    setEditing(null);
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            practitioners: current.practitioners.map((person) =>
              person.id === saved.id ? saved : person,
            ),
          }
        : current,
    );
    setSavedNote('The home base is saved.');
  }, []);

  const columns: readonly Column<PractitionerRow>[] = [
    {
      key: 'name',
      header: 'Practitioner',
      render: (person) => (
        <>
          {person.displayName}
          {person.isYou ? <span className="small muted"> (you)</span> : null}
        </>
      ),
    },
    {
      key: 'base',
      header: 'Home base',
      render: (person) =>
        person.base === null ? <span className="muted">Not set</span> : 'Recorded',
    },
    {
      key: 'emirate',
      header: 'Emirate',
      render: (person) =>
        person.base === null ? (
          <span className="muted">—</span>
        ) : (
          EMIRATE_LABELS[person.base.emirate]
        ),
    },
    {
      key: 'set',
      header: 'Actions',
      align: 'end',
      render: (person) => (
        <Button
          variant="secondary"
          onClick={() => {
            setSavedNote(null);
            setEditing(person);
          }}
        >
          {person.base === null ? 'Set the home base' : 'Change the home base'}
        </Button>
      ),
    },
  ];

  return (
    <section className="page">
      <SettingsNav />
      <PageHeader
        title="Practitioners"
        aside="Where each practitioner's driving day starts and ends. The practice keeps the coordinate and nothing else."
      />

      {/*
        Always rendered, never mounted on demand: a live region has to exist
        before the text lands in it or a screen reader announces nothing.
      */}
      <div role="status" className="practice__status">
        {savedNote ? <Note>{savedNote}</Note> : null}
      </div>
      {state.kind === 'loading' ? <Note>Loading the practitioners.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The practitioners could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'refused' ? (
        <Note tone="critical">
          A home base is the practitioner&rsquo;s own to set, and the office&rsquo;s to correct.
        </Note>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          {state.scope === 'own' ? (
            <Note>
              You are shown your own home base. Everybody else&rsquo;s is theirs and the
              office&rsquo;s.
            </Note>
          ) : null}
          <Table
            columns={columns}
            rows={state.practitioners}
            rowKey={(person) => person.id}
            caption="Practitioners and their home bases"
            empty="No practitioner is recorded yet."
          />
          <p className="small muted">
            A day with no home base has no first drive: the day map draws no pin before the first
            visit, and &ldquo;Optimise the day&rdquo; counts no drive out and none home.
          </p>
        </>
      ) : null}

      {editing ? (
        <PractitionerBaseDrawer
          practitioner={editing}
          defaultEmirate={FIRST_EMIRATE}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : null}
    </section>
  );
}
