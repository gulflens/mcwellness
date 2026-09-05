import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scoreSignalQuality, type TelemetrySample } from '@domain/session';
import { CloseResponse, EventsResponse, type ServiceTypeOption } from '../../api/sessions/schema';
import { useAuth, type ApiFetch } from '../../shell/auth/AuthContext';
import { Button } from '../../shell/components/Controls';
import { PostStep } from './PostStep';
import { PreflightStep } from './PreflightStep';
import { RunStep } from './RunStep';
import { SignalStep, meanQuality } from './SignalStep';
import { SummaryStep } from './SummaryStep';
import { Outbox, type PostEvents, type PostPhoto } from './outbox/outbox';
import { useForgetDeviceOnSignOut } from './outbox/signed-out';
import {
  PRUNE_AFTER_DAYS,
  createOutboxStore,
  requestPersistentStorage,
  type OutboxRecord,
  type OutboxStore,
} from './outbox/store';
import { preparePhoto } from './photo';
import {
  deltas,
  midpoint,
  seedAnswers,
  type Answers,
  type GeoPoint,
  type Observations,
  type PhotoConsent,
  type PhotoState,
  type Reading,
  type ServiceSettings,
  type SiteReading,
  type VisitActuals,
} from './steps';
import './SessionRunner.css';

/**
 * The visit itself, from pre-flight to check-out
 * (docs/SPEC/session-capture.md sections 2 to 4).
 *
 * Everything the practitioner does here is written to the device first, as
 * an append-only event, and posted when there is a connection. Nothing on
 * this screen waits for the network: a visit runs identically in a basement
 * and in a car park, and the only difference the practitioner sees is a
 * quiet line saying how much is still waiting to sync.
 *
 * The one thing that does need a connection is the very last step. Closing a
 * visit is a server-side transaction (section 4) — the appointment, the
 * audit, and the credit the billing stream consumes — and the server will
 * not close a visit whose check-out it has not received. So the summary's
 * confirmation drains the outbox first and only then posts the close; when
 * that cannot be done it says so and keeps trying, and when the server
 * refuses outright it says that instead and stops.
 *
 * The runner reads no clock but the device's own, which is the only clock
 * there is in a living room with no signal.
 */

/** One telemetry chunk a minute while a reading exists (section 3.4). */
const CHUNK_SECONDS = 60;
/** The close is retried on this beat, matching the outbox's own (section 7). */
const CLOSE_RETRY_MS = 30_000;

export type RunnerVisit = {
  sessionId: string;
  clientLabel: string;
  checkedInAt: string;
  number: number;
  of: number | null;
  serviceTypeId: string;
  /**
   * Whether the household has agreed to photographs — or, on a resume with
   * no signal, that the device could not find out. Three answers, because
   * "we cannot check" is not "they said no" (design review, item 5).
   */
  photoConsent: PhotoConsent;
  /**
   * The photograph on this client's most recent completed visit, or null. The
   * pre-flight step shows a button and fetches it on the tap and never before
   * (docs/SPEC/practitioner-phone.md section 4.5, decision 6).
   */
  previousSetupPhotoDocumentId: string | null;
  /** The last seq the server holds, so a resumed visit does not reuse one. */
  lastSeq: number;
  /** Whether the practitioner shared their position at the door (section 3.6). */
  shareLocation: boolean;
};

type Step = 'preflight' | 'signal' | 'run' | 'post' | 'summary' | 'finishing' | 'blocked' | 'done';

const EMPTY_SETTINGS: ServiceSettings = { preflightChecklist: [], ratingQuestions: [] };

const CLOSE_BLOCKED =
  'This visit could not be checked out. Nothing is lost — ask the practice to close it.';

/**
 * How the outbox reaches this API, and how it reads the answer. Three
 * distinctions matter: a failure worth waiting on, a refusal that never
 * changes, and a batch refused for its size, which goes again in pieces.
 *
 * `point` is the check-out coordinate, and it rides beside the batch rather
 * than inside an event — session-level, exactly as check-in carries its own
 * (domain/session/events.ts explains why a coordinate must never sit in an
 * event payload). It is sent only with the batch that carries the check-out,
 * and it is held in memory only: a device that reloads before the flush
 * records no position, which is the safe way round.
 */
