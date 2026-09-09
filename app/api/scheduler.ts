import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { postPendingEvents } from './accounting/poster';
import { describeSweep, sweepErasureFiles } from './clients/erasure-file-sweep';
import type { ServerStorageProvider } from './_middleware/storage';

/**
 * The two jobs the practice needs run without anybody remembering to, run
 * from inside the API process (trunk round 39, 2026-09-10; the completeness
 * audit's item 5). Until now they were `pnpm job:post-books` and
 * `pnpm job:erasure-files`, each wanting the owner's connection string and a
 * cron entry, and the host had no cron entry at all — so a document an
 * erasure could not remove stayed in the store until somebody thought to run
 * the sweep by hand, and nobody would have thought to.
 *
 * **Why inside the process.** docs/SPEC/hosting.md section 12 names the
 * alternative and its cost: a scheduler on the host is a hidden dependency
 * that a redeploy does not carry, and the owner's connection string would have
 * to live on the host for it. Here the jobs run as the API role, on the pool
 * the API already holds, with each practice's context stamped exactly as a
 * request stamps it — the practice, the owner's roles, no actor (nobody
 * pressed anything), a fresh request id and a reason — so `app.audit_row`
 * records the work as it records a request's, and row security governs what
 * the jobs may touch. The one thing the API role could not do alone, list the
 * practices, is `app.scheduled_tenants()` (migration 917).
 *
 * **When.** The rule is `dueJobs`, pure, with the clock as an argument: the
 * erasure sweep on every change of the hour in the practice's own time zone,
 * the posting on the first tick at or after 03:00 there. A process that
 * starts at ten in the morning does not post until three the next morning —
 * the Books page posts on open, so nothing is missed — and never runs a job
 * twice for one boundary. The CLI entries stay for a person at a keyboard.
 *
 * Nothing here logs an id, a household or a figure beyond a count.
 */

export type JobName = 'post-books' | 'erasure-files';

export const JOB_REASONS: Record<JobName, string> = {
  'post-books': 'nightly posting',
  'erasure-files': 'erasure file sweep',
};

/**
 * The one role each job runs with — the least that opens what it touches.
 * The books' policies admit finance; the erasure request's admit an admin.
 * The CLI jobs stamped `owner` on the owner's own connection, where row
 * security did not apply at all; here it does, and this is narrower still.
 */
export const JOB_ROLES: Record<JobName, string> = {
  'post-books': 'finance',
  'erasure-files': 'admin',
};

export const PRACTICE_TIME_ZONE = 'Asia/Dubai';
/** The posting runs on the first tick at or after this hour, local time. */
export const POSTING_HOUR = 3;

// One formatter per zone, hoisted: building one per lookup is what once made
// the day optimiser take seconds (docs/HANDOVER.md, piece seventeen's review).
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The local day and hour of an instant, in the practice's zone. */
export function localDayHour(at: Date, zone = PRACTICE_TIME_ZONE): { day: string; hour: number } {
  const parts = formatterFor(zone).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
  };
}

/**
 * Which jobs fall due between the previous tick and this one. Pure.
 *
 * - `erasure-files`: the hour changed (or the day did).
 * - `post-books`: this tick is at or after the posting hour, and the previous
 *   one was before it (earlier the same day, or any earlier day).
 */
export function dueJobs(previous: Date, now: Date, zone = PRACTICE_TIME_ZONE): JobName[] {
  const before = localDayHour(previous, zone);
  const at = localDayHour(now, zone);
  const due: JobName[] = [];
  if (before.day !== at.day || before.hour !== at.hour) due.push('erasure-files');
  const wasBeforePosting = before.day !== at.day || before.hour < POSTING_HOUR;
  if (at.hour >= POSTING_HOUR && wasBeforePosting) due.push('post-books');
  return due;
}

export type SchedulerDeps = {
  pool: pg.Pool;
  storage: ServerStorageProvider;
  /** One line per practice per run; the console by default. Never an id. */
  log?: (line: string) => void;
};

const CONTEXT_SQL =
  "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', '', true), " +
  "set_config('app.actor_roles', $4, true), set_config('app.request_id', $2, true), " +
  "set_config('app.reason', $3, true)";

/** Runs one job across every practice, one transaction each. Never throws. */
export async function runJob(name: JobName, deps: SchedulerDeps): Promise<void> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const client = await deps.pool.connect();
  try {
    let tenants: string[] = [];
    try {
      await client.query('begin');
      await client.query('set local role app_role');
      const { rows } = await client.query<{ id: string }>(
        'select id from app.scheduled_tenants() as t(id)',
      );
      tenants = rows.map((row) => row.id);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      log(`Scheduler: ${name} could not list the practices. ${messageOf(error)}`);
      return;
    }
    let ordinal = 0;
    for (const tenantId of tenants) {
      ordinal += 1;
      try {
        await client.query('begin');
        await client.query('set local role app_role');
        await client.query(CONTEXT_SQL, [
          tenantId,
          randomUUID(),
          JOB_REASONS[name],
          JOB_ROLES[name],
        ]);
        if (name === 'post-books') {
          const report = await postPendingEvents(client);
          await client.query('commit');
          log(
            `Scheduler: practice ${ordinal}, posted ${report.posted}, unknown ${report.unknown}.`,
          );
        } else {
          const swept = await sweepErasureFiles(client, deps.storage);
          await client.query('commit');
          log(`Scheduler: practice ${ordinal}, ${describeSweep(swept)}`);
        }
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        log(`Scheduler: practice ${ordinal}, ${name} did not run. ${messageOf(error)}`);
      }
    }
  } finally {
    client.release();
  }
}

/** A driver's message can carry a row's values; its name and code cannot. */
function messageOf(error: unknown): string {
  const shape = (error ?? {}) as { name?: string; code?: string };
  return [shape.name ?? 'Error', shape.code].filter(Boolean).join(' ');
}

export type SchedulerOptions = {
  intervalMs?: number;
  now?: () => Date;
  zone?: string;
};

/**
 * Starts the timer. Ticks never overlap: a tick that finds the previous one
 * still running does nothing and the next one catches up, because `dueJobs`
 * compares against the last tick that ran, not the last that fired.
 */
export function startScheduler(
  deps: SchedulerDeps,
  options: SchedulerOptions = {},
): { stop(): void; tick(): Promise<void> } {
  const now = options.now ?? (() => new Date());
  const zone = options.zone ?? PRACTICE_TIME_ZONE;
  let previous = now();
  let running = false;
  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const at = now();
      for (const job of dueJobs(previous, at, zone)) {
        await runJob(job, deps);
      }
      previous = at;
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), options.intervalMs ?? 60_000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
    tick,
  };
}
