// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  // The term as the catalogue now carries it: a number with its unit beside
  // it (migration 412). The three live programmes will end up with none.
  term: { amount: 12, unit: 'month' as const },
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
    listPriceFils: 1_215_000,
    discountFils: 182_500,
    discountBasisPoints: null,
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

// The practice as it actually is: not registered for VAT, so the rate stamped
// on the price charges nothing and the total is the price (migration 406).
const SILVER_UNREGISTERED = {
  ...SILVER,
  currentPrice: { ...SILVER.currentPrice, vatFils: 0, grossFils: 1_032_500 },
};

const NO_VAT_NOTE =
  'The practice is not registered for VAT, so no VAT is charged and the total is the price.';

const GOLD_WITHDRAWN = {
  ...SILVER,
  id: '00000004-0000-4000-8000-000000000203',
  code: 'gold',
  name: 'Gold',
  nameAr: null,
  status: 'inactive' as const,
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

function mount(me: unknown, packages: unknown[], vatRegistered = true) {
  return mountWith(me, <PackagesSection canWrite={me === OWNER} />, (url) =>
    url === '/api/billing/packages' ? json({ packages, vatRegistered }) : null,
  );
}

describe('PackagesSection', () => {
  it("shows the practice's own package with what it contains", async () => {
    mount(OWNER, [SILVER]);
    expect(await screen.findByText('Silver')).toBeTruthy();
    // The package's Arabic name is on the row and is not drawn: the console is
    // English only (operator's decision of 7 September 2026,
    // docs/DESIGN-BRIEF.md section 10 item 4).
    expect(screen.queryByText('الفضية')).toBeNull();
    // One line per service in the bundle, in the order the package lists them.
    const contents = screen.getByRole('list', { name: 'Silver contents' });
    expect(
      within(contents)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1 × Consultation', '2 × Brain map (QEEG)', '15 × Neurofeedback session']);
    expect(screen.getByText('12 months')).toBeTruthy();
  });

  it('says a programme whose credits never expire has no expiry, rather than leaving a blank', async () => {
    // What every live programme reads as after the operator's ruling of
    // 12 September 2026: no term at all, and a column that says so in words.
    mount(OWNER, [{ ...SILVER, term: null }]);
    await screen.findByText('Silver');
    expect(screen.getByText('No expiry')).toBeTruthy();
    expect(screen.queryByText('12 months')).toBeNull();
  });

  it('shows the list price, the VAT and the total, with no separate Price now column', async () => {
    mount(OWNER, [SILVER]);
    await screen.findByText('Silver');
    // AED 12,150 published; VAT on top of what is charged, and the total.
    expect(screen.getByText('12,150.00')).toBeTruthy();
    expect(screen.getByText('516.25')).toBeTruthy();
    expect(screen.getByText('10,841.25')).toBeTruthy();
    expect(screen.getByText('List (AED)')).toBeTruthy();
    // The operator's decision of 20 October 2026: Price now mirrored Total.
    expect(screen.queryByText('Price now')).toBeNull();
    expect(screen.queryByText('10,325.00')).toBeNull();
  });

  it("puts the price's reason in the package's own tile, beneath its figures", async () => {
    mount(OWNER, [SILVER]);
    const tile = await screen.findByRole('article', { name: 'Silver' });
    expect(tile.querySelector('.tile__notes')?.textContent).toBe(
      "Launch pricing, ends on the founder's word.",
    );
  });

  it('lays the packages out as a row of tiles, one to a package, rather than a table', async () => {
    // The operator's decision of 20 October 2026: a nine-column table had to
    // scroll sideways on a tablet and a phone; a tile reflows instead.
    mount(OWNER, [SILVER, UNSELLABLE]);
    const grid = await screen.findByRole('list', { name: 'Packages' });
    expect(grid.className).toContain('package-grid');
    expect(
      within(grid)
        .getAllByRole('article')
        .map((tile) => tile.querySelector('h3')?.textContent),
    ).toEqual(['Silver', 'Compassionate Inquiry course']);
    expect(document.querySelector('table')).toBeNull();
  });

  it('offers no scroll buttons while every tile fits in the row', async () => {
    mount(OWNER, [SILVER, UNSELLABLE]);
    await screen.findByRole('list', { name: 'Packages' });
    expect(screen.queryByRole('button', { name: 'Previous packages' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next packages' })).toBeNull();
  });

  it('slides the row sideways a screen at a time once it is wider than its space', async () => {
    // One row, like a shelf of films: on a narrow screen the tiles run off the
    // edge and the row scrolls, rather than wrapping into a second row.
    mount(OWNER, [SILVER, UNSELLABLE]);
    const row = await screen.findByRole('list', { name: 'Packages' });
    const scrollBy = vi.fn();
    Object.defineProperties(row, {
      scrollWidth: { configurable: true, value: 900 },
      clientWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollBy: { configurable: true, value: scrollBy },
    });
    fireEvent.scroll(row);

    // At the start, only Next is offered.
    expect(screen.queryByRole('button', { name: 'Previous packages' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Next packages' }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 270 }));

    // At the end, only Previous.
    row.scrollLeft = 600;
    fireEvent.scroll(row);
    expect(await screen.findByRole('button', { name: 'Previous packages' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next packages' })).toBeNull();
  });

  it('names each figure beside its value, so a tile reads without a column header', async () => {
    mount(OWNER, [SILVER]);
    const tile = await screen.findByRole('article', { name: 'Silver' });
    const terms = Array.from(tile.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(terms).toEqual(['List (AED)', 'Discount', 'VAT', 'Runs for', 'Priced from']);
    const values = Array.from(tile.querySelectorAll('dd')).map((dd) => dd.textContent);
    expect(values).toEqual(['12,150.00', '1,825.00', '516.25', '12 months', expect.any(String)]);
  });

  it('says in one line that no VAT is charged while the practice is not registered', async () => {
    mount(OWNER, [SILVER_UNREGISTERED], false);
    await screen.findByText('Silver');
    // The sentence, the VAT column left where it is, and the total reading
    // the price: AED 10,325, once, in Total.
    expect(screen.getByText(NO_VAT_NOTE)).toBeTruthy();
    expect(screen.getByText('VAT')).toBeTruthy();
    expect(screen.getByText('0.00')).toBeTruthy();
    expect(screen.getAllByText('10,325.00')).toHaveLength(1);
  });

  it('says nothing extra once the practice is registered for VAT', async () => {
    mount(OWNER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.queryByText(NO_VAT_NOTE)).toBeNull();
    expect(screen.getByText('516.25')).toBeTruthy();
  });

  it('offers "Add package", "Sell to a client" and "Sell a session" to the owner', async () => {
    mount(OWNER, [SILVER]);
    expect(await screen.findByRole('button', { name: 'Add package' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sell to a client' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sell a session' })).toBeTruthy();
  });

  it('offers none of the three to a lead practitioner, who reads the catalogue and does not sell', async () => {
    mount(LEAD_PRACTITIONER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Add package' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sell to a client' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sell a session' })).toBeNull();
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

  it('says nothing about drift for a bundle that is withdrawn, even though its price still differs', async () => {
    // A withdrawn bundle is not on sale to anyone; whether its old list price
    // still matches its components is not a fact the practice needs raised.
    mount(OWNER, [SILVER, { ...GOLD_WITHDRAWN, componentsTotalFils: 1_260_000 }]);
    await screen.findByText('Silver');
    expect(
      screen.queryByText(
        "Gold's list price no longer matches what its contents cost one at a time.",
      ),
    ).toBeNull();
  });

  it("keeps every one of a package's actions inside its own tile", async () => {
    mount(OWNER, [SILVER]);
    const tile = await screen.findByRole('article', { name: 'Silver' });
    for (const name of ['Sell to a client', 'Edit Silver', 'Withdraw']) {
      expect(within(tile).getByRole('button', { name })).toBeTruthy();
    }
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

  it('opens the sell-a-session drawer beside the sell-a-package one', async () => {
    mountWith(OWNER, <PackagesSection canWrite />, (url) => {
      if (url === '/api/billing/packages') return json({ packages: [SILVER], vatRegistered: true });
      if (url === '/api/billing/prices') return json({ prices: [], vatRegistered: true });
      return null;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Sell a session' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer.textContent).toContain('Sell a session');
    // Selling one session does not touch the package catalogue: no reload.
    expect(screen.getByText('Silver')).toBeTruthy();
  });

  it('says so when the practice has no packages yet', async () => {
    mount(OWNER, []);
    expect(await screen.findByText('No packages are set up yet.')).toBeTruthy();
  });

  it('says every package is withdrawn, rather than that none are set up, when the fold holds them all', async () => {
    mount(OWNER, [GOLD_WITHDRAWN]);
    expect(await screen.findByText('Every package is withdrawn.')).toBeTruthy();
    expect(screen.queryByText('No packages are set up yet.')).toBeNull();
    expect(screen.getByText('Withdrawn (1)')).toBeTruthy();
  });

  it('shows Withdraw on an active package for the owner, and not for a lead practitioner', async () => {
    const owner = mount(OWNER, [SILVER]);
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeTruthy();
    owner.unmount();

    mount(LEAD_PRACTITIONER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('confirms once a package is withdrawn, naming it, the same way adding one does', async () => {
    let packages: unknown[] = [SILVER];
    mountWith(OWNER, <PackagesSection canWrite />, (url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/billing/packages' && method === 'GET') {
        return json({ packages, vatRegistered: true });
      }
      if (url === `/api/billing/packages/${SILVER.id}` && method === 'PATCH') {
        const withdrawn = { ...SILVER, status: 'inactive' as const };
        packages = packages.map((p) => ((p as { id: string }).id === SILVER.id ? withdrawn : p));
        return json({ package: withdrawn });
      }
      return null;
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    // The drawer's own submit button reads "Withdraw" too, so scope to it
    // rather than the row's button of the same name.
    const drawer = await screen.findByRole('dialog');
    fireEvent.change(within(drawer).getByLabelText('Why is it being withdrawn?'), {
      target: { value: 'No longer offered.' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Withdraw' }));

    // The row leaves into the fold, and a role="status" Note names what just
    // happened — the same kind PackageDrawer's onCreated sets.
    expect(await screen.findByText('Withdrawn (1)')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Silver withdrawn.');
  });

  it('lists a withdrawn package under a folded "Withdrawn (1)" disclosure, not in the grid', async () => {
    mount(OWNER, [SILVER, GOLD_WITHDRAWN]);
    await screen.findByText('Silver');
    const summary = screen.getByText('Withdrawn (1)').closest('summary');
    const fold = summary?.closest('details');
    expect(fold).toBeTruthy();
    // Folded shut until somebody opens it.
    expect(fold?.hasAttribute('open')).toBe(false);
    expect(fold?.textContent).toContain('Gold');
    // The disclosure marker a tablet reader actually sees: the platform's own
    // triangle is suppressed by CSS (round-62 review), so the summary carries
    // its own chevron rather than reading as a plain, unopenable line.
    expect(summary?.querySelector('.fold__chevron')).toBeTruthy();
    // "Not in the grid": the main grid carries only the active package,
    // whether the fold is open or shut.
    const grid = screen.getByRole('list', { name: 'Packages' });
    expect(grid.closest('details')).toBeNull();
    expect(grid.textContent).toContain('Silver');
    expect(grid.textContent).not.toContain('Gold');

    fireEvent.click(summary as HTMLElement);
    expect(await screen.findByRole('button', { name: 'Reinstate' })).toBeTruthy();
    // The `open` attribute is what the disclosure and the chevron's rotation
    // both key off, so the click must actually have toggled it.
    expect(fold?.hasAttribute('open')).toBe(true);
  });

  it('reinstates from the folded list, sending a fixed reason and JSON content-type', async () => {
    let packages: unknown[] = [SILVER, GOLD_WITHDRAWN];
    const { fetchImpl } = mountWith(OWNER, <PackagesSection canWrite />, (url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/billing/packages' && method === 'GET') {
        return json({ packages, vatRegistered: true });
      }
      if (url === `/api/billing/packages/${GOLD_WITHDRAWN.id}` && method === 'PATCH') {
        const reinstated = { ...GOLD_WITHDRAWN, status: 'active' };
        packages = packages.map((p) =>
          (p as { id: string }).id === GOLD_WITHDRAWN.id ? reinstated : p,
        );
        return json({ package: reinstated });
      }
      return null;
    });

    await screen.findByText('Silver');
    fireEvent.click(screen.getByText('Withdrawn (1)'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reinstate' }));

    // The section refetches: the fold empties once Gold is active again.
    await waitFor(() => expect(screen.queryByText('Withdrawn (1)')).toBeNull());
    expect(await screen.findByText('Gold')).toBeTruthy();

    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit | undefined][] } })
      .mock.calls;
    const patch = calls.find(
      ([calledUrl, init]) =>
        calledUrl === `/api/billing/packages/${GOLD_WITHDRAWN.id}` && init?.method === 'PATCH',
    );
    expect(patch).toBeTruthy();
    const [, init] = patch as [string, RequestInit];
    expect(new Headers(init.headers).get('x-reason')).toBe('Reinstated from the packages list');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'active' });
  });

  it('reads a failed Reinstate as critical, the same tone the load failure beside it carries', async () => {
    mountWith(OWNER, <PackagesSection canWrite />, (url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/billing/packages' && method === 'GET') {
        return json({ packages: [SILVER, GOLD_WITHDRAWN], vatRegistered: true });
      }
      if (url === `/api/billing/packages/${GOLD_WITHDRAWN.id}` && method === 'PATCH') {
        return json({ error: 'server_error' }, 500);
      }
      return null;
    });

    await screen.findByText('Silver');
    fireEvent.click(screen.getByText('Withdrawn (1)'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reinstate' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This package could not be reinstated. Try again.',
    );
    // Gold is still in the fold: the failed PATCH changed nothing.
    expect(screen.getByText('Withdrawn (1)')).toBeTruthy();
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

describe('the discount column', () => {
  it('names what came off the list price', async () => {
    mount(OWNER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.getByText('Discount')).toBeTruthy();
    // A sum, because the founder named the price now rather than a share.
    expect(screen.getByText('1,825.00')).toBeTruthy();
  });
});

/**
 * The practice orders its packages by hand (operator, 20 October 2026): one
 * Reorder button at the top of the section opens a board where a package is
 * held and carried to its place. The tiles carry no arrows.
 */
describe('PackagesSection, ordering', () => {
  const GOLD = {
    ...SILVER,
    id: '00000004-0000-4000-8000-000000000204',
    code: 'gold',
    name: 'Gold',
  };
  const PLATINUM = {
    ...SILVER,
    id: '00000004-0000-4000-8000-000000000205',
    code: 'platinum',
    name: 'Platinum',
  };

  function boardNames(): string[] {
    const board = screen.getByRole('list', { name: 'Packages order' });
    return within(board)
      .getAllByRole('button')
      .map((card) => card.querySelector('.reorder__name')?.textContent ?? '');
  }

  function reorderCalls(fetchImpl: unknown): [string, RequestInit][] {
    return (
      fetchImpl as { mock: { calls: [string, RequestInit | undefined][] } }
    ).mock.calls.filter(([url]) => url === '/api/billing/packages/reorder') as [
      string,
      RequestInit,
    ][];
  }

  function mountOrdering(answer: () => Response | null = () => null) {
    let packages = [SILVER, GOLD, PLATINUM];
    return mountWith(OWNER, <PackagesSection canWrite />, (url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/billing/packages' && method === 'GET') {
        return json({ packages, vatRegistered: true });
      }
      if (url === '/api/billing/packages/reorder') {
        const failed = answer();
        if (failed) return failed;
        const { order } = JSON.parse(String(init?.body)) as { order: string[] };
        packages = order.map((id) => packages.find((p) => p.id === id)!);
        return json({ packages, vatRegistered: true });
      }
      return null;
    });
  }

  it('draws no arrows on the tiles, and offers one Reorder button for the whole list', async () => {
    mount(OWNER, [SILVER, GOLD, PLATINUM]);
    await screen.findByText('Platinum');
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Reorder' })).toHaveLength(1);
  });

  it('offers no Reorder for a single package, or to someone who cannot change the catalogue', async () => {
    mount(OWNER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull();
    cleanup();
    mount(LEAD_PRACTITIONER, [SILVER, GOLD]);
    await screen.findByText('Gold');
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull();
  });

  it('opens a board of every package in order, and Done closes it', async () => {
    mountOrdering();
    fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }));
    expect(boardNames()).toEqual(['Silver', 'Gold', 'Platinum']);
    // The tiles and their buttons step aside while the order is being set.
    expect(screen.queryByRole('button', { name: 'Sell to a client' })).toBeNull();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(done);
    expect(screen.queryByRole('list', { name: 'Packages order' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Sell to a client' })).toHaveLength(3);
  });

  it('carries a held package over another to take its place, and saves the whole order once', async () => {
    const { fetchImpl } = mountOrdering();
    fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }));
    const platinum = screen.getByRole('button', { name: 'Platinum, position 3 of 3' });
    const silver = screen.getByRole('button', { name: 'Silver, position 1 of 3' });

    // jsdom lays nothing out, so the point under the finger is answered here.
    const original = document.elementFromPoint;
    document.elementFromPoint = () => silver;
    try {
      fireEvent.pointerDown(platinum, { button: 0, pointerId: 1 });
      fireEvent.pointerMove(platinum, { pointerId: 1 });
      // The others make way while it is still held; nothing is saved yet.
      expect(boardNames()).toEqual(['Platinum', 'Silver', 'Gold']);
      expect(reorderCalls(fetchImpl)).toHaveLength(0);
      fireEvent.pointerUp(platinum, { pointerId: 1 });
    } finally {
      document.elementFromPoint = original;
    }

    await waitFor(() => expect(reorderCalls(fetchImpl)).toHaveLength(1));
    const [, init] = reorderCalls(fetchImpl)[0]!;
    expect(new Headers(init.headers).get('x-reason')).toBe('Reordered in the packages list');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ order: [PLATINUM.id, SILVER.id, GOLD.id] });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const grid = screen.getByRole('list', { name: 'Packages' });
    expect(
      within(grid)
        .getAllByRole('article')
        .map((tile) => tile.querySelector('h3')?.textContent),
    ).toEqual(['Platinum', 'Silver', 'Gold']);
  });

  it('puts a package back where it was when the drag is cancelled', async () => {
    const { fetchImpl } = mountOrdering();
    fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }));
    const gold = screen.getByRole('button', { name: 'Gold, position 2 of 3' });
    const silver = screen.getByRole('button', { name: 'Silver, position 1 of 3' });
    const original = document.elementFromPoint;
    document.elementFromPoint = () => silver;
    try {
      fireEvent.pointerDown(gold, { button: 0, pointerId: 1 });
      fireEvent.pointerMove(gold, { pointerId: 1 });
      fireEvent.pointerCancel(gold, { pointerId: 1 });
    } finally {
      document.elementFromPoint = original;
    }
    expect(boardNames()).toEqual(['Silver', 'Gold', 'Platinum']);
    expect(reorderCalls(fetchImpl)).toHaveLength(0);
  });

  it('moves a focused package one place with the arrow keys, and says where it landed', async () => {
    const { fetchImpl } = mountOrdering();
    fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Gold, position 2 of 3' }), {
      key: 'ArrowLeft',
    });
    expect(boardNames()).toEqual(['Gold', 'Silver', 'Platinum']);
    expect(screen.getByText('Gold moved to position 1 of 3.')).toBeTruthy();
    await waitFor(() => expect(reorderCalls(fetchImpl)).toHaveLength(1));
    expect(JSON.parse(String(reorderCalls(fetchImpl)[0]![1].body))).toEqual({
      order: [GOLD.id, SILVER.id, PLATINUM.id],
    });
  });

  it('says so, in the critical tone, when the order cannot be saved, and shows the order it had', async () => {
    mountOrdering(() => json({ error: 'conflict', code: 'stale_order' }, 409));
    fireEvent.click(await screen.findByRole('button', { name: 'Reorder' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Platinum, position 3 of 3' }), {
      key: 'ArrowUp',
    });
    expect(await screen.findByText('The order could not be changed. Try again.')).toBeTruthy();
    await waitFor(() => expect(boardNames()).toEqual(['Silver', 'Gold', 'Platinum']));
  });
});

describe('PackagesSection, row buttons', () => {
  it('draws Sell to a client and Withdraw as filled buttons', async () => {
    mount(OWNER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.getByRole('button', { name: 'Sell to a client' }).className).toContain(
      'button--tonal',
    );
    expect(screen.getByRole('button', { name: 'Withdraw' }).className).toContain('button--neutral');
  });
});

describe('PackagesSection, editing', () => {
  it('offers Edit on each row, which opens the package in the drawer', async () => {
    mountWith(OWNER, <PackagesSection canWrite />, (url) => {
      if (url === '/api/billing/packages') return json({ packages: [SILVER], vatRegistered: true });
      if (url === '/api/billing/prices') return json({ prices: [], vatRegistered: true });
      return null;
    });
    await screen.findByText('Silver');
    const edit = screen.getByRole('button', { name: 'Edit Silver' });
    expect(edit.textContent).toBe('Edit');
    fireEvent.click(edit);
    expect(await screen.findByRole('heading', { name: 'Edit package' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Silver');
  });

  it('offers no Edit to someone who cannot change the catalogue', async () => {
    mount(LEAD_PRACTITIONER, [SILVER]);
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Edit Silver' })).toBeNull();
  });
});