export function postEventsVia(apiFetch: ApiFetch, readPoint: () => GeoPoint | null): PostEvents {
  return async (sessionId, records) => {
    const events = records.map((record) => ({
      id: record.id,
      seq: record.seq,
      kind: record.kind,
      deviceAt: record.deviceAt,
      payload: record.payload,
    }));
    const point = events.some((event) => event.kind === 'checked_out') ? readPoint() : null;
    let res: Response;
    try {
      res = await apiFetch(`/api/sessions/${sessionId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(point === null ? { events } : { events, point }),
      });
    } catch {
      return 'retry';
    }
    if (res.status === 413) return 'too-large';
    // The visit is closed, gone, or not this practitioner's, or the batch is
    // malformed: none of those change by waiting.
    if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 409) {
      return 'give-up';
    }
    if (!res.ok) return 'retry';
    const parsed = EventsResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return 'retry';
    return { acknowledged: parsed.data.acknowledged, refused: parsed.data.refused };
  };
}

/**
 * How the photograph's bytes reach this API (docs/SPEC/practitioner-phone.md
 * section 4.3). The three answers are the device's whole decision, and each
 * status maps to exactly one of them:
 *
 * - 201 and 200 are both "filed": the second is an idempotent retry of a
 *   picture the server already holds.
 * - 409 `photo_event_pending` is the one conflict worth waiting on — the
 *   event that names this digest has not been acknowledged yet — and every
 *   other refusal is final: no consent, a retake that superseded it, a visit
 *   that already has one, a visit that is not this practitioner's.
 * - anything else is worth trying again.
 */
export function postPhotoVia(apiFetch: ApiFetch): PostPhoto {
  return async (blob) => {
    let res: Response;
    try {
      res = await apiFetch(`/api/sessions/${blob.sessionId}/photo`, {
        method: 'PUT',
        headers: { 'content-type': blob.mimeType, 'x-photo-sha256': blob.sha256 },
        body: blob.bytes,
      });
    } catch {
      return 'retry';
    }
    if (res.ok) return 'filed';
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      return body?.detail === 'photo_event_pending' ? 'retry' : 'give-up';
    }
    if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 415) {
      return 'give-up';
    }
    return 'retry';
  };
}

/** A single position read, or null. A refusal is never a block (section 7). */
function readPosition(): Promise<GeoPoint | null> {
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (!geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: GeoPoint | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadman);
      resolve(value);
    };
    const deadman = setTimeout(() => finish(null), 12_000);
    geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => finish(null),
      { timeout: 10_000, maximumAge: 0 },
    );
  });
}

export function SessionRunner({
  visit,
  service,
  onFinished,
  createStore = createOutboxStore,
}: {
  visit: RunnerVisit;
  service: ServiceTypeOption | null;
  onFinished: () => void;
  /** Injected in tests, where IndexedDB does not exist. */
  createStore?: () => Promise<OutboxStore>;
}) {
  const { apiFetch, session } = useAuth();
  const settings: ServiceSettings = service ?? EMPTY_SETTINGS;
  // Signing out empties the device, from whichever of this module's faces is
  // on screen when it happens (./outbox/signed-out.ts).
  useForgetDeviceOnSignOut(createStore);

  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [pending, setPending] = useState(0);
  const [photosPending, setPhotosPending] = useState(0);
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'none' });
  const [durable, setDurable] = useState(true);
  const [step, setStep] = useState<Step>('preflight');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Seeded with the value each slider actually shows, so the summary and the
  // record agree: an answer nobody moved is still the answer that is filed
  // (design review, item 4).
  const [preAnswers, setPreAnswers] = useState<Answers>(() =>
    seedAnswers(settings.ratingQuestions),
  );
  const [postAnswers, setPostAnswers] = useState<Answers>(() =>
    seedAnswers(settings.ratingQuestions),
  );
  const [sites, setSites] = useState<SiteReading[]>([{ site: '', quality: 0.8 }]);
  const [reading, setReading] = useState<Reading | null>(null);
  const [summaryReading, setSummaryReading] = useState<Reading>({
    artefactPercent: 0,
    timeInRewardPercent: 0,
  });
  // An untouched slider is not a measurement (design review, item 2). Until
  // the practitioner moves one of these two, no telemetry is written at all
  // and the visit honestly has no session quality.
  const [summaryReadingTaken, setSummaryReadingTaken] = useState(false);
  const [observations, setObservations] = useState<Observations>({
    chips: [],
    tolerance: null,
    engagement: null,
    note: '',
  });
  const [actuals, setActuals] = useState<VisitActuals>({
    parkingCostFils: 0,
    salikCrossings: 0,
    accessIssues: '',
  });
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [endedAtMs, setEndedAtMs] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySample[]>([]);

  const seqRef = useRef(visit.lastSeq);
  const bufferRef = useRef<OutboxRecord[]>([]);
  const [highWater, setHighWater] = useState(visit.lastSeq);
  // The minute timer below reads the reading as it stands when it fires, not
  // as it stood when the timer was set, so it goes through a ref rather than
  // resetting the interval on every slider move.
  const readingRef = useRef<Reading | null>(null);
  useEffect(() => {
    readingRef.current = reading;
  }, [reading]);
  // The check-out coordinate, held only until the batch carrying the
  // check-out is posted. Never written to the device, never in an event.
  const pointRef = useRef<GeoPoint | null>(null);

  // One store and one outbox for the life of this visit on this device. It
  // opens asynchronously, so anything written before it is ready waits in
  // `bufferRef` and is drained the moment it is — a practitioner who taps
  // through pre-flight faster than IndexedDB opens must not lose the tick.
  useEffect(() => {
    let live = true;
    let stop: (() => void) | null = null;
    void (async () => {
      const store = await createStore();
      if (!live) return;
      void requestPersistentStorage();
      // Whose device this is, and nothing older than a week (section 7 and
      // the compliance review): a store claimed by somebody else is wiped
      // before it is used, and a visit that has not synced in seven days is
      // not going to.
      await store.claim(userIdOf(session));
      await store.prune(PRUNE_AFTER_DAYS, new Date());
      const next = new Outbox(
        store,
        postEventsVia(apiFetch, () => pointRef.current),
        postPhotoVia(apiFetch),
      );
      const unsubscribe = next.subscribe((state) => {
        setPending(state.pending);
        setPhotosPending(state.photosPending);
        setDurable(state.durable);
      });
      const stopLoop = next.start();
      setOutbox(next);
      const waiting = bufferRef.current;
      bufferRef.current = [];
      for (const record of waiting) await next.append(record);
      stop = () => {
        unsubscribe();
        stopLoop();
      };
    })();
    return () => {
      live = false;
      stop?.();
    };
    // `session` is read once, for whose store this is; re-reading it on every
    // auth refresh would re-open the store mid-visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, createStore]);

  // The note the next reload reads. Rewritten as the visit moves, so its own
  // record of how far the seq has got stays true.
  useEffect(() => {
    if (!outbox) return;
    void outbox.rememberOpenVisit({
      sessionId: visit.sessionId,
      clientLabel: visit.clientLabel,
      serviceTypeId: visit.serviceTypeId,
      checkedInAt: visit.checkedInAt,
      number: visit.number,
      of: visit.of,
      lastSeq: highWater,
    });
  }, [highWater, outbox, visit]);

  const write = useCallback(
    async (kind: string, payload: unknown): Promise<void> => {
      seqRef.current += 1;
      const record: OutboxRecord = {
        id: crypto.randomUUID(),
        sessionId: visit.sessionId,
        seq: seqRef.current,
        kind,
        deviceAt: new Date().toISOString(),
        payload,
      };
      setHighWater(record.seq);
      if (!outbox) {
        bufferRef.current.push(record);
        return;
      }
      await outbox.append(record);
    },
    [outbox, visit.sessionId],
  );

  // A chunk a minute while a reading exists (section 3.4). Nothing is written
  // before the practitioner has entered one: an invented zero would be a
  // measurement nobody took.
  useEffect(() => {
    if (step !== 'run') return;
    const tick = setInterval(() => {
      const current = readingRef.current;
      if (!current) return;
      const sample: TelemetrySample = {
        seconds: CHUNK_SECONDS,
        artefactPercent: current.artefactPercent,
        timeInRewardPercent: current.timeInRewardPercent,
        bands: {},
        threshold: null,
        at: new Date().toISOString(),
      };
      setTelemetry((all) => [...all, sample]);
      void write('telemetry_chunk', {
        seconds: sample.seconds,
        artefactPercent: sample.artefactPercent,
        timeInRewardPercent: sample.timeInRewardPercent,
      });
    }, CHUNK_SECONDS * 1000);
    return () => clearInterval(tick);
  }, [step, write]);

  const setupQuality = useMemo(() => meanQuality(sites), [sites]);

  /**
   * The setup photograph (docs/SPEC/practitioner-phone.md section 4.2): the
   * picture is shrunk and digested on the device, the `photo_captured` event
   * is appended, and the bytes wait in the outbox behind it.
   *
   * Both writes go through the outbox and neither waits for the network. A
   * photograph taken in a basement is kept exactly as a rating is, and a
   * retake before check-out replaces the blob and appends a new event — the
   * projection's `photo` is the last event's payload, so the server and the
   * device agree about which picture is the one.
   */
  const takePhoto = useCallback(
    async (file: File) => {
      setPhoto({ kind: 'preparing' });
      const prepared = await preparePhoto(file);
      if (prepared === null) {
        setPhoto({ kind: 'failed' });
        return;
      }
      await write('photo_captured', {
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
        sha256: prepared.sha256,
      });
      await outbox?.keepPhoto({
        sessionId: visit.sessionId,
        bytes: prepared.bytes,
        mimeType: prepared.mimeType,
        sha256: prepared.sha256,
        deviceAt: new Date().toISOString(),
      });
      setPhoto({ kind: 'kept', sizeBytes: prepared.sizeBytes });
    },
    [outbox, visit.sessionId, write],
  );

  const finishPreflight = useCallback(() => {
    void write('observation_recorded', {
      topic: 'preflight',
      items: settings.preflightChecklist.map((item) => ({
        key: item.key,
        done: checked[item.key] ?? false,
      })),
    });
    if (settings.ratingQuestions.length > 0) {
      void write('rating_recorded', {
        phase: 'pre',
        answers: settings.ratingQuestions.map((question) => ({
          key: question.key,
          value: preAnswers[question.key] ?? midpoint(question),
        })),
      });
    }
    setStep('signal');
  }, [checked, preAnswers, settings, write]);

  const startRun = useCallback(() => {
    void write('signal_checked', {
      sites: sites
        .filter((site) => site.site.trim().length > 0)
        .map((site) => ({ site: site.site.trim(), quality: site.quality })),
      overridden: setupQuality !== null && setupQuality < 0.6,
    });
    setStartedAtMs(Date.now());
    setStep('run');
  }, [setupQuality, sites, write]);

  const endRun = useCallback(() => {
    const started = startedAtMs ?? Date.now();
    setEndedAtMs(Date.now());
    void write('session_ended', { startedAt: new Date(started).toISOString() });
    setStep('post');
  }, [startedAtMs, write]);

  const finishPost = useCallback(() => {
    if (settings.ratingQuestions.length > 0) {
      void write('rating_recorded', {
        phase: 'post',
        answers: settings.ratingQuestions.map((question) => ({
          key: question.key,
          value: postAnswers[question.key] ?? midpoint(question),
        })),
      });
    }
    void write('observation_recorded', {
      topic: 'post',
      chips: observations.chips,
      tolerance: observations.tolerance,
      engagement: observations.engagement,
      note: observations.note.trim().length > 0 ? observations.note.trim() : null,
    });
    // Section 3.4's other half: one chunk covering the whole run — but only
    // if somebody actually took the reading. A slider nobody touched is not
    // a measurement of anything.
    if (telemetry.length === 0 && summaryReadingTaken) {
      const seconds = Math.max(
        1,
        Math.round(((endedAtMs ?? Date.now()) - (startedAtMs ?? Date.now())) / 1000),
      );
      const sample: TelemetrySample = {
        seconds,
        artefactPercent: summaryReading.artefactPercent,
        timeInRewardPercent: summaryReading.timeInRewardPercent,
        bands: {},
        threshold: null,
        at: new Date().toISOString(),
      };
      setTelemetry([sample]);
      void write('telemetry_chunk', {
        seconds,
        artefactPercent: sample.artefactPercent,
        timeInRewardPercent: sample.timeInRewardPercent,
      });
    }
    setStep('summary');
  }, [
    endedAtMs,
    observations,
    postAnswers,
    settings.ratingQuestions,
    startedAtMs,
    summaryReading,
    summaryReadingTaken,
    telemetry.length,
    write,
  ]);

  /**
   * Posts the close. 'closed' when it landed, 'wait' when it could not be
   * reached and is worth trying again, 'refused' when the server will never
   * take it — the same three answers the outbox reads, for the same reason:
   * a practitioner standing in a hallway must not be told to put the phone
   * away while something loops for ever behind the copy.
   */
  const postClose = useCallback(async (): Promise<'closed' | 'wait' | 'refused'> => {
    try {
      const res = await apiFetch(`/api/sessions/${visit.sessionId}/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitActuals: {
            driveSeconds: null,
            walkSeconds: null,
            salikCrossings: actuals.salikCrossings,
            parkingCostFils: actuals.parkingCostFils,
            accessIssues:
              actuals.accessIssues.trim().length > 0 ? actuals.accessIssues.trim() : null,
          },
        }),
      });
      if (res.ok) {
        return CloseResponse.safeParse(await res.json().catch(() => null)).success
          ? 'closed'
          : 'refused';
      }
      // 403 and 404 never change. 400 is a body this device will keep
      // sending. 409 does change — it is what the server says while the
      // check-out has not arrived — so that one waits.
      if (res.status === 400 || res.status === 403 || res.status === 404) return 'refused';
      return 'wait';
    } catch {
      return 'wait';
    }
  }, [actuals, apiFetch, visit.sessionId]);

  /**
   * Drains first, then closes. The order is the whole point: the server
   * closes a visit only when it already holds the check-out event (section
   * 2), so posting the close over a queue that has not gone yet answers 409
   * and leaves the practitioner waiting thirty seconds for a retry that was
   * always going to be needed.
   */
  const closeVisit = useCallback(async (): Promise<'closed' | 'wait' | 'refused'> => {
    if (outbox && !(await outbox.drain())) return 'wait';
    return postClose();
  }, [outbox, postClose]);

  const confirm = useCallback(async () => {
    setStep('finishing');
    pointRef.current = visit.shareLocation ? await readPosition() : null;
    await write('checked_out', {});
    const outcome = await closeVisit();
    if (outcome === 'closed') {
      await outbox?.rememberOpenVisit(null);
      setStep('done');
      return;
    }
    if (outcome === 'refused') setStep('blocked');
  }, [closeVisit, outbox, visit.shareLocation, write]);

  // The close is the one thing that needs the network. It is retried on the
  // outbox's own beat rather than asking the practitioner to stand there —
  // but only while it is worth retrying.
  useEffect(() => {
    if (step !== 'finishing') return;
    const retry = async () => {
      const outcome = await closeVisit();
      if (outcome === 'closed') {
        await outbox?.rememberOpenVisit(null);
        setStep('done');
      } else if (outcome === 'refused') {
        setStep('blocked');
      }
    };
    const timer = setInterval(() => void retry(), CLOSE_RETRY_MS);
    const onWake = () => void retry();
    if (typeof window !== 'undefined') window.addEventListener('online', onWake);
    return () => {
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', onWake);
    };
  }, [closeVisit, outbox, step]);

  const durationSeconds =
    startedAtMs !== null && endedAtMs !== null
      ? Math.round((endedAtMs - startedAtMs) / 1000)
      : null;
  const sessionQuality = scoreSignalQuality(telemetry);

  return (
    <div className="ground" data-ground="dark">
      <main className={step === 'run' ? 'runner runner--full' : 'runner plain plain--instrument'}>
        {step !== 'done' && step !== 'blocked' ? (
          <p className="sync" role="status">
            {pending === 0
              ? 'Everything on this visit is saved.'
              : pending === 1
                ? '1 event waiting to sync'
                : `${pending} events waiting to sync`}
            {photosPending === 1 ? ' The photo goes when the visit has synced.' : null}
            {durable ? null : ' This device cannot keep it if the app is closed.'}
          </p>
        ) : null}

        {step === 'preflight' ? (
          <PreflightStep
            service={settings}
            previousPhotoDocumentId={visit.previousSetupPhotoDocumentId}
            checked={checked}
            onToggle={(key, done) => setChecked((all) => ({ ...all, [key]: done }))}
            answers={preAnswers}
            onAnswer={(key, value) => setPreAnswers((all) => ({ ...all, [key]: value }))}
            onContinue={finishPreflight}
          />
        ) : null}

        {step === 'signal' ? (
          <SignalStep
            sites={sites}
            onChange={(index, site) =>
              setSites((all) => all.map((existing, i) => (i === index ? site : existing)))
            }
            onAddSite={() => setSites((all) => [...all, { site: '', quality: 0.8 }])}
            onStart={startRun}
          />
        ) : null}

        {step === 'run' && startedAtMs !== null ? (
          <RunStep
            clientLabel={visit.clientLabel}
            number={visit.number}
            of={visit.of}
            quality={setupQuality}
            startedAtMs={startedAtMs}
            reading={reading}
            onReading={setReading}
            onEnd={endRun}
          />
        ) : null}

        {step === 'post' ? (
          <PostStep
            service={settings}
            answers={postAnswers}
            onAnswer={(key, value) => setPostAnswers((all) => ({ ...all, [key]: value }))}
            observations={observations}
            onObservations={setObservations}
            needsSummaryReading={telemetry.length === 0}
            summaryReading={summaryReading}
            summaryReadingTaken={summaryReadingTaken}
            onSummaryReading={(next) => {
              setSummaryReading(next);
              setSummaryReadingTaken(true);
            }}
            photoConsent={visit.photoConsent}
            photo={photo}
            onPhoto={(file) => void takePhoto(file)}
            onContinue={finishPost}
          />
        ) : null}

        {step === 'summary' ? (
          <SummaryStep
            durationSeconds={durationSeconds}
            setupQuality={setupQuality}
            sessionQuality={sessionQuality}
            ratingDeltas={deltas(settings.ratingQuestions, preAnswers, postAnswers)}
            observations={observations}
            actuals={actuals}
            onActuals={setActuals}
            onConfirm={() => void confirm()}
          />
        ) : null}

        {step === 'finishing' ? (
          <div className="step">
            <h1>Checking out</h1>
            <p className="note">
              The visit is saved on this device. It will finish as soon as you have a connection,
              and you can put the phone away.
            </p>
          </div>
        ) : null}

        {step === 'blocked' ? (
          <div className="step">
            <h1>Not checked out</h1>
            <p className="note note--critical">{CLOSE_BLOCKED}</p>
            <div className="step__dock">
              <Button variant="primary" className="step__primary" onClick={onFinished}>
                Back to Today
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'done' ? (
          <div className="step">
            <h1>Checked out</h1>
            <p className="note">The visit is recorded.</p>
            <div className="step__dock">
              <Button variant="primary" className="step__primary" onClick={onFinished}>
                Back to Today
              </Button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/** Whose device this is. A signed-out shell claims nothing, and wipes instead. */
function userIdOf(session: ReturnType<typeof useAuth>['session']): string {
  return session.status === 'signed-in' ? session.actor.userId : 'signed-out';
}
