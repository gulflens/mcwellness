import { useEffect, useRef, useState } from 'react';
import type { Role } from '@domain/shared';
import { TeamProfile } from '../../api/team/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { TabPanel, Tabs, type Tab } from '../../shell/components/Tabs';
import { useDrawer } from '../../shell/components/useDrawer';
import { TeamAccessTab } from './TeamAccessTab';
import { TeamProfileTab, draftFrom, type ProfileDraft } from './TeamProfileTab';

/**
 * One colleague, opened from the team list: an employee's profile and the
 * access they hold (round 58, 2026-09-21,
 * docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md section
 * 8). A right-side drawer, never a modal dialog (docs/DESIGN-BRIEF.md section
 * 6.2), with the shell's own `useDrawer` — Escape closes it, the console behind
 * it goes inert, and focus returns to the Open button that opened it.
 *
 * Two tabs, and the strip is where pieces B and C add Documents and Pay;
 * nothing here anticipates them.
 *
 * **The drawer owns the profile and the tabs borrow it.** A role switched on,
 * a sign-in suspended and a profile saved all change the same row, and a tab
 * that kept its own copy would disagree with its sibling the moment somebody
 * used both. So the two tabs are given the profile and a way to say what it now
 * says; the drawer holds the one copy and reads it back from the server
 * whenever the answer cannot be worked out here — which is what a `conflict`
 * means (`app/api/team/roles.ts`).
 *
 * `GET /api/team/:id` is the owner's alone and is logged as a read of a person,
 * so this drawer is opened once per press and never polled.
 */

const TABS: readonly Tab[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'access', label: 'Access' },
];

const LOAD_ERROR = 'The profile could not be loaded. Try again.';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; profile: TeamProfile };

export function TeamMemberDrawer({
  memberId,
  onClose,
  onChanged,
}: {
  memberId: string;
  onClose: () => void;
  /** Something on this row changed: the list behind the drawer is stale. */
  onChanged: () => void;
}) {
  const { apiFetch, session } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [tab, setTab] = useState('profile');
  const [state, setState] = useState<State>({ kind: 'loading' });
  /**
   * What the Profile tab's boxes hold, kept here rather than in the tab: a
   * `TabPanel` unmounts the tab it is not showing, so a half-typed profile
   * would be thrown away by a glance at Access and the person would never be
   * told. `null` until somebody types, which is what makes a profile read back
   * from the server show through.
   */
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [generation, setGeneration] = useState(0);
  // A re-read never blanks what is on screen: the drawer keeps showing the
  // profile it has until the next answer lands, or says it could not be read.
  const reload = () => setGeneration((g) => g + 1);

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/team/${memberId}`)
      .then(async (res) => {
        if (!res.ok) {
          if (live) setState({ kind: 'error' });
          return;
        }
        const parsed = TeamProfile.safeParse(await res.json());
        if (live)
          setState(parsed.success ? { kind: 'ready', profile: parsed.data } : { kind: 'error' });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, memberId, generation]);

  function applyRoles(roles: Role[]) {
    setState((was) =>
      was.kind === 'ready' ? { kind: 'ready', profile: { ...was.profile, roles } } : was,
    );
  }

  function applyStatus(status: TeamProfile['status']) {
    setState((was) =>
      was.kind === 'ready' ? { kind: 'ready', profile: { ...was.profile, status } } : was,
    );
  }

  // Who is looking, from the same answer every other screen asks: the switches
  // are decided by the pure rule, and the rule needs the reader's own id.
  const me = session.status === 'signed-in' ? session.actor : null;

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-member-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="team-member-title">
            {state.kind === 'ready' ? state.profile.displayName : 'Profile'}
          </h2>
          {state.kind === 'ready' && state.profile.jobTitle !== null ? (
            <p className="small muted">{state.profile.jobTitle}</p>
          ) : null}
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
        <Tabs
          tabs={TABS}
          selected={tab}
          onSelect={setTab}
          idPrefix="team-member"
          label="Profile sections"
        />
        {state.kind === 'loading' ? <Note>Loading the profile.</Note> : null}
        {state.kind === 'error' ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
        {state.kind === 'ready' ? (
          <>
            <TabPanel id="profile" idPrefix="team-member" selected={tab}>
              <TeamProfileTab
                profile={state.profile}
                draft={draft ?? draftFrom(state.profile)}
                onDraft={setDraft}
                onSaved={() => {
                  // Saved, so the boxes and the row agree again: drop the draft
                  // and let what comes back from the server show through.
                  setDraft(null);
                  reload();
                  onChanged();
                }}
              />
            </TabPanel>
            <TabPanel id="access" idPrefix="team-member" selected={tab}>
              <TeamAccessTab
                profile={state.profile}
                viewerUserId={me?.userId ?? ''}
                viewerRoles={me?.roles ?? []}
                onRoles={applyRoles}
                onStatus={applyStatus}
                onReload={reload}
                onChanged={onChanged}
              />
            </TabPanel>
          </>
        ) : null}
      </div>
    </aside>
  );
}
