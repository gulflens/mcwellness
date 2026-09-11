import type { Hono } from 'hono';
import {
  applyDiscount,
  resolveSaleVat,
  resolveVat,
  validateNewPrice,
  type AppliedDiscount,
  type Price,
} from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { isUuid } from './ids';
import { mayReadCatalogue, mayWriteCatalogue } from './access';
import { toDiscount, type DiscountInput } from './schema';
import { readVatRegistered } from './supplier';
import {
  AddPackagePriceInput,
  CreatePackageInput,
  PackageResponse,
  PackagesResponse,
  type PackageRow,
} from './ledger-schema';

/**
 * The bundle catalogue: `GET` and `POST /api/billing/packages`, and
 * `POST /api/billing/packages/:id/price` to put a bundle on sale at a new
 * figure (docs/SPEC/billing.md section 2).
 *
 * Two prices, deliberately. `list_price_fils` on the bundle is what its
 * contents come to bought one at a time — the "normally AED 12,150" the
 * practice publishes. The `package_price` row is what it is actually selling
 * for, appended with a reason and never edited, so "launch pricing, ends on
 * the founder's word" is a fact in the table rather than a memory. The app
 * derives neither from the other: both are figures the founder sets (her
 * decision, 2026-09-03).
 *
 * A price row now also names the gap between the two as a discount, which the
 * operator asked for on 7 September 2026 (docs/SPEC/billing.md section 2.4,
 * amending the founder's "no discount percentage is stored anywhere"). The
 * row snapshots the bundle's list price as it stood when it was written, so
 * editing the bundle's published list later cannot change what an old price
 * row says it took off. Either the discount or the price now is sent, never
 * both; `domain/billing/discount.ts` works out the other.
 *
 * `componentsTotalFils` is the same sum done against today's price list, sent
 * alongside so the screen can show the practice when its published list price
 * has drifted from what its own services now cost. Null when a component has
 * no price at all — which is also what makes the bundle unsellable, because a
 * credit with no standalone value cannot be given its share of the price
 * (domain/billing/allocation.ts).
 *
 * Every query carries an explicit `tenant_id = app.current_tenant_id()`
 * predicate. Row security already enforces it; a mistaken query here should
 * fail loudly in review rather than rely on being the only thing standing
 * between one practice's catalogue and another's.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const JURISDICTION = 'AE';
const RECIPIENT_TYPE = 'individual';

type PackageDbRow = {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  list_price_fils: number;
  /** Both null together, which is the bundle saying its credits never expire. */
  expiry_amount: number | null;
  expiry_unit: 'day' | 'month' | null;
  status: 'active' | 'inactive';
};

type ComponentDbRow = {
  package_id: string;
  service_type_id: string;
  service_type_code: string;
  service_type_name: string;
  service_type_name_ar: string | null;
  quantity: number;
  line_no: number;
  standalone_net_fils: number | null;
};

type PriceDbRow = {
  package_id: string;
  id: string;
  list_price_fils: number;
  discount_fils: number;
  discount_basis_points: number | null;
  amount_fils: number;
  vat_rate_basis_points: number;
  vat_setting_version: number;
  valid_from: string;
  amendment_reason: string;
};

const PACKAGES_SQL =
  'select id, code, name, name_ar, list_price_fils, expiry_amount, expiry_unit, status ' +
  'from package where tenant_id = app.current_tenant_id() order by list_price_fils, name';

// The components, each carrying what its service costs on its own today: the
// price with the greatest valid_from at or before today, which is exactly
// domain/billing/price.ts's currentPriceFor written in SQL.
const COMPONENTS_SQL =
  'select pc.package_id, pc.service_type_id, st.code as service_type_code, ' +
  'st.name as service_type_name, st.name_ar as service_type_name_ar, ' +
  'pc.quantity, pc.line_no, ' +
  '(select p.unit_price_fils from price p ' +
  '  where p.tenant_id = pc.tenant_id and p.service_type_id = pc.service_type_id ' +
  '    and p.jurisdiction = $2 and p.recipient_type = $3 and p.valid_from <= $1 ' +
  '  order by p.valid_from desc limit 1) as standalone_net_fils ' +
  'from package_component pc join service_type st on st.id = pc.service_type_id ' +
  'where pc.tenant_id = app.current_tenant_id() order by pc.package_id, pc.line_no';

