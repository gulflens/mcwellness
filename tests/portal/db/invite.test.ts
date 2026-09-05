import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../db/runner/apply';
import { INVITE_VALID_DAYS, inviteExpiry } from '../../../domain/portal';
import { IDS, freshDatabase, rolledBack } from '../../db/helpers';
import { PORTAL, seedPortalHousehold } from './support';

/**
 * The door's two functions (`app.portal_invite_status` and
 * `app.redeem_portal_invite`, migration 700), and the one race that matters.
 *
 * A link that has been used is spent. That has to hold when two requests
 * arrive at once — a person who taps a WhatsApp link twice, or a preview
 * fetcher that follows it before they do — so the last case here opens two
 * real connections and redeems the same link on both, which is the only way
 * to prove a `for update` lock does what it says.
 *
 * Nothing in this file is signed in: the door runs with no actor and no tenant
 * stamped, because the person on the other end has no account yet.
 */

const INVITE = '00000001-0000-4000-8000-000000000071';
const SECOND_INVITE = '00000001-0000-4000-8000-000000000072';
const AUTH_ONE = '00000001-0000-4000-8000-000000000073';
const AUTH_TWO = '00000001-0000-4000-8000-000000000074';

let owner: pg.Client;

/** A token, and the hash the practice keeps in its place. */
function token(): { token: string; hash: Buffer } {
  const value = randomBytes(32).toString('base64url');
  return { token: value, hash: createHash('sha256').update(value).digest() };
}

type InviteState = {
  id: string;
  hash: Buffer;
  kind?: 'first_sign_in' | 'password_reset';
  expiresAt?: Date;
  usedAt?: Date | null;
  revokedAt?: Date | null;
  /** Which contact, so the second invitation can belong to somebody else. */
  contactId?: string;
  userId?: string;
  clientId?: string;
};

async function writeInvite(state: InviteState): Promise<void> {
  await owner.query(
    'insert into portal_invite (id, tenant_id, client_id, contact_id, user_id, kind, ' +
      'token_hash, expires_at, used_at, revoked_at) values ' +
      '($1, $2, $3, $4, $5, $6::portal_invite_kind, $7, $8, $9, $10)',
    [
      state.id,
      IDS.tenantA,
      state.clientId ?? PORTAL.childA,
      state.contactId ?? PORTAL.motherContact,
      state.userId ?? PORTAL.motherUser,
      state.kind ?? 'first_sign_in',
      state.hash,
      state.expiresAt ?? inviteExpiry(new Date()),
      state.usedAt ?? null,
      state.revokedAt ?? null,
    ],
  );
}

/**
 * The door's own transaction: the API role, and nothing stamped at all — no
 * tenant and no actor, because the person on the other end has no account yet.
 *
 * Deliberately not `asApiRole` (tests/db/helpers.ts): that helper rolls its own
 * savepoint back when it returns, which is exactly right for proving a deny
 * case and wrong here, where the redemption's effects are the thing being
 * read. Every caller sits inside `rolledBack`, so nothing outlives its test.
 */
async function atTheDoor<T>(fn: () => Promise<T>): Promise<T> {
  await owner.query('set local role app_role');
  try {
    return await fn();
  } finally {
    await owner.query('reset role');
  }
}

/**
 * The same, for a call that is meant to be refused. A raised exception aborts
 * the transaction, so the attempt sits in its own savepoint and the
 * surrounding one stays usable for the assertions after it.
 */
async function refusedAtTheDoor(sql: string, params: unknown[]): Promise<string> {
  await owner.query('savepoint door');
  await owner.query('set local role app_role');
  let message = '';
  try {
    await owner.query(sql, params);
  } catch (error) {
    message = (error as Error).message;
  } finally {
    await owner.query('rollback to savepoint door');
    await owner.query('reset role');
  }
  return message;
}

const REDEEM = 'select app.redeem_portal_invite($1, $2, $3)';

async function statusOf(hash: Buffer): Promise<string> {
  const { rows } = await atTheDoor(() =>
    owner.query<{ state: string }>('select app.portal_invite_status($1) as state', [hash]),
  );
  return rows[0]?.state ?? '';
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);
  // The mother's account has been through the door already; the door's job is
  // to put a sign-in behind an account that has none, so hers is cleared.
  await owner.query('update app_user set auth_id = null, email = null where id = $1', [
    PORTAL.motherUser,
  ]);
});

afterAll(async () => {
  await owner.end();
});

describe('app.portal_invite_status: one word, to somebody who is not signed in', () => {
  it('says unknown for a link that never existed', async () => {
    await rolledBack(owner, async () => {
      expect(await statusOf(token().hash)).toBe('unknown');
    });
  });

  it('says valid while the link is alive', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash });
      expect(await statusOf(hash)).toBe('valid');
    });
  });

  it('says expired once its seven days are up', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({
        id: INVITE,
        hash,
        expiresAt: new Date(Date.now() - 60_000),
      });
      expect(await statusOf(hash)).toBe('expired');
    });
  });

  it('says used once it has been spent', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash, usedAt: new Date() });
      expect(await statusOf(hash)).toBe('used');
    });
  });

  it('says revoked, and says it before it says used', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash, usedAt: new Date(), revokedAt: new Date() });
      expect(await statusOf(hash)).toBe('revoked');
    });
  });

  it('says not_a_household for a link naming a member of the practice', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash, userId: PORTAL.admin });
      expect(await statusOf(hash)).toBe('not_a_household');
    });
  });

  it('gives seven days, the figure the domain holds', async () => {
    expect(INVITE_VALID_DAYS).toBe(7);
    const issued = new Date('2026-09-05T08:00:00.000Z');
    expect(inviteExpiry(issued).toISOString()).toBe('2026-09-12T08:00:00.000Z');
  });
});

