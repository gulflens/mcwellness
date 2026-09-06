import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { canActor, isoDateIn } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mountPracticeLogo } from './logo';
import { Practice, PracticeResponse, UpdatePracticeInput } from './schema';

/**
 * The practice's own details: `GET /api/practice` and `PATCH /api/practice`
 * (migration 905, docs/SPEC/00-data-model.md section 2).
 *
 * **Who.** `practice.settings.write` — the owner and an admin — for both, and
 * deliberately for the read as well: this screen shows the practice's tax
 * registrations, and there is nobody who needs to read those who is not
 * allowed to change them. Row security scopes the row to the caller's own
 * practice and `app.guard_tenant_identity` (905) refuses the write beneath
 * this check, so the rule is stated three times and enforced twice below the
 * route.
 *
 * **Why a reason is required.** Editing what a tax invoice says the supplier
 * is, is one of the actions that deserve extra ceremony (docs/SPEC/audit.md
 * section 6 — section 9 is the trail's own screens): every save
 * carries `X-Reason`, which the fence stamps onto the transaction and the
 * audit trigger records with the row it changed. The trail is the trigger's;
 * this route only insists there is something in it.
 *
 * **The address is a location row.** The studio address an invoice prints is
 * `tenant.location_id -> location.display_address`, so saving one either
 * updates that row or creates it. A coordinate is optional on an address
 * already recorded and required to record the first one, because
 * `location.entrance_point` is not null (030_location.sql): the practice's
 * place on a map is a verified point, not an afterthought.
 */

const SELECT_PRACTICE =
  'select t.legal_name, t.legal_name_ar, t.trn, t.licence_number, t.licensing_authority, ' +
  "to_char(t.licence_expires_on, 'YYYY-MM-DD') as licence_expires_on, " +
  't.vat_registered, t.vat_trn, t.whatsapp_number, t.default_emirate, t.timezone, ' +
  'l.id as location_id, l.display_address, l.emirate, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as latitude, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as longitude ' +
  'from tenant t left join location l on l.id = t.location_id ' +
  'where t.id = app.current_tenant_id()';

type PracticeRow = {
  legal_name: string;
  legal_name_ar: string | null;
  trn: string | null;
  licence_number: string | null;
  licensing_authority: string | null;
  licence_expires_on: string | null;
  vat_registered: boolean;
  vat_trn: string | null;
  whatsapp_number: string | null;
  default_emirate: string;
  timezone: string;
  location_id: string | null;
  display_address: string | null;
  emirate: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** A point as the geography column takes it: longitude first, then latitude. */
const point = (lng: number, lat: number): string => `SRID=4326;POINT(${lng} ${lat})`;

async function readPractice(db: Db): Promise<PracticeRow | null> {
  const { rows } = await db.query<PracticeRow>(SELECT_PRACTICE);
  return rows[0] ?? null;
}

/**
 * The practice's taxable supplies over the trailing twelve months
 * (migration 953), for the threshold watch beside the VAT switch.
 *
 * Through the function rather than over `invoice` directly, and for the reason
 * migration 952 exists: read as the caller, `invoice` passes through the
 * erasure gate, so an erased household's supplies would drop out of an admin's
 * figure and the practice's own tax position would move with who was looking.
 *
 * The day is this side's, so no clock is read inside the database.
 */
async function taxableSupplies(db: Db, asOf: string): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    'select app.vat_taxable_supplies_fils($1::date)::text as total',
    [asOf],
  );
  return Number(rows[0]?.total ?? 0);
}

function view(row: PracticeRow, supplies: { fils: number; asOf: string }): Practice {
  return Practice.parse({
    legalName: row.legal_name,
    legalNameAr: row.legal_name_ar,
    taxRegistrationNumber: row.trn,
    licenceNumber: row.licence_number,
    licensingAuthority: row.licensing_authority,
    licenceExpiresOn: row.licence_expires_on,
    vatRegistered: row.vat_registered,
    vatTrn: row.vat_trn,
    vatTaxableSuppliesFils: supplies.fils,
    vatTaxableSuppliesAsOf: supplies.asOf,
    whatsappNumber: row.whatsapp_number,
    defaultEmirate: row.default_emirate,
    timezone: row.timezone,
    address:
      row.location_id === null
        ? null
        : {
            displayAddress: row.display_address,
            emirate: row.emirate,
            latitude: row.latitude,
            longitude: row.longitude,
          },
  });
}