const CURRENT_PRICES_SQL =
  'select distinct on (package_id) package_id, id, list_price_fils, discount_fils, ' +
  'discount_basis_points, amount_fils, vat_rate_basis_points, ' +
  'vat_setting_version, valid_from, amendment_reason from package_price ' +
  'where tenant_id = app.current_tenant_id() and valid_from <= $1 ' +
  'order by package_id, valid_from desc';

const LATEST_PRICE_SQL =
  'select id, amount_fils, valid_from from package_price ' +
  'where tenant_id = app.current_tenant_id() and package_id = $1 ' +
  'order by valid_from desc limit 1';

const VAT_SETTING_ON_DATE_SQL =
  'select rate_basis_points, version from vat_setting ' +
  'where tenant_id = app.current_tenant_id() and effective_from <= $1 ' +
  'order by effective_from desc, version desc limit 1';

/**
 * Every bundle the practice has, with its contents and today's price.
 *
 * `vatRegistered` is the practice's own registration, read once by the caller
 * (app/api/billing/supplier.ts) and passed in rather than asked per bundle:
 * it decides what each price carries as VAT, and every bundle on the list is
 * charged under the same one.
 */
export async function readPackages(
  db: Db,
  today: string,
  vatRegistered: boolean,
): Promise<PackageRow[]> {
  const [packages, components, prices] = await Promise.all([
    db.query<PackageDbRow>(PACKAGES_SQL),
    db.query<ComponentDbRow>(COMPONENTS_SQL, [today, JURISDICTION, RECIPIENT_TYPE]),
    db.query<PriceDbRow>(CURRENT_PRICES_SQL, [today]),
  ]);

  const componentsByPackage = new Map<string, ComponentDbRow[]>();
  for (const component of components.rows) {
    const list = componentsByPackage.get(component.package_id) ?? [];
    list.push(component);
    componentsByPackage.set(component.package_id, list);
  }
  const priceByPackage = new Map(prices.rows.map((row) => [row.package_id, row]));

  return packages.rows.map((row) => {
    const own = componentsByPackage.get(row.id) ?? [];
    const priced = own.every((c) => c.standalone_net_fils !== null);
    const componentsTotalFils = priced
      ? own.reduce((total, c) => total + c.quantity * (c.standalone_net_fils ?? 0), 0)
      : null;
    const price = priceByPackage.get(row.id) ?? null;
    // The rate is the row's own — stamped when the price was written, not the
    // practice's current one, so a later rate change can never quietly alter a
    // figure a family was already shown. The charging follows the
    // registration: an unregistered practice charges nothing at that rate and
    // its gross is its net, so what this answers is what the family hands over
    // today (migration 406, the same rule prices.ts follows).
    const vat = price
      ? resolveSaleVat(
          fils(price.amount_fils),
          {
            rateBasisPoints: price.vat_rate_basis_points,
            version: price.vat_setting_version,
          },
          { vatRegistered },
        )
      : null;

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      nameAr: row.name_ar,
      listPriceFils: row.list_price_fils,
      // Whole or absent, never half: migration 412's
      // `package_expiry_term_is_whole` is what lets the pair be put back
      // together here, and null is the bundle whose credits never expire.
      term:
        row.expiry_amount !== null && row.expiry_unit !== null
          ? { amount: row.expiry_amount, unit: row.expiry_unit }
          : null,
      status: row.status,
      components: own.map((c) => ({
        serviceTypeId: c.service_type_id,
        serviceTypeCode: c.service_type_code,
        serviceTypeName: c.service_type_name,
        serviceTypeNameAr: c.service_type_name_ar,
        quantity: c.quantity,
        lineNo: c.line_no,
        standaloneNetFils: c.standalone_net_fils,
      })),
      currentPrice:
        price && vat
          ? {
              id: price.id,
              listPriceFils: price.list_price_fils,
              discountFils: price.discount_fils,
              discountBasisPoints: price.discount_basis_points,
              amountFils: price.amount_fils,
              // The stamp itself, untouched by the registration: what the
              // standard rate was on the day this price was written.
              vatRateBasisPoints: price.vat_rate_basis_points,
              vatFils: vat.vatFils,
              grossFils: vat.grossFils,
              validFrom: price.valid_from,
              amendmentReason: price.amendment_reason,
            }
          : null,
      componentsTotalFils,
      sellable: row.status === 'active' && priced && own.length > 0 && price !== null,
    };
  });
}