describe('app.redeem_portal_invite: spend the link, once', () => {
  it('links the sign-in and the address onto the account, and marks the link spent', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash });
      const userId = await atTheDoor(async () => {
        const { rows } = await owner.query<{ id: string }>(
          'select app.redeem_portal_invite($1, $2, $3) as id',
          [hash, AUTH_ONE, 'hazel.meadow@example.com'],
        );
        return rows[0]?.id;
      });
      expect(userId).toBe(PORTAL.motherUser);

      const account = await owner.query<{ auth_id: string; email: string }>(
        'select auth_id, email from app_user where id = $1',
        [PORTAL.motherUser],
      );
      expect(account.rows[0]?.auth_id).toBe(AUTH_ONE);
      expect(account.rows[0]?.email).toBe('hazel.meadow@example.com');
      expect(await statusOf(hash)).toBe('used');
    });
  });

  it('leaves the address alone on a password reset', async () => {
    await rolledBack(owner, async () => {
      await owner.query('update app_user set email = $1 where id = $2', [
        'hazel.meadow@example.com',
        PORTAL.motherUser,
      ]);
      const { hash } = token();
      await writeInvite({ id: INVITE, hash, kind: 'password_reset' });
      await atTheDoor(() =>
        owner.query('select app.redeem_portal_invite($1, $2, $3)', [
          hash,
          AUTH_TWO,
          'somebody.else@example.com',
        ]),
      );
      const account = await owner.query<{ email: string }>(
        'select email from app_user where id = $1',
        [PORTAL.motherUser],
      );
      expect(account.rows[0]?.email).toBe('hazel.meadow@example.com');
    });
  });

  it('refuses each dead state with its own code, and never says whose link it was', async () => {
    for (const [state, code] of [
      [{ usedAt: new Date() }, 'portal_invite_used'],
      [{ revokedAt: new Date() }, 'portal_invite_revoked'],
      [{ expiresAt: new Date(Date.now() - 60_000) }, 'portal_invite_expired'],
    ] as const) {
      await rolledBack(owner, async () => {
        const { hash } = token();
        await writeInvite({ id: INVITE, hash, ...state });
        expect(await refusedAtTheDoor(REDEEM, [hash, AUTH_ONE, null])).toContain(code);
      });
    }
  });

  it('refuses a hand-built link against a member of the practice, and leaves the account alone', async () => {
    // However the row came to exist — a bug in the issuing route, a hand
    // written insert — redeeming it must not repoint the admin's sign-in at
    // whatever the redeemer supplied. This is the floor beneath the route.
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash, userId: PORTAL.admin });
      expect(
        await refusedAtTheDoor(REDEEM, [hash, AUTH_ONE, 'somebody.else@example.com']),
      ).toContain('portal_invite_not_a_household');
      const account = await owner.query<{ auth_id: string }>(
        'select auth_id from app_user where id = $1',
        [PORTAL.admin],
      );
      expect(account.rows[0]?.auth_id).toBe(PORTAL.adminAuth);
    });
  });

  it('refuses a link that never existed', async () => {
    await rolledBack(owner, async () => {
      expect(await refusedAtTheDoor(REDEEM, [token().hash, AUTH_ONE, null])).toContain(
        'portal_invite_unknown',
      );
    });
  });

  it('refuses a redemption with no sign-in behind it', async () => {
    await rolledBack(owner, async () => {
      const { hash } = token();
      await writeInvite({ id: INVITE, hash });
      expect(await refusedAtTheDoor(REDEEM, [hash, null, null])).toContain(
        'portal_invite_needs_a_sign_in',
      );
    });
  });
});

describe('two redemptions of one link', () => {
  it('ends with one winner and one refusal', async () => {
    const { hash } = token();
    await writeInvite({ id: SECOND_INVITE, hash });

    const url = requireDatabaseUrl();
    const first = new pg.Client({ connectionString: url });
    const second = new pg.Client({ connectionString: url });
    await first.connect();
    await second.connect();
    try {
      await first.query('begin');
      await second.query('begin');
      // The first takes the row's lock and holds it.
      const won = await first.query<{ id: string }>(
        'select app.redeem_portal_invite($1, $2, $3) as id',
        [hash, AUTH_ONE, 'hazel.meadow@example.com'],
      );
      expect(won.rows[0]?.id).toBe(PORTAL.motherUser);

      // The second waits on that lock, and is refused the moment it is released.
      const racing = second.query('select app.redeem_portal_invite($1, $2, $3)', [
        hash,
        AUTH_TWO,
        'somebody.else@example.com',
      ]);
      await first.query('commit');
      await expect(racing).rejects.toThrow('portal_invite_used');
      await second.query('rollback');

      const account = await owner.query<{ auth_id: string }>(
        'select auth_id from app_user where id = $1',
        [PORTAL.motherUser],
      );
      expect(account.rows[0]?.auth_id).toBe(AUTH_ONE);
    } finally {
      await first.end();
      await second.end();
      await owner.query('delete from portal_invite where id = $1', [SECOND_INVITE]);
      await owner.query('update app_user set auth_id = null, email = null where id = $1', [
        PORTAL.motherUser,
      ]);
    }
  });
});