export function mountPractice(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  // The practice's mark, in its own file: it is bytes rather than facts, and
  // the ordering it has to keep (bytes into the store, then the row, then the
  // old bytes after the commit) has nothing to say to the form above it.
  mountPracticeLogo(api, now);

  api.get('/api/practice', async (c) => {
    const requestId = c.get('requestId');
    if (!canActor(c.get('actor'), { type: 'practice.settings.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const row = await readPractice(db);
    if (row === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const asOf = isoDateIn(now(), row.timezone);
    return c.json(
      PracticeResponse.parse({
        practice: view(row, { fils: await taxableSupplies(db, asOf), asOf }),
      }),
    );
  });

  api.patch('/api/practice', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'practice.settings.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const bodyJson = await c.req.json().catch(() => null);
    const body = UpdatePracticeInput.safeParse(bodyJson);
    if (!body.success) {
      // A code, never zod's own message: the screen holds the sentences.
      const field = body.error.issues[0]?.path[0];
      const code =
        field === 'vatTrn'
          ? 'vat_trn_required'
          : field === 'whatsappNumber'
            ? 'whatsapp_number_invalid'
            : 'bad_request';
      return c.json({ error: 'bad_request', code, requestId }, 400);
    }
    const current = await readPractice(db);
    if (current === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const wanted = body.data;
    if (
      wanted.address !== null &&
      current.location_id === null &&
      wanted.address.latitude === null
    ) {
      // The first address needs its point: the column is not null and no
      // placeholder coordinate is honest enough to stand in for one.
      return c.json({ error: 'bad_request', code: 'coordinates_required', requestId }, 400);
    }

    await db.query(
      'update tenant set legal_name = $1, legal_name_ar = $2, trn = $3, licence_number = $4, ' +
        'licensing_authority = $5, licence_expires_on = $6, vat_registered = $7, vat_trn = $8, ' +
        'whatsapp_number = $9 where id = app.current_tenant_id()',
      [
        wanted.legalName,
        wanted.legalNameAr,
        wanted.taxRegistrationNumber,
        wanted.licenceNumber,
        wanted.licensingAuthority,
        wanted.licenceExpiresOn,
        wanted.vatRegistered,
        wanted.vatTrn,
        wanted.whatsappNumber,
      ],
    );

    if (wanted.address !== null) {
      const { displayAddress, emirate, latitude, longitude } = wanted.address;
      const coordinate =
        latitude !== null && longitude !== null ? point(longitude, latitude) : null;
      if (current.location_id === null) {
        const locationId = randomUUID();
        await db.query(
          'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
            'entrance_point, display_address, is_primary, created_by) ' +
            "values ($1, $2, 'tenant', $2, 'studio', $3::emirate, extensions.st_geogfromtext($4::text), $5, true, $6)",
          [locationId, actor.tenantId, emirate, coordinate, displayAddress, actor.userId],
        );
        await db.query('update tenant set location_id = $1 where id = app.current_tenant_id()', [
          locationId,
        ]);
      } else {
        // A Makani number is a Dubai address's own code and the column says so
        // (location_makani_dubai_only, 030_location.sql), so a move out of
        // Dubai clears it rather than being refused by a constraint the form
        // does not show. The audit trail records the clearing like any change.
        await db.query(
          'update location set display_address = $1, emirate = $2::emirate, ' +
            'entrance_point = coalesce(extensions.st_geogfromtext($3::text), entrance_point), ' +
            "makani_number = case when $2::emirate = 'DXB' then makani_number else null end " +
            'where id = $4',
          [displayAddress, emirate, coordinate, current.location_id],
        );
      }
    }

    const saved = await readPractice(db);
    if (saved === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const asOf = isoDateIn(now(), saved.timezone);
    return c.json(
      PracticeResponse.parse({
        practice: view(saved, { fils: await taxableSupplies(db, asOf), asOf }),
      }),
    );
  });
}