/**
 * Whether a bundle price may be written, and what VAT it carries — decided
 * before anything is inserted.
 *
 * The same append-only discipline the service price list has
 * (domain/billing/price.ts's validateNewPrice — today or later, and strictly
 * after the row it supersedes), with VAT resolved from the setting in force
 * on its own valid_from and stamped.
 *
 * **Checking is separate from writing, and that separation is the point.**
 * Creating a bundle writes the package, its components and its first price;
 * when the price was refused at the end of that sequence, the route returned
 * a 400 and the request-context middleware — which commits anything below a
 * 500 — committed the package and components anyway. The founder was told
 * "a price cannot take effect before today" and left with a nameless bundle
 * holding her chosen code, so trying again answered "that code is taken".
 * Now the date and the VAT setting are settled before the first insert, and
 * a refusal happens with nothing written.
 *
 * Returns a refusal code rather than a sentence: the domain's own reason text
 * never reaches a screen unmediated.
 */
type PriceRefusal = { ok: false; code: string; status: 400 | 422 };
type PriceApproval = {
  ok: true;
  supersedesId: string | null;
  rateBasisPoints: number;
  settingVersion: number;
};

async function checkPackagePrice(
  db: Db,
  packageId: string | null,
  input: { validFrom: string },
  today: string,
): Promise<PriceApproval | PriceRefusal> {
  // A package that does not exist yet has no price to supersede, and the
  // check is the same one with `current` null.
  const existing = packageId
    ? await db.query<{ id: string; amount_fils: number; valid_from: string }>(LATEST_PRICE_SQL, [
        packageId,
      ])
    : { rows: [] as { id: string; amount_fils: number; valid_from: string }[] };
  const currentRow = existing.rows[0];
  const current: Price | null = currentRow
    ? {
        id: currentRow.id,
        serviceTypeId: packageId ?? '',
        unitPriceFils: fils(currentRow.amount_fils),
        validFrom: currentRow.valid_from,
      }
    : null;

  const approval = validateNewPrice(current, { validFrom: input.validFrom }, today);
  if (!approval.ok) {
    return {
      ok: false,
      status: 400,
      code:
        approval.reason === 'A new price cannot take effect before today.'
          ? 'date_not_future'
          : approval.reason === 'A new price must take effect after the price it supersedes.'
            ? 'date_not_after_current'
            : 'invalid',
    };
  }

  const setting = await db.query<{ rate_basis_points: number; version: number }>(
    VAT_SETTING_ON_DATE_SQL,
    [input.validFrom],
  );
  const rate = setting.rows[0];
  if (!rate) {
    return { ok: false, status: 422, code: 'no_vat_setting' };
  }
  return {
    ok: true,
    supersedesId: current?.id ?? null,
    rateBasisPoints: rate.rate_basis_points,
    settingVersion: rate.version,
  };
}

/**
 * What a bundle price comes to, from whichever half of it was sent. A price
 * now is turned into the discount it implies, so one arithmetic
 * (`domain/billing/discount.ts`) decides both figures and the check constraint
 * behind them. Throws `RangeError` — as `applyDiscount` does — when the price
 * now is above the list, because the list is the ceiling (the operator's first
 * default, docs/PLAN/billing-discounts.md).
 */
export function applyPackageDiscount(
  listPriceFils: number,
  input: { discount?: DiscountInput | null; amountFils?: number },
): AppliedDiscount {
  if (input.amountFils !== undefined) {
    return applyDiscount(fils(listPriceFils), {
      kind: 'amount',
      fils: fils(listPriceFils - input.amountFils),
    });
  }
  return applyDiscount(fils(listPriceFils), toDiscount(input.discount));
}

