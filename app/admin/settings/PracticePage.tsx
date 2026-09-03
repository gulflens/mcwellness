import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PracticeResponse, type Practice } from '../../api/practice/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { EMIRATE_LABELS } from './emirates';
import { PracticeDrawer } from './PracticeDrawer';
import './settings.css';

/**
 * Settings › Practice: who the practice is, on paper.
 *
 * Everything here is printed on a tax invoice or read off the trade licence,
 * so the page reads it back plainly and changes it deliberately — a summary
 * to look at, and a right-side drawer that asks why before it saves, the
 * shape the billing screens set.
 *
 * Only the owner and an admin ever reach it: the route checks
 * `canOpenSettings` (app/shell/adminAccess.ts), the API checks the same
 * `practice.settings.write` action, and `app.guard_tenant_identity`
 * (migration 905) refuses the write underneath both.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A date-only value is read at the practice's own midnight, not UTC's. */
function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00+04:00`));
}

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; practice: Practice }
  | { kind: 'refused' };

/** One fact and its answer. An empty answer says so rather than showing a gap. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? <span className="muted">Not recorded</span>}</dd>
    </>
  );
}

function text(value: string | null): ReactNode {
  return value === null || value.length === 0 ? null : value;
}

export function PracticePage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const { apiFetch } = useAuth();

  const load = useCallback(() => {
    void apiFetch('/api/practice')
      .then(async (res) => {
        if (res.status === 403) {
          setState({ kind: 'refused' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({
          kind: 'ready',
          practice: PracticeResponse.parse(await res.json()).practice,
        });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const openDrawer = useCallback(() => {
    setSavedNote(null);
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onSaved = useCallback((practice: Practice) => {
    setDrawerOpen(false);
    setState({ kind: 'ready', practice });
    setSavedNote('The practice details are saved.');
  }, []);

  const practice = state.kind === 'ready' ? state.practice : null;
  const address = practice?.address ?? null;
  const coordinates =
    address !== null && address.latitude !== null && address.longitude !== null
      ? `${address.latitude.toFixed(5)}, ${address.longitude.toFixed(5)}`
      : null;

  return (
    <section className="page">
      <PageHeader
        title="Practice"
        aside="What the practice is called, licensed as and registered for. Invoices copy it as it stands on the day they are issued."
        // Always present, so the header does not change height as the
        // details arrive and the tables beneath it do not shift.
        action={
          <Button variant="secondary" onClick={openDrawer} disabled={practice === null}>
            Edit details
          </Button>
        }
      />

      {savedNote ? (
        <div role="status">
          <Note>{savedNote}</Note>
        </div>
      ) : null}
      {state.kind === 'loading' ? <Note>Loading the practice details.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The practice details could not be loaded. Try again.</Note>
      ) : null}
      {state.kind === 'refused' ? (
        <Note tone="critical">
          These details are the owner&rsquo;s and an admin&rsquo;s to read and change.
        </Note>
      ) : null}

      {practice ? (
        <div className="practice">
          <section className="practice__group">
            <h2 className="practice__heading">Identity</h2>
            <dl className="practice__facts">
              <Fact label="Legal name">{practice.legalName}</Fact>
              <Fact label="Legal name in Arabic">
                {practice.legalNameAr ? (
                  <span lang="ar" dir="rtl">
                    {practice.legalNameAr}
                  </span>
                ) : null}
              </Fact>
              <Fact label="Trade licence number">{text(practice.licenceNumber)}</Fact>
              <Fact label="Licensing authority">{text(practice.licensingAuthority)}</Fact>
              <Fact label="Licence expires">
                {practice.licenceExpiresOn ? (
                  <span className="numeric">{formatDate(practice.licenceExpiresOn)}</span>
                ) : null}
              </Fact>
            </dl>
          </section>

          <section className="practice__group">
            <h2 className="practice__heading">Registered address</h2>
            <dl className="practice__facts">
              <Fact label="Address">{text(address?.displayAddress ?? null)}</Fact>
              <Fact label="Emirate">{address ? EMIRATE_LABELS[address.emirate] : null}</Fact>
              <Fact label="Coordinates">
                {coordinates ? <span className="numeric">{coordinates}</span> : null}
              </Fact>
            </dl>
          </section>

          <section className="practice__group">
            <h2 className="practice__heading">Tax</h2>
            <dl className="practice__facts">
              <Fact label="Tax registration number">
                {practice.taxRegistrationNumber ? (
                  <span className="numeric">{practice.taxRegistrationNumber}</span>
                ) : null}
              </Fact>
              <Fact label="Registered for VAT">{practice.vatRegistered ? 'Yes' : 'No'}</Fact>
              <Fact label="VAT registration number">
                {practice.vatTrn ? <span className="numeric">{practice.vatTrn}</span> : null}
              </Fact>
            </dl>
            {practice.vatRegistered ? null : (
              <p className="small muted">
                Invoices carry no VAT while the practice is not registered for it.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {drawerOpen && practice ? (
        <PracticeDrawer practice={practice} onClose={closeDrawer} onSaved={onSaved} />
      ) : null}
    </section>
  );
}
