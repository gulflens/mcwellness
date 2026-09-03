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
import { Outbox, type PostEvents } from './outbox/outbox';
import {
  createOutboxStore,
  requestPersistentStorage,
  type OutboxRecord,
  type OutboxStore,
} from './outbox/store';
import type { PreparedPhoto } from './photo';
import {
  deltas,
  type Answers,
  type Observations,
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
 * The one thing that does need a connection is the very last step. Closing
 * a visit is a server-side transaction (section 4) — the entitlement, the
 * appointment, the audit — so a check-out taken offline is queued like
 * everything else and the close is retried until it lands. The screen says
 * exactly that, calmly, and the practitioner may walk away from it.
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
  photoConsent: boolean;
  /** The last seq the server holds, so a resumed visit does not reuse one. */
  lastSeq: number;
  /** Whether the practitioner shared their position at the door (section 3.6). */
  shareLocation: boolean;
};

type Step = 'preflight' | 'signal' | 'run' | 'post' | 'summary' | 'finishing' | 'done';

const EMPTY_SETTINGS: ServiceSettings = { preflightChecklist: [], ratingQuestions: [] };

/**
 * How the outbox reaches this API, and how it reads the answer. The
 * distinction that matters is between "try again" and "never": a refusal the
 * server will repeat forever must not be retried every thirty seconds for
 * the rest of the day.
 */
export function postEventsVia(apiFetch: ApiFetch): PostEvents {
  return async (sessionId, records) => {
    const events = records.map((record) => ({
      id: record.id,
      seq: record.seq,
      kind: record.kind,
      deviceAt: record.deviceAt,
      payload: record.payload,
    }));
    let res: Response;
    try {
      res = await apiFetch(`/api/sessions/${sessionId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
      });
    } catch {
      return 'retry';
    }
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

function midpoint(min: number, max: number): number {
  return Math.round((min + max) / 2);
}

/** A single position read, or null. A refusal is never a block (section 7). */
function readPosition(): Promise<{ lat: number; lng: number } | null> {
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (!geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { lat: number; lng: number } | null) => {
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
  const { apiFetch } = useAuth();
  const settings: ServiceSettings = service ?? EMPTY_SETTINGS;

  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [pending, setPending] = useState(0);
  const [durable, setDurable] = useState(true);
  const [step, setStep] = useState<Step>('preflight');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [preAnswers, setPreAnswers] = useState<Answers>({});
  const [postAnswers, setPostAnswers] = useState<Answers>({});
  const [sites, setSites] = useState<SiteReading[]>([{ site: '', quality: 0.8 }]);
  const [reading, setReading] = useState<Reading | null>(null);
  const [summaryReading, setSummaryReading] = useState<Reading>({
    artefactPercent: 0,
    timeInRewardPercent: 0,
  });
  const [observations, setObservations] = useState<Observations>({
    chips: [],
    tolerance: null,
    engagement: null,
    note: '',
  });
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
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
      const next = new Outbox(store, postEventsVia(apiFetch));
      const unsubscribe = next.subscribe((state) => {
        setPending(state.pending);
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

  const quality = useMemo(() => meanQuality(sites), [sites]);

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
          value: preAnswers[question.key] ?? midpoint(question.min, question.max),
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
      overridden: quality !== null && quality < 0.6,
    });
    setStartedAtMs(Date.now());
    setStep('run');
  }, [quality, sites, write]);

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
          value: postAnswers[question.key] ?? midpoint(question.min, question.max),
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
    if (telemetry.length === 0) {
      // Section 3.4's other half: one chunk covering the whole run.
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
    if (photo) {
      void write('photo_captured', {
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
        sha256: photo.sha256,
      });
    }
    setStep('summary');
  }, [
    endedAtMs,
    observations,
    photo,
    postAnswers,
    settings.ratingQuestions,
    startedAtMs,
    summaryReading,
    telemetry.length,
    write,
  ]);

  const closeVisit = useCallback(async (): Promise<boolean> => {
    await outbox?.flush();
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
      if (!res.ok) return false;
      return CloseResponse.safeParse(await res.json().catch(() => null)).success;
    } catch {
      return false;
    }
  }, [actuals, apiFetch, outbox, visit.sessionId]);

  const confirm = useCallback(async () => {
    setStep('finishing');
    const point = visit.shareLocation ? await readPosition() : null;
    await write('checked_out', { point });
    if (await closeVisit()) {
      await outbox?.rememberOpenVisit(null);
      setStep('done');
    }
  }, [closeVisit, outbox, visit.shareLocation, write]);

  // The close is the one thing that needs the network. It is retried on the
  // outbox's own beat rather than asking the practitioner to stand there.
  useEffect(() => {
    if (step !== 'finishing') return;
    const retry = async () => {
      if (await closeVisit()) {
        await outbox?.rememberOpenVisit(null);
        setStep('done');
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
  const score = scoreSignalQuality(telemetry);

  return (
    <div className="ground" data-ground="dark">
      <main className={step === 'run' ? 'runner runner--full' : 'runner plain plain--instrument'}>
        {step !== 'done' ? (
          <p className="sync" role="status">
            {pending === 0
              ? 'Everything on this visit is saved.'
              : pending === 1
                ? '1 event waiting to sync'
                : `${pending} events waiting to sync`}
            {durable ? null : ' This device cannot keep it if the app is closed.'}
          </p>
        ) : null}

        {step === 'preflight' ? (
          <PreflightStep
            service={settings}
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
            quality={quality}
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
            onSummaryReading={setSummaryReading}
            photoConsent={visit.photoConsent}
            photo={photo}
            onPhoto={setPhoto}
            onContinue={finishPost}
          />
        ) : null}

        {step === 'summary' ? (
          <SummaryStep
            durationSeconds={durationSeconds}
            signalQuality={score}
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
