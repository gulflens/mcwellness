import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppointmentListResponse } from '../../../app/api/appointments/schema';
import type { RecordPastSessionResponse } from '../../../app/api/sessions/schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, startHarness, type Harness } from '../../billing/db/support';

/**
 * The day schedule's rows carry the visit record behind each appointment
 * (trunk round 60, docs/superpowers/specs/2026-09-23-void-logged-session-design.md
 * "Screens"): which session it is, whether it was logged from the records,
 * whether it was settled before the app, and how long it ran — what the
 * screen needs to offer Void and Correct on the right rows only, and to
 * pre-fill a correction. A booking nobody has been to yet carries none of it.
 * On the synthetic practice throughout.
 */

const NOW = () => new Date(`${SEED_TODAY}T08:00:00.000Z`);
const REASON = { 'x-reason': 'From the paper diary, before the app' };
/** One of the seed's active adult households, with its consents on file. */
const HOUSEHOLD = 5;

let h: Harness;

async function day(date: string): Promise<AppointmentListResponse['appointments']> {
  const res = await h.call('GET', `/api/appointments?date=${date}`, SEEDED.owner);
  expect(res.status).toBe(200);
  return ((await res.json()) as AppointmentListResponse).appointments;
}

async function logVisit(overrides: Record<string, unknown>): Promise<{
  sessionId: string;
  appointmentId: string;
}> {
  const client = h.data.clients[HOUSEHOLD]!;
  const res = await h.call(
    'POST',
    '/api/sessions/from-records',
    SEEDED.owner,
    {
      clientId: client.id,
      practitionerId: h.data.practitioners[0]!.id,
      serviceTypeId: h.serviceTypeId('nf-session'),
      locationId: client.primaryLocationId,
      deliveryMode: 'home',
      on: '2026-03-04',
      startTime: '15:30',
      billing: 'settled_outside',
      ...overrides,
    },
    REASON,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as RecordPastSessionResponse;
  if (body.status !== 'recorded') throw new Error('not recorded');
  return { sessionId: body.sessionId, appointmentId: body.appointmentId };
}

beforeAll(async () => {
  h = await startHarness(NOW);
});

afterAll(async () => {
  await h.close();
});

describe('GET /api/appointments: the visit record behind each row', () => {
  it('carries the session, its source, its settlement and its length for a visit logged from the records', async () => {
    const logged = await logVisit({ durationMinutes: 50 });
    const row = (await day('2026-03-04')).find((a) => a.id === logged.appointmentId);
    expect(row).toMatchObject({
      status: 'completed',
      sessionId: logged.sessionId,
      recordedFrom: 'records',
      settledOutsideApp: true,
      sessionMinutes: 50,
    });
  });

  it('carries nulls for a booking nobody has been to yet', async () => {
    const booked = h.data.appointments[0];
    if (!booked) throw new Error('The seed books no appointment.');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(
      new Date(booked.windowStart),
    );
    const row = (await day(date)).find((a) => a.id === booked.id);
    expect(row).toMatchObject({
      sessionId: null,
      recordedFrom: null,
      settledOutsideApp: null,
      sessionMinutes: null,
    });
  });

  it('keeps the voided visit on its own session, and the correction on its new one', async () => {
    const wrong = await logVisit({ on: '2026-03-11', startTime: '10:00' });
    const right = await logVisit({
      on: '2026-03-11',
      startTime: '10:00',
      replaces: wrong.sessionId,
    });
    const rows = await day('2026-03-11');
    expect(rows.find((a) => a.id === wrong.appointmentId)).toMatchObject({
      status: 'voided',
      sessionId: wrong.sessionId,
      recordedFrom: 'records',
    });
    expect(rows.find((a) => a.id === right.appointmentId)).toMatchObject({
      status: 'completed',
      sessionId: right.sessionId,
      recordedFrom: 'records',
    });
  });
});
