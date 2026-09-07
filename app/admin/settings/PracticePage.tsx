import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  VAT_MANDATORY_THRESHOLD_FILS,
  VAT_VOLUNTARY_THRESHOLD_FILS,
  formatFils,
  vatThresholdStand,
} from '@domain/shared';
import { PracticeResponse, type Practice } from '../../api/practice/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { EMIRATE_LABELS } from './emirates';
import { PracticeDrawer } from './PracticeDrawer';
import { PracticeLogo } from './PracticeLogo';
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

/**
 * Where the practice stands against the two VAT registration marks, in words
 * (migration 953, domain/shared/vat-threshold.ts).
 *
 * The figure is counted from the invoice book and the marks are the Federal
 * Tax Authority's. **Nothing here turns the switch**: an invoice may not carry
 * VAT until the authority has issued the number the row requires (migration
 * 905), and the thirty-day forward test cannot be worked out from a ledger at
 * all. Past the second mark the page says so on every visit until the switch
 * is on, which is the one place in this application something repeats itself
 * — and it repeats because the consequence of missing it is a penalty from
 * the tax authority rather than an inconvenience.
 *
 * **One notice, and only past the second mark** (the fix round of trunk round
 * 31). The first build added a second notice at the voluntary mark and told
 * the reader at the mandatory one to go and apply. The plan asks for the two
 * marks on the page and the duty sentence past the second, and no more:
 * passing the voluntary mark changes nothing the practice must do, so a
 * notice about it repeats itself to no consequence, which is the pattern the
 * anti-engagement rule exists to refuse — and the paragraph above already
 * says whose act registering is. The mark itself stays in the list, where a
 * reader can see where the practice stands against both.
 */
function VatWatch({ practice }: { practice: Practice }) {
  const stand = vatThresholdStand(practice.vatTaxableSuppliesFils);
  return (
    <>
      <dl className="practice__facts">
        <Fact label="Taxable supplies, last twelve months (AED)">
          <span className="numeric">{formatFils(practice.vatTaxableSuppliesFils)}</span>
        </Fact>
        <Fact label="Registering becomes a choice at (AED)">
          <span className="numeric">{formatFils(VAT_VOLUNTARY_THRESHOLD_FILS)}</span>
        </Fact>
        <Fact label="Registering becomes a duty at (AED)">
          <span className="numeric">{formatFils(VAT_MANDATORY_THRESHOLD_FILS)}</span>
        </Fact>
      </dl>
      <p className="small muted">
        Counted from every invoice issued in the twelve months to{' '}
        <span className="numeric">{formatDate(practice.vatTaxableSuppliesAsOf)}</span>, net of VAT.
        Registering is the practice&rsquo;s own act: turning the switch on here does not register
        it, and the Federal Tax Authority issues the number an invoice has to print.
      </p>
      {stand === 'mandatory' && !practice.vatRegistered ? (
        <Note tone="critical">
          Taxable supplies have passed AED {formatFils(VAT_MANDATORY_THRESHOLD_FILS)}. Registering
          for VAT is a duty within thirty days of passing it.
        </Note>
      ) : null}
    </>
  );
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

      {/*
        Always rendered, never mounted on demand: a live region has to exist
        before the text lands in it or a screen reader announces nothing. The
        wrapper carries the gap itself, so the note never sits flush against
        the "Identity" heading beneath it.
      */}
      <div role="status" className="practice__status">
        {savedNote ? <Note>{savedNote}</Note> : null}
      </div>
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
              <Fact label="Trade licence number">{text(practice.licenceNumber)}</Fact>
              <Fact label="Licensing authority">{text(practice.licensingAuthority)}</Fact>
              <Fact label="Licence expires">
                {practice.licenceExpiresOn ? (
                  <span className="numeric">{formatDate(practice.licenceExpiresOn)}</span>
                ) : null}
              </Fact>
              {/*
                The number the client portal's "ask for a visit" button opens
                (migration 910, docs/SPEC/client-portal.md section 3.1).
                Beneath the identity because it is a fact about the practice
                rather than about an invoice.
              */}
              <Fact label="WhatsApp number">
                {practice.whatsappNumber ? (
                  <span className="numeric">{practice.whatsappNumber}</span>
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
              <Fact label="Corporate tax registration number">
                {practice.taxRegistrationNumber ? (
                  <span className="numeric">{practice.taxRegistrationNumber}</span>
                ) : null}
              </Fact>
              <Fact label="Registered for VAT">{practice.vatRegistered ? 'Yes' : 'No'}</Fact>
              <Fact label="VAT registration number">
                {practice.vatTrn ? <span className="numeric">{practice.vatTrn}</span> : null}
              </Fact>
            </dl>
            <p className="small muted">
              &ldquo;Tax registration number&rdquo; is what the Federal Tax Authority calls a VAT
              registration, so the field above names corporate tax on its face. It is the number the
              practice holds for corporate tax and is never printed as a VAT one. Recording a VAT
              registration does not change what an invoice charges: VAT is worked out from the
              practice&rsquo;s standard rate today, whichever way the switch is set.
            </p>
            <VatWatch practice={practice} />
          </section>

          <PracticeLogo />
        </div>
      ) : null}

      {drawerOpen && practice ? (
        <PracticeDrawer practice={practice} onClose={closeDrawer} onSaved={onSaved} />
      ) : null}
    </section>
  );
}
