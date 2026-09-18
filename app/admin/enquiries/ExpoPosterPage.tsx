import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { Button } from '../../shell/components/Controls';
import './poster.css';

/**
 * The poster for the stand (trunk round 50): one code that opens `/expo` on
 * a visitor's own phone, with the address in words beneath it for anyone
 * whose camera will not read it, and a Print button. Its own document,
 * outside the console's layout, so there is no rail to hide when it prints.
 *
 * What prints is the sheet: one A4 page headed by the practice's whole lockup
 * (docs/brand-assets.md), which is cut for a light ground, so the sheet is
 * white wherever it is shown. The Print button stands outside it. The violet
 * is on the sheet as borders and type and never as a fill, because a browser
 * leaves fills off the paper unless somebody ticks a box and always prints
 * the other two (poster.css).
 *
 * The code encodes this origin's own address, so staging prints a staging
 * code and production a production one; nothing about anybody is in it. The
 * encoder is `qrcode-generator`, a dependency with no dependencies of its
 * own, and the picture is drawn by this page as one SVG path from the
 * modules it answers — never its own markup, which would need
 * `dangerouslySetInnerHTML`, and never a data URL.
 */

/** The quiet zone the QR specification asks for: four modules of light on every side. */
const QUIET_ZONE = 4;

export function expoAddress(origin: string): string {
  return `${origin}/expo`;
}

/** One path: a unit square for every dark module, in the code's own coordinates. */
export function qrPath(text: string): { d: string; size: number } {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const modules = code.getModuleCount();
  const squares: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (code.isDark(row, col)) {
        squares.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
      }
    }
  }
  return { d: squares.join(''), size: modules + QUIET_ZONE * 2 };
}

export function ExpoPosterPage() {
  const address = expoAddress(window.location.origin);
  const { d, size } = useMemo(() => qrPath(address), [address]);
  const inWords = address.replace(/^https?:\/\//, '');
  return (
    <main className="poster">
      <Button variant="primary" className="poster__print" onClick={() => window.print()}>
        Print
      </Button>
      <article className="poster__sheet">
        <div className="poster__page">
          {/* The alt carries the name, as on sign-in: there is no text beside it. */}
          <img
            className="poster__lockup"
            src="/brand/lockup.png"
            alt="McWellness"
            width={960}
            height={402}
          />
          <div className="poster__invite">
            <h1 className="poster__title">Scan to tell us about yourself</h1>
            <p className="poster__lede">
              Leave your details and we will be in touch after the expo.
            </p>
          </div>
          <div className="poster__frame">
            <svg
              className="poster__code"
              viewBox={`0 0 ${size} ${size}`}
              shapeRendering="crispEdges"
              role="img"
              aria-label={`QR code for ${inWords}`}
            >
              <path fill="currentColor" d={d} />
            </svg>
          </div>
          <p className="poster__address">{inWords}</p>
        </div>
      </article>
    </main>
  );
}
