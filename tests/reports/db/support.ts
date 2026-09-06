import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { createPool } from '../../../app/api/_middleware/db';
import { localDiskStorage } from '../../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import { applySeed } from '../../../db/seed/apply';
import { generateSeed, type SeedData } from '../../../db/seed/generate';
import { deriveIdentityKeys } from '../../../domain/shared/identity';
import { freshDatabase } from '../../db/helpers';

/**
 * Shared plumbing for the reports stream's database tests: a fresh database,
 * the synthetic practice, and a signed request as one of its seeded people.
 * The shape is `tests/billing/db/support.ts`'s, deliberately — a stream's
 * suite proves its own routes against the API `createApi` actually builds.
 *
 * Everything here is synthetic: a secret that unlocks nothing, and people
 * `db/seed/generate.ts` invented (.claude/rules/testing.md: fixtures come from
 * the generators only).
 */

export const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
export const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);

/** The seeded team, by the roles they hold (db/seed/generate.ts). */
/** The owner's index, named so the helpers below can default to it. */
const SEEDED_OWNER = 0;

export const SEEDED = {
  /** Owner, admin, finance and lead practitioner, and the only signer. */
  owner: 0,
  /** A practitioner and nothing else; no can_sign_report on any credential. */
  practitioner: 1,
  otherPractitioner: 2,
  /** A coordinator: admin alone. Reads and delivers, never drafts or signs. */
  admin: 3,
} as const;

export type Harness = {
  owner: pg.Client;
  pool: pg.Pool;
  api: ReturnType<typeof createApi>;
  storage: ReturnType<typeof localDiskStorage>;
  data: SeedData;
  call: (
    method: 'GET' | 'POST',
    path: string,
    seededUser: number,
    body?: unknown,
    extra?: Record<string, string>,
  ) => Promise<Response>;
  callAs: (
    method: 'GET' | 'POST',
    path: string,
    authId: string,
    body?: unknown,
    extra?: Record<string, string>,
  ) => Promise<Response>;
  authIdOf: (index: number) => string;
  /**
   * A statement run with a seeded person's own audit context — their tenant,
   * their actor id and their roles — inside a transaction that is always
   * rolled back. For asking a database door a question the routes no longer
   * let a caller ask.
   */
  asPerson: <T>(seededUser: number, fn: (db: pg.Client) => Promise<T>) => Promise<T>;
  /**
   * Puts a client on a practitioner's schedule, which is the whole of what
   * `app.client_visible_to_practitioner` (201) reads. The seed writes no
   * appointments at all, so a test that needs a practitioner to reach a client
   * writes the one confirmed visit that grants it.
   */
  onSchedule: (clientIndex: number, seededUser: number) => Promise<void>;
  /**
   * A completed visit for a client, which is what a session report is written
   * about. The seed writes no sessions either, so a test that needs one writes
   * it — with the ratings and the observations a visit records, so the report
   * has figures to quote.
   */
  completedVisit: (clientIndex: number, seededUser?: number) => Promise<string>;
  serviceTypeId: (code: string) => string;
  clientId: (index: number) => string;
  practitionerIdOf: (seededUser: number) => string;
  close: () => Promise<void>;
};

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

