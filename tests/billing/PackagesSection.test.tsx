// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PackagesSection } from '../../app/admin/billing/PackagesSection';
import { json, LEAD_PRACTITIONER, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * What a person sees on the Packages section: the practice's own Silver
 * package, the two prices it carries, and the door to selling it.
 */

const CONSULTATION = '00000004-0000-4000-8000-000000000002';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';

const SILVER = {
  id: '00000004-0000-4000-8000-000000000201',
  code: 'silver',
  name: 'Silver',
  nameAr: 'الفضية',
  listPriceFils: 1_215_000,
  expiryMonths: 12,
  status: 'active' as const,
  components: [
    {
      serviceTypeId: CONSULTATION,
      serviceTypeCode: 'consultation',
      serviceTypeName: 'Consultation',
      serviceTypeNameAr: null,
      quantity: 1,
      lineNo: 1,
      standaloneNetFils: 0,
    },
    {
      serviceTypeId: BRAIN_MAP,
      serviceTypeCode: 'brain-map',
      serviceTypeName: 'Brain map (QEEG)',
      serviceTypeNameAr: null,
      quantity: 2,
      lineNo: 2,
      standaloneNetFils: 82_500,
    },
    {
      serviceTypeId: NF_SESSION,
      serviceTypeCode: 'nf-session',
      serviceTypeName: 'Neurofeedback session',
      serviceTypeNameAr: null,
      quantity: 15,
      lineNo: 3,
      standaloneNetFils: 70_000,
    },
  ],
  currentPrice: {
    id: '00000004-0000-4000-8000-000000000301',
    amountFils: 1_032_500,
    vatRateBasisPoints: 500,
    vatFils: 51_625,
    grossFils: 1_084_125,
    validFrom: '2026-09-02',
    amendmentReason: "Launch pricing, ends on the founder's word.",
  },
  componentsTotalFils: 1_215_000,
  sellable: true,
};

const UNSELLABLE = {
  ...SILVER,
  id: '00000004-0000-4000-8000-000000000202',
  code: 'inquiry',
  name: 'Compassionate Inquiry course',
  nameAr: null,
  listPriceFils: 300_000,
  components: [
    {
      serviceTypeId: '00000004-0000-4000-8000-000000000006',
      serviceTypeCode: 'compassionate-inquiry',
      serviceTypeName: 'Compassionate Inquiry',
      serviceTypeNameAr: null,
      quantity: 6,
      lineNo: 1,
      standaloneNetFils: null,
    },
  ],
  currentPrice: null,
  componentsTotalFils: null,
  sellable: false,
};

function mount(me: unknown, packages: unknown[]) {
  return mountWith(me, <PackagesSection canWrite={me === OWNER} />, (url) =>
    url === '/api/billing/packages' ? json({ packages }) : null,
  );
}

describe('PackagesSection', () => {
  it("shows the practice's own package with what it contains", async () => {
    mount(OWNER, [SILVER]);
    expect(await screen.findByText('Silver')).toBeTruthy();
    expect(screen.getByText('الفضية')).toBeTruthy();
    expect(
      screen.getByText('1 × Consultation, 2 × Brain map (QEEG), 15 × Neurofeedback session'),
    ).toBeTruthy();
    expect(screen.getByText('12 months')).toBeTruthy();
  });

  it('shows the list price and the price now as two separate figures', async () => {
    mount(OWNER, [SILVER]);
    await screen.findByText('Silver');
    // AED 12,150 published, AED 10,325 charged, VAT on top of the second.
    expect(screen.getByText('12,150.00')).toBeTruthy();
    expect(screen.getByText('10,325.00')).toBeTruthy();
    expect(screen.getByText('516.25')).toBeTruthy();
    expect(screen.getByText('10,841.25')).toBeTruthy();
    expect(screen.getByText('List (AED)')).toBeTruthy();
    expect(screen.getByText('Price now')).toBeTruthy();
  });

  it('offers "Add package" and "Sell to a client" to the owner', async () => {
    mount(OWNER, [SILVER]);
    expect(await screen.findByRole('button', { name: 'Add package' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sell to a client' })).toBeTruthy();
  });

  it('offers neither to a lead practitioner, who reads the catalogue and does not sell', async () => {
    mount(LEAD_PRACTITIONER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Add package' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sell to a client' })).toBeNull();
  });

  it('says why a package cannot be sold rather than hiding it', async () => {
    mount(OWNER, [UNSELLABLE]);
    expect(await screen.findByText('Compassionate Inquiry course')).toBeTruthy();
    expect(screen.getByText('Needs a price for every service')).toBeTruthy();
    expect(screen.getByText('Not on sale')).toBeTruthy();
  });

  it('names a package whose list price has drifted from what its contents now cost', async () => {
    mount(OWNER, [{ ...SILVER, componentsTotalFils: 1_260_000 }]);
    expect(
      await screen.findByText(
        "Silver's list price no longer matches what its contents cost one at a time.",
      ),
    ).toBeTruthy();
  });

  it('keeps the row\u2019s action in the first column, where a narrow screen can still reach it', async () => {
    // The action used to sit in a column of its own at the far end of a table
    // that needed about 1,600px, so at 1024 — and at 1440 — it was off-screen
    // with no way to scroll a table that had no visible scrollbar. The first
    // column is the one the shell pins when the table scrolls sideways.
    mount(OWNER, [SILVER]);
    const sell = await screen.findByRole('button', { name: 'Sell to a client' });
    const cell = sell.closest('td');
    expect(cell).toBeTruthy();
    expect(cell?.parentElement?.firstElementChild).toBe(cell);
  });

  it('lets the contents and the price reason take a second line rather than widening the table', async () => {
    mount(OWNER, [SILVER]);
    const contents = await screen.findByText(
      '1 × Consultation, 2 × Brain map (QEEG), 15 × Neurofeedback session',
    );
    // `white-space` inherits, so a cell that holds a sentence sets it back.
    expect(contents.className).toContain('cell-wrap');
    expect(screen.getByText("Launch pricing, ends on the founder's word.").className).toContain(
      'cell-wrap',
    );
  });

  it('opens the sell drawer against the package that was clicked', async () => {
    mount(OWNER, [SILVER]);
    fireEvent.click(await screen.findByRole('button', { name: 'Sell to a client' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer.textContent).toContain('Sell Silver');
    // The price is read out, not typed: changing it means changing the list.
    expect(drawer.textContent).toContain(
      'The price on the list. To sell at a different figure, add a package price first.',
    );
    // Eighteen credits: one consultation, two brain maps, fifteen sessions.
    expect(drawer.textContent).toContain('18');
  });

  it('says so when the practice has no packages yet', async () => {
    mount(OWNER, []);
    expect(await screen.findByText('No packages are set up yet.')).toBeTruthy();
  });

  it('names the problem when the list fails to load', async () => {
    mountWith(OWNER, <PackagesSection canWrite />, (url) =>
      url === '/api/billing/packages' ? json({ error: 'forbidden' }, 403) : null,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'The packages could not be loaded. Try again.',
      ),
    );
  });
});
