import type { Ribbon as RibbonData } from '@domain/reports';

/**
 * The session ribbon (docs/DESIGN-BRIEF.md section 5): one continuous
 * horizontal strip representing the whole programme. Each delivered session is
 * a vertical slice, its height the recording's quality and its colour the
 * dominant trained band; empty slices ahead show the sessions remaining, and a
 * hairline marks each brain map.
 *
 * **This is where the boldness is spent, and it is the only hue on the
 * screen.** The five band colours come from `app/shell/tokens.css` and nowhere
 * else — no literal, no ramp, no fallback hex (CLAUDE.md's visual system).
 *
 * **The paper's ribbon is the same figure in ink.** The shared PDF writer sets
 * type and rules in greyscale and has no colour operator, and
 * `domain/shared/document` is the shared zone this worktree may not edit, so
 * the printed strip carries the shape and names its bands in words while this
 * one carries the hue. `docs/CHANGE-REQUESTS/reports-01.md` asks the trunk for
 * the operator that would let both carry it.
 *
 * Drawn as an SVG rather than as a row of divs: the strip has to hold its
 * proportions at any width, and a slice is a rectangle whose height means
 * something. No motion here — the design brief's one animated exception is the
 * client app's own ribbon, not the console's.
 */

const HEIGHT = 44;
const GAP = 1.4;
const MAX_SLICE = 9;
const MIN_SLICE = 1.2;
/** A visit with no quality score still has to be visible. */
const FLOOR = 0.12;

export function Ribbon({ ribbon, label }: { ribbon: RibbonData; label?: string }) {
  const total = ribbon.slices.length + ribbon.remaining;
  if (total === 0) return null;

  // The strip is laid out in its own coordinates and scaled to whatever width
  // it is given, so the figure is the same on a laptop and on a printout of
  // this screen.
  const step = Math.min(MAX_SLICE + GAP, 100 / total);
  const width = step * total;
  const sliceWidth = Math.max(MIN_SLICE, Math.min(MAX_SLICE, step - GAP));

  const described =
    label ??
    `${ribbon.slices.length} of ${total} sessions delivered` +
      (ribbon.remaining > 0 ? `, ${ribbon.remaining} to come` : '');

  return (
    <svg
      className="ribbon"
      viewBox={`0 0 ${width} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={described}
    >
      {ribbon.slices.map((slice, at) => {
        const quality = slice.quality === null ? FLOOR : Math.max(FLOOR, slice.quality);
        const height = Math.max(0.8, quality * HEIGHT);
        const x = at * step;
        return (
          <g key={slice.index}>
            <rect
              x={x}
              y={HEIGHT - height}
              width={sliceWidth}
              height={height}
              // The band's own token, and nothing else. A slice whose visit
              // recorded no band is drawn in ink rather than in a colour that
              // would claim one.
              className={`ribbon__slice ribbon__slice--${slice.band ?? 'none'}`}
            />
            {slice.mapMark ? (
              <rect
                x={Math.max(0, x - GAP)}
                y={0}
                width={0.5}
                height={HEIGHT}
                className="ribbon__map"
              />
            ) : null}
          </g>
        );
      })}
      {Array.from({ length: ribbon.remaining }, (_, at) => (
        <rect
          key={`empty-${at}`}
          x={(ribbon.slices.length + at) * step}
          y={HEIGHT - 1.2}
          width={sliceWidth}
          height={1.2}
          className="ribbon__empty"
        />
      ))}
    </svg>
  );
}
