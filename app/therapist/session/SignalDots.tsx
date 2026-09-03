/**
 * The five-dot signal indicator (docs/DESIGN-BRIEF.md section 6.1). Five
 * dots, filled to the quality of the reading, with the word beside them —
 * large and glanceable, because it is read at arm's length in bad light.
 *
 * Achromatic, like the rest of the chrome: a filled dot is ink and an empty
 * one is a ring. The one exception is a reading below the threshold, which
 * takes the critical token — that is a status, which section 3.3 of the
 * design brief allows hue for, and it is the only thing on this screen that
 * needs to interrupt someone.
 */

/** Below this, the practitioner is warned and decides for themselves (section 3.3). */
export const SIGNAL_THRESHOLD = 0.6;

const DOTS = 5;

/** The word for a quality, so the number is never the only thing said. */
export function describeSignal(quality: number | null): string {
  if (quality === null) return 'Not checked';
  if (quality >= 0.85) return 'Very good';
  if (quality >= SIGNAL_THRESHOLD) return 'Good';
  if (quality >= 0.35) return 'Poor';
  return 'Very poor';
}

export function SignalDots({
  quality,
  label = true,
}: {
  /** 0 to 1, or null when nothing has been read yet. */
  quality: number | null;
  label?: boolean;
}) {
  const filled = quality === null ? 0 : Math.max(1, Math.round(quality * DOTS));
  const word = describeSignal(quality);
  const low = quality !== null && quality < SIGNAL_THRESHOLD;
  return (
    <div className={low ? 'signal signal--low' : 'signal'}>
      <span className="signal__dots" role="img" aria-label={`Signal ${word.toLowerCase()}`}>
        {Array.from({ length: DOTS }, (_, index) => (
          <span
            key={index}
            className={index < filled ? 'signal__dot signal__dot--on' : 'signal__dot'}
            aria-hidden="true"
          />
        ))}
      </span>
      {label ? <span className="signal__word">{word}</span> : null}
    </div>
  );
}