/** A clean database holding the synthetic practice, and an API pointed at it. */
export async function startHarness(now: () => Date): Promise<Harness> {
  const data = generateSeed();
  const owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  const pool = createPool(apiUrl);
  const storage = localDiskStorage({
    dir: mkdtempSync(join(tmpdir(), 'mcwellness-reports-')),
    signingSecret: Buffer.alloc(32, 5),
  });
  const api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    now,
    storage,
  });

  function authIdOf(index: number): string {
    const user = data.users[index];
    if (!user) throw new Error(`No seeded user ${index}.`);
    return user.authId;
  }

  async function callAs(
    method: 'GET' | 'POST',
    path: string,
    authId: string,
    body?: unknown,
    extra?: Record<string, string>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await mint(authId)}`,
      ...extra,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return api.request(path, init);
  }

  return {
    owner,
    pool,
    api,
    storage,
    data,
    authIdOf,
    callAs,
    async onSchedule(clientIndex, seededUser) {
      const person = data.clients[clientIndex];
      const user = data.users[seededUser];
      const practitioner = data.practitioners.find((p) => p.userId === user?.id);
      const service = data.serviceTypes[0];
      if (!person || !practitioner || !service) throw new Error('The seed is not what it was.');
      // One visit per client, each on its own day, because a practitioner may
      // not hold two overlapping appointments (appointment_no_overlap_practitioner).
      await owner.query(
        'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'location_id, delivery_mode, window_start, window_end, status) values ' +
          "(gen_random_uuid(), $1, $2, $3, $4, $5, 'home', now() - ($6 || ' days')::interval, " +
          "now() - ($6 || ' days')::interval + interval '45 minutes', 'completed')",
        [
          data.tenant.id,
          person.id,
          practitioner.id,
          service.id,
          person.primaryLocationId,
          String(1 + clientIndex),
        ],
      );
    },
    async completedVisit(clientIndex, seededUser = SEEDED_OWNER) {
      const person = data.clients[clientIndex];
      const user = data.users[seededUser];
      const practitioner = data.practitioners.find((p) => p.userId === user?.id);
      const service =
        data.serviceTypes.find((s) => s.code === 'nf-session') ?? data.serviceTypes[0];
      if (!person || !practitioner || !service) throw new Error('The seed is not what it was.');
      const question = (service.ratingQuestions ?? [])[0];
      const answers = question
        ? { pre: [{ key: question.key, value: 4 }], post: [{ key: question.key, value: 7 }] }
        : { pre: [], post: [] };
      const { rows } = await owner.query<{ id: string }>(
        'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
          'delivery_mode, location_id, checked_in_at, checked_out_at, status, closed_at, ' +
          'pre_rating, post_rating, observations) values ' +
          "(gen_random_uuid(), $1, $2, $3, $4, 'home', $5, now() - interval '2 days', " +
          "now() - interval '2 days' + interval '50 minutes', 'completed', now(), " +
          '$6::jsonb, $7::jsonb, $8::jsonb) returning id',
        [
          data.tenant.id,
          person.id,
          practitioner.id,
          service.id,
          person.primaryLocationId,
          JSON.stringify(answers.pre),
          JSON.stringify(answers.post),
          JSON.stringify({ chips: ['none'], tolerance: 9, engagement: 8, note: null }),
        ],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('The visit was not written.');
      return id;
    },
    async asPerson(seededUser, fn) {
      const user = data.users[seededUser];
      if (!user) throw new Error(`No seeded user ${seededUser}.`);
      const roles = data.roles
        .filter((role) => role.userId === user.id)
        .map((role) => role.role)
        .join(',');
      await owner.query('begin');
      try {
        await owner.query(
          "select set_config('app.tenant_id', $1, true), " +
            "set_config('app.actor_id', $2, true), " +
            "set_config('app.actor_roles', $3, true)",
          [data.tenant.id, user.id, roles],
        );
        return await fn(owner);
      } finally {
        await owner.query('rollback');
      }
    },
    serviceTypeId(code: string): string {
      const service = data.serviceTypes.find((s) => s.code === code);
      if (!service) throw new Error(`No seeded service type "${code}".`);
      return service.id;
    },
    clientId(index: number): string {
      const client = data.clients[index];
      if (!client) throw new Error(`No seeded client ${index}.`);
      return client.id;
    },
    practitionerIdOf(seededUser: number): string {
      const user = data.users[seededUser];
      const practitioner = data.practitioners.find((p) => p.userId === user?.id);
      if (!practitioner) throw new Error(`Seeded user ${seededUser} is not a practitioner.`);
      return practitioner.id;
    },
    async call(method, path, seededUser, body, extra) {
      return callAs(method, path, authIdOf(seededUser), body, extra);
    },
    async close() {
      await pool.end();
      await owner.end();
    },
  };
}

/**
 * A progress report body the shape accepts, with as little in it as a draft
 * needs. Nothing here is a person's: the figures are invented and the
 * narrative is a sentence about a programme.
 */
export function progressBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'progress',
    coverageFrom: '2026-06-01',
    coverageTo: '2026-09-01',
    sessionsDelivered: 0,
    sessionsEntitled: 0,
    goals: [],
    ribbon: { slices: [], remaining: 0 },
    comparison: null,
    summary: 'Steady across the stretch.',
    suggestion: 'Three more sessions.',
    ...over,
  };
}

/** A session report body the shape accepts. */
export function sessionBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'session',
    sessionId: '00000003-0000-4000-8000-000000000001',
    visitDate: '2026-09-01',
    serviceName: 'Neurofeedback session',
    serviceNameAr: null,
    practitionerName: 'Hazel Harbour',
    durationMinutes: 60,
    goalArea: null,
    ratings: [],
    observationChips: [],
    tolerance: null,
    engagement: null,
    note: 'A steady visit.',
    beforeNextVisit: 'Keep to the same bedtime.',
    ...over,
  };
}
