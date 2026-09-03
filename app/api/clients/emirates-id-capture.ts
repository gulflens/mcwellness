import type { IdentityKeys } from '../../../domain/shared/identity';
import { emiratesIdHash, sealEmiratesId } from '../../../domain/shared/identity';
import { validateEmiratesId } from '../../../domain/client';
import { freshNonce } from '../_middleware/identity-key';
import type { Db } from '../_middleware/request-context';

/**
 * Sealing and hashing an Emirates ID captured on a contact (create or edit,
 * docs/SPEC/client-record.md section 6 and 00-data-model.md section 3): the
 * one place these routes turn a raw, caller-supplied string into the pair of
 * columns `contact.emirates_id_encrypted` and `contact.emirates_id_hash`
 * actually store, mirroring db/seed/apply.ts's own use of the same
 * primitives. Never stores anything itself — the caller writes the returned
 * buffers into its own insert or update.
 *
 * `identityKeys` is absent when the deployment has not set `IDENTITY_KEY`
 * yet (create-api.ts only publishes it when configured); a route that finds
 * it missing here refuses cleanly rather than silently dropping the value
 * (app/api/_middleware/identity-context.ts's own contract).
 */
export type EmiratesIdCapture =
  | { ok: true; sealed: Buffer; hash: Buffer }
  | { ok: false; code: 'invalid_emirates_id' | 'emirates_id_unavailable' };

export function captureEmiratesId(
  raw: string,
  boundToContactId: string,
  identityKeys: IdentityKeys | undefined,
): EmiratesIdCapture {
  const validation = validateEmiratesId(raw);
  if (!validation.ok) {
    return { ok: false, code: 'invalid_emirates_id' };
  }
  if (!identityKeys) {
    return { ok: false, code: 'emirates_id_unavailable' };
  }
  const sealed = sealEmiratesId(
    validation.normalised,
    identityKeys,
    freshNonce(),
    boundToContactId,
  );
  const hash = emiratesIdHash(validation.normalised, identityKeys);
  return { ok: true, sealed, hash };
}

/**
 * Whether some other contact in this tenant already carries this fingerprint —
 * `contact`'s own `unique (tenant_id, emirates_id_hash)`, asked before the write
 * rather than caught after it.
 *
 * Catching the constraint would be the obvious shape and does not work here: the
 * whole request is one transaction (app/api/_middleware/request-context.ts), so a
 * unique violation aborts it, and the fence deliberately turns a route that
 * swallowed a database error into a 500 rather than letting it report success on a
 * transaction Postgres has already rolled back. Asking first keeps the transaction
 * clean and the answer plain. The constraint stays the backstop for the genuine
 * race between this read and the insert: that one aborts, nothing is written, and
 * the caller is told the request failed rather than told a lie.
 *
 * Read under row level security as the caller, which is exactly the right scope:
 * the constraint is per tenant, and so is what this sees. Every role that may reach
 * these routes (owner, admin, lead practitioner — app/api/clients/access.ts) reads
 * every contact of its own tenant (db/policies/client/readers.sql), and an erased
 * client's contacts hold no fingerprint at all (app.erase_client nulls both
 * columns), so there is no row this can be blind to.
 */
export async function emiratesIdInUse(
  db: Db,
  hash: Buffer,
  exceptContactId?: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'select 1 from contact where emirates_id_hash = $1 and ($2::uuid is null or id <> $2)',
    [hash, exceptContactId ?? null],
  );
  return (rowCount ?? 0) > 0;
}
