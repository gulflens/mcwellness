import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Button, Note } from '../../shell/components/Controls';
import { POSTER_LEDE, POSTER_TITLE, makePosterPdf, savePdf as saveFile } from './posterPdf';
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
 * And the sheet as a file, beside Print. Chrome and Firefox print this page as
 * the sheet alone, because the page leaves them no margin to write in. Safari
 * writes its own date, title, address and page number over any page it prints,
 * and nothing the page says stops it; it writes none of them on a PDF. So
 * "Download PDF" draws the same sheet in the browser and hands it over as one
 * page of A4 (posterPdf.ts). A PDF is not a web page, so there is nothing for
 * those lines to be written on; that is how Safari and Preview are known to
 * treat one, and was not printed from either here.
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

const COULD_NOT = 'The PDF could not be made. Print this page instead.';

export function ExpoPosterPage({
  makePdf = makePosterPdf,
  savePdf = saveFile,
}: {
  /** The two halves of the download, so a test can stand in for a canvas it has not got. */
  makePdf?: typeof makePosterPdf;
  savePdf?: typeof saveFile;
} = {}) {
  const address = expoAddress(window.location.origin);
  const code = useMemo(() => qrPath(address), [address]);
  const inWords = address.replace(/^https?:\/\//, '');
  const [file, setFile] = useState<'idle' | 'making' | 'failed'>('idle');

  async function download(): Promise<void> {
    setFile('making');
    try {
      savePdf(await makePdf({ inWords, code }), 'McWellness-expo-poster.pdf');
      setFile('idle');
    } catch {
      // Nothing to report and nobody to report it to: the sheet holds no one's
      // details, and Print is still there.
      setFile('failed');
    }
  }

  return (
    <main className="poster">
      <div className="poster__tools">
        <div className="poster__buttons">
          <Button variant="primary" disabled={file === 'making'} onClick={() => void download()}>
            {file === 'making' ? 'Preparing the PDF' : 'Download PDF'}
          </Button>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
        {/*
          The sentence stays when the file fails: "print this page instead" is
          the moment somebody needs to know what Safari does to a printed page.
        */}
        {file === 'failed' ? <Note tone="critical">{COULD_NOT}</Note> : null}
        <Note>
          The PDF prints as the poster and nothing else. If you print this page from Safari instead,
          Safari adds the date and the web address to the paper unless you untick “Print headers and
          footers” in its print window.
        </Note>
      </div>
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
            <h1 className="poster__title">{POSTER_TITLE}</h1>
            <p className="poster__lede">{POSTER_LEDE}</p>
          </div>
          <div className="poster__frame">
            <svg
              className="poster__code"
              viewBox={`0 0 ${code.size} ${code.size}`}
              shapeRendering="crispEdges"
              role="img"
              aria-label={`QR code for ${inWords}`}
            >
              <path fill="currentColor" d={code.d} />
            </svg>
          </div>
          <p className="poster__address">{inWords}</p>
        </div>
      </article>
    </main>
  );
}