/** Writes the row `checkPackagePrice` has already approved. */
async function insertPackagePrice(
  db: Db,
  packageId: string,
  applied: AppliedDiscount,
  input: { validFrom: string; amendmentReason: string },
  approval: PriceApproval,
): Promise<string> {
  // VAT falls on the net after the discount, as it always has: net_fils and
  // amount_fils keep their meaning, which is why the books do not change.
  const resolution = resolveVat(applied.netFils, {
    rateBasisPoints: approval.rateBasisPoints,
    version: approval.settingVersion,
  });
  const inserted = await db.query<{ id: string }>(
    'insert into package_price (tenant_id, package_id, list_price_fils, discount_fils, ' +
      'discount_basis_points, amount_fils, vat_rate_basis_points, ' +
      'vat_setting_version, valid_from, supersedes_id, amendment_reason, created_by) ' +
      'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ' +
      'app.current_actor_id()) returning id',
    [
      packageId,
      applied.listFils,
      applied.discountFils,
      applied.basisPoints,
      applied.netFils,
      resolution.rateBasisPoints,
      resolution.settingVersion,
      input.validFrom,
      approval.supersedesId,
      input.amendmentReason,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error('Insert of a package price did not return an id.');
  }
  return id;
}

export function mountPackages(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/packages', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayReadCatalogue(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const db = c.get('db');
    const vatRegistered = await readVatRegistered(db);
    const packages = await readPackages(db, today, vatRegistered);
    return c.json(PackagesResponse.parse({ packages, vatRegistered }));
  });

  api.post('/api/billing/packages', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayWriteCatalogue(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = CreatePackageInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    if (
      new Set(input.components.map((component) => component.serviceTypeId)).size !==
      input.components.length
    ) {
      return c.json({ error: 'bad_request', code: 'duplicate_component', requestId }, 400);
    }
    const db = c.get('db');
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);

    // Row security limits this to the caller's own practice; a service in
    // another one, or none at all, reads the same.
    const services = await db.query<{ id: string }>(
      'select id from service_type where tenant_id = app.current_tenant_id() and id = any($1::uuid[])',
      [input.components.map((component) => component.serviceTypeId)],
    );
    if (services.rows.length !== input.components.length) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const existing = await db.query<{ id: string }>(
      'select id from package where tenant_id = app.current_tenant_id() and code = $1',
      [input.code],
    );
    if (existing.rows[0]) {
      return c.json({ error: 'conflict', code: 'code_taken', requestId }, 409);
    }

    // Before the first insert, not after the last one: a refused price must
    // leave no package behind holding the code the founder wanted. The
    // discount is worked out here for the same reason.
    const approval = await checkPackagePrice(db, null, input.price, today);
    if (!approval.ok) {
      return c.json({ error: 'bad_request', code: approval.code, requestId }, approval.status);
    }
    let applied: AppliedDiscount;
    try {
      applied = applyPackageDiscount(input.listPriceFils, input.price);
    } catch {
      return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
    }

    const inserted = await db.query<{ id: string }>(
      'insert into package (tenant_id, code, name, name_ar, list_price_fils, expiry_amount, ' +
        'expiry_unit, created_by) values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, ' +
        'app.current_actor_id()) returning id',
      [
        input.code,
        input.name,
        input.nameAr ?? null,
        input.listPriceFils,
        // Both columns or neither, which is what the drawer sends and what the
        // database's own wholeness constraint insists on.
        input.term?.amount ?? null,
        input.term?.unit ?? null,
      ],
    );
    const packageId = inserted.rows[0]?.id;
    if (!packageId) {
      throw new Error('Insert of a package did not return an id.');
    }

    for (const [index, component] of input.components.entries()) {
      await db.query(
        'insert into package_component (tenant_id, package_id, service_type_id, quantity, ' +
          'line_no, created_by) values (app.current_tenant_id(), $1, $2, $3, $4, app.current_actor_id())',
        [packageId, component.serviceTypeId, component.quantity, index + 1],
      );
    }

    await insertPackagePrice(db, packageId, applied, input.price, approval);

    const packages = await readPackages(db, today, await readVatRegistered(db));
    const created = packages.find((row) => row.id === packageId);
    if (!created) {
      throw new Error('The package just created could not be read back.');
    }
    return c.json(PackageResponse.parse({ package: created }), 201);
  });

  api.post('/api/billing/packages/:id/price', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayWriteCatalogue(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const packageId = c.req.param('id');
    if (!isUuid(packageId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = AddPackagePriceInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');
    // The bundle's list price as it stands today: the row about to be written
    // snapshots it, so a later edit to the bundle cannot change what this
    // price says it took off.
    const found = await db.query<{ id: string; list_price_fils: number }>(
      'select id, list_price_fils from package where tenant_id = app.current_tenant_id() and id = $1',
      [packageId],
    );
    const bundle = found.rows[0];
    if (!bundle) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const approval = await checkPackagePrice(db, packageId, body.data, today);
    if (!approval.ok) {
      return c.json({ error: 'bad_request', code: approval.code, requestId }, approval.status);
    }
    let applied: AppliedDiscount;
    try {
      applied = applyPackageDiscount(bundle.list_price_fils, body.data);
    } catch {
      return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
    }
    await insertPackagePrice(db, packageId, applied, body.data, approval);
    const packages = await readPackages(db, today, await readVatRegistered(db));
    const updated = packages.find((row) => row.id === packageId);
    if (!updated) {
      throw new Error('The package just priced could not be read back.');
    }
    return c.json(PackageResponse.parse({ package: updated }), 201);
  });
}
