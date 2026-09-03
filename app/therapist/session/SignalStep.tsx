import { Button } from '../../shell/components/Controls';
import { SIGNAL_THRESHOLD, SignalDots } from './SignalDots';
import type { SiteReading } from './steps';

/**
 * The signal check (docs/SPEC/session-capture.md section 3.3): the quality
 * at each site, read off the amplifier's own software and typed in — Phase 1
 * is manual entry, file ingest is Phase 2 (section 9).
 *
 * One decision: start, or do not. Below the threshold the screen warns and
 * the practitioner decides; it never refuses. They are the one in the room.
 */

export function meanQuality(sites: readonly SiteReading[]): number | null {
  const named = sites.filter((site) => site.site.trim().length > 0);
  if (named.length === 0) return null;
  return named.reduce((total, site) => total + site.quality, 0) / named.length;
}

export function SignalStep({
  sites,
  onChange,
  onAddSite,
  onStart,
}: {
  sites: readonly SiteReading[];
  onChange: (index: number, site: SiteReading) => void;
  onAddSite: () => void;
  onStart: () => void;
}) {
  const quality = meanQuality(sites);
  const low = quality !== null && quality < SIGNAL_THRESHOLD;
  const ready = quality !== null;

  return (
    <div className="step">
      <h1>Signal</h1>
      <div className="signal__hero">
        <SignalDots quality={quality} />
      </div>

      <ul className="sites">
        {sites.map((site, index) => (
          <li className="site" key={index}>
            <div className="field site__name">
              <label className="field__label" htmlFor={`site-${index}`}>
                Site
              </label>
              <input
                id={`site-${index}`}
                className="field__input"
                autoComplete="off"
                placeholder="Cz"
                value={site.site}
                onChange={(event) => onChange(index, { ...site, site: event.target.value })}
              />
            </div>
            <div className="field site__quality">
              <label className="field__label" htmlFor={`quality-${index}`}>
                Quality
              </label>
              <div className="rating__row">
                <input
                  id={`quality-${index}`}
                  type="range"
                  className="rating__slider"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(site.quality * 100)}
                  onChange={(event) =>
                    onChange(index, { ...site, quality: Number(event.target.value) / 100 })
                  }
                />
                <output className="rating__value numeric" htmlFor={`quality-${index}`}>
                  {Math.round(site.quality * 100)}
                </output>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Button className="step__secondary" onClick={onAddSite}>
        Add another site
      </Button>

      <div className="step__dock">
        {low ? (
          <p className="note note--critical small">
            The signal is below the level this practice expects. You can start anyway.
          </p>
        ) : null}
        {!ready ? <p className="note small">Name at least one site to start.</p> : null}
        <Button variant="primary" className="step__primary" disabled={!ready} onClick={onStart}>
          {low ? 'Start anyway' : 'Start session'}
        </Button>
      </div>
    </div>
  );
}
