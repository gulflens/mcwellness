import { useEffect, useState } from 'react';
import { Button } from '../../shell/components/Controls';
import { SignalDots } from './SignalDots';
import { PercentSlider } from './Slider';
import type { Reading } from './steps';

/**
 * The run (docs/SPEC/session-capture.md section 3.4). Full-bleed: who is in
 * the room, which session of the programme this is, the signal, the elapsed
 * time, and one button. No navigation chrome, nothing to tap by accident,
 * nothing that needs two hands.
 *
 * The one other control is the reading: section 3.4 has a telemetry chunk
 * written every 60 seconds "with whatever the practitioner has entered", and
 * this is where they enter it — the two numbers the vendor's software shows.
 * It opens on a tap, closes on a tap, and while a reading exists the runner
 * writes a chunk a minute. A visit where nobody opens it records nothing per
 * minute and is asked for one summary at the end instead, which is the other
 * half of the same sentence in section 3.4.
 *
 * Ending takes two taps. The first arms it and the second does it, with the
 * clock still running and still visible between them: a phone held in one
 * hand with a child climbing on the practitioner is a phone that gets
 * tapped by accident, and ending a session is not undoable — the event is
 * written, and the run is over. A two-step control rather than a dialogue,
 * because a dialogue covers the timer and takes the decision off the screen
 * it belongs to.
 */

/** How long the armed state waits before it forgets it was armed. */
const ARMED_MS = 5000;

function elapsed(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function RunStep({
  clientLabel,
  number,
  of,
  quality,
  startedAtMs,
  reading,
  onReading,
  onEnd,
}: {
  clientLabel: string;
  number: number;
  of: number | null;
  quality: number | null;
  startedAtMs: number;
  reading: Reading | null;
  onReading: (reading: Reading) => void;
  onEnd: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // A control left armed by a pocket is a control that ends the next session
  // the practitioner touches. It disarms itself.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const draft = reading ?? { artefactPercent: 0, timeInRewardPercent: 0 };

  return (
    <div className="run">
      <header className="run__head">
        <span className="run__client">{clientLabel}</span>
        <span className="run__count small muted numeric">
          {of === null ? `Session ${number}` : `Session ${number} of ${of}`}
        </span>
      </header>

      <div className="run__body">
        <SignalDots quality={quality} />
        <p className="run__clock numeric" aria-live="off">
          {elapsed(startedAtMs, nowMs)}
        </p>
        <p className="small muted">elapsed</p>
      </div>

      {open ? (
        <section className="run__reading">
          <PercentSlider
            id="reading-reward"
            label="Time in reward"
            value={draft.timeInRewardPercent}
            onChange={(value) => onReading({ ...draft, timeInRewardPercent: value })}
          />
          <PercentSlider
            id="reading-artefact"
            label="Artefact"
            value={draft.artefactPercent}
            onChange={(value) => onReading({ ...draft, artefactPercent: value })}
          />
          <Button className="step__secondary" onClick={() => setOpen(false)}>
            Hide the reading
          </Button>
        </section>
      ) : (
        <Button className="step__secondary run__reading-toggle" onClick={() => setOpen(true)}>
          Record a reading
        </Button>
      )}

      <div className="step__dock">
        {armed ? (
          <p className="note small">Tap again to end the session. It cannot be restarted.</p>
        ) : null}
        <Button
          variant="primary"
          className="step__primary"
          onClick={() => (armed ? onEnd() : setArmed(true))}
        >
          {armed ? 'Tap again to end' : 'End session'}
        </Button>
      </div>
    </div>
  );
}
