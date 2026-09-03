import { useEffect, useState } from 'react';
import { Button } from '../../shell/components/Controls';
import { SignalDots } from './SignalDots';
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
 */

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

  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

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
          <div className="rating">
            <label className="rating__label" htmlFor="reading-reward">
              Time in reward
            </label>
            <div className="rating__row">
              <input
                id="reading-reward"
                type="range"
                className="rating__slider"
                min={0}
                max={100}
                step={5}
                value={draft.timeInRewardPercent}
                onChange={(event) =>
                  onReading({ ...draft, timeInRewardPercent: Number(event.target.value) })
                }
              />
              <output className="rating__value numeric" htmlFor="reading-reward">
                {draft.timeInRewardPercent}
              </output>
            </div>
          </div>
          <div className="rating">
            <label className="rating__label" htmlFor="reading-artefact">
              Artefact
            </label>
            <div className="rating__row">
              <input
                id="reading-artefact"
                type="range"
                className="rating__slider"
                min={0}
                max={100}
                step={5}
                value={draft.artefactPercent}
                onChange={(event) =>
                  onReading({ ...draft, artefactPercent: Number(event.target.value) })
                }
              />
              <output className="rating__value numeric" htmlFor="reading-artefact">
                {draft.artefactPercent}
              </output>
            </div>
          </div>
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
        <Button variant="primary" className="step__primary" onClick={onEnd}>
          End session
        </Button>
      </div>
    </div>
  );
}
