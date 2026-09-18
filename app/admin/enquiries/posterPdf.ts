/**
 * The stand's poster as a file (19 September 2026).
 *
 * Why there is a file at all: Safari draws its own date, title, address and
 * page number on every web page it prints, over whatever margins the page
 * asked for, and nothing a page can say turns them off — it was tried through
 * WebKit's own print path and the lines came out regardless
 * (docs/CHANGE-REQUESTS/trunk-round-50.md). Safari draws none of them on a
 * PDF, and neither does Preview. So the poster is also drawn here, onto a
 * canvas at print resolution, and handed over as one page of A4.
 *
 * All of it happens in the browser. Nothing is sent anywhere, there is no
 * route and no dependency, and the code holds this origin's `/expo` address
 * exactly as the page's does.
 *
 * Why this is not `domain/shared/document/pdf.ts`: that writer sets type from
 * TrueType programs that live on the server, and embeds a PNG's own scanlines.
 * This sheet is a picture the browser has already drawn, and PDF's
 * `/DCTDecode` *is* JPEG, so the canvas's bytes go into the file untouched
 * and the whole of the writer is a cross-reference table.
 *
 * The sheet is described twice — by `poster.css` for the page and by
 * `POSTER_MM` for the file — and `posterPdf.test.ts` reads the stylesheet to
 * keep the two the same sheet.
 */

export const A4_MM = { width: 210, height: 297 } as const;

/** A4 in PDF points, to the figures `domain/shared/document/pdf.ts` uses. */
const A4_PT = { width: 595.28, height: 841.89 } as const;

/** 300 dots to the inch: what a desk printer resolves, and 2480 by 3508 pixels. */
const PX_PER_MM = 300 / 25.4;

/** Every length on the sheet, in millimetres of A4, as `poster.css` has them. */
export const POSTER_MM = {
  margin: 14,
  bar: 3,
  padding: 9,
  minGap: 7,
  lockupWidth: 120,
  /** `public/brand/lockup.png` is 960 by 402 (docs/brand-assets.md). */
  lockupRatio: 402 / 960,
  inviteGap: 4,
  inviteWidth: 160,
  title: { size: 14, line: 17 },
  lede: { size: 6.5, line: 9 },
  frame: { size: 104, padding: 2, border: 1.2, radius: 4 },
  address: { size: 9, line: 12 },
} as const;

export const POSTER_TITLE = 'Scan to tell us about yourself';
export const POSTER_LEDE = 'Leave your details and we will be in touch after the expo.';

type Measure = (text: string) => number;

function greedyLines(words: readonly string[], width: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    // A word wider than the line still gets a line: it is never dropped.
    if (line !== '' && measure(next) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * What `text-wrap: balance` does: as few lines as the width allows, and then
 * the narrowest width that still makes that few, so two lines come out even
 * rather than one full and one short.
 */
export function balancedLines(text: string, maxWidth: number, measure: Measure): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const natural = greedyLines(words, maxWidth, measure);
  if (natural.length <= 1) return natural;
  let narrow = 0;
  let wide = maxWidth;
  for (let step = 0; step < 24; step += 1) {
    const middle = (narrow + wide) / 2;
    if (greedyLines(words, middle, measure).length <= natural.length) wide = middle;
    else narrow = middle;
  }
  return greedyLines(words, wide, measure);
}

/**
 * Where everything stands, in millimetres from the sheet's top-left corner:
 * the column `poster.css` lays out with `justify-content: space-between`.
 */
export function posterLayout({ titleLines, ledeLines }: { titleLines: number; ledeLines: number }) {
  const m = POSTER_MM;
  const inner = A4_MM.width - m.margin * 2;
  const top = m.margin + m.bar + m.padding;
  const bottom = A4_MM.height - top;
  const lockupHeight = m.lockupWidth * m.lockupRatio;
  const titleHeight = titleLines * m.title.line;
  const ledeHeight = ledeLines * m.lede.line;
  const parts =
    lockupHeight + titleHeight + m.inviteGap + ledeHeight + m.frame.size + m.address.line;
  // Three gaps between four parts; the title and the lede are one part.
  const gap = Math.max(m.minGap, (bottom - top - parts) / 3);
  const centre = A4_MM.width / 2;

  const lockupY = top;
  const titleY = lockupY + lockupHeight + gap;
  const ledeY = titleY + titleHeight + m.inviteGap;
  const frameY = ledeY + ledeHeight + gap;
  const addressY = frameY + m.frame.size + gap;
  return {
    centre,
    bars: {
      top: { x: m.margin, y: m.margin, width: inner, height: m.bar },
      bottom: { x: m.margin, y: A4_MM.height - m.margin - m.bar, width: inner, height: m.bar },
    },
    lockup: {
      x: centre - m.lockupWidth / 2,
      y: lockupY,
      width: m.lockupWidth,
      height: lockupHeight,
    },
    title: { y: titleY, height: titleHeight },
    lede: { y: ledeY, height: ledeHeight },
    frame: { x: centre - m.frame.size / 2, y: frameY, size: m.frame.size },
    address: { y: addressY, height: m.address.line },
  };
}

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

/** A PDF string holds its own brackets and backslash only when they are escaped. */
function pdfString(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (char) => `\\${char}`);
}

/**
 * One page of A4 with one picture over the whole of it. Six objects, written
 * in order, and a cross-reference table of the byte each one starts at, which
 * is all a reader uses to find them.
 */
export function pdfFromJpeg(
  jpeg: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  title: string,
): Uint8Array<ArrayBuffer> {
  const { width, height } = A4_PT;
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  const write = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    at += chunk.length;
  };
  const object = (number: number, ...body: (string | Uint8Array)[]): void => {
    offsets[number] = at;
    write(ascii(`${number} 0 obj\n`));
    for (const part of body) write(typeof part === 'string' ? ascii(part) : part);
    write(ascii('\nendobj\n'));
  };

  // The second line is four bytes above 127, which tells a program moving the
  // file that it is not text and must not have its line endings mended.
  write(ascii('%PDF-1.4\n'));
  write(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
      '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ' +
      `/Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  );
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  object(6, `<< /Title (${pdfString(title)}) >>`);

  const xrefAt = at;
  const rows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  write(ascii(`xref\n0 7\n0000000000 65535 f \n${rows}`));
  write(ascii(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  const file = new Uint8Array(at);
  let cursor = 0;
  for (const chunk of chunks) {
    file.set(chunk, cursor);
    cursor += chunk.length;
  }
  return file;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  // By hand, not `roundRect`, which the browsers took up years apart.
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + size, y, x + size, y + size, radius);
  ctx.arcTo(x + size, y + size, x, y + size, radius);
  ctx.arcTo(x, y + size, x, y, radius);
  ctx.arcTo(x, y, x + size, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });
}

function jpegOf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('the canvas gave no picture'));
        else void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      'image/jpeg',
      0.95,
    );
  });
}

export type PosterCode = {
  /** The code as `qrPath` answers it: unit squares, and the side with its quiet zone. */
  d: string;
  size: number;
};

/**
 * Draws the sheet and answers the file. Colours and the typeface are read from
 * the page's own tokens, so the file cannot drift from `tokens.css` and no
 * colour is written here.
 */
export async function makePosterPdf({
  inWords,
  code,
}: {
  inWords: string;
  code: PosterCode;
}): Promise<Uint8Array<ArrayBuffer>> {
  const tokens = getComputedStyle(document.documentElement);
  const token = (name: string): string => tokens.getPropertyValue(name).trim();
  const family = token('--font');
  const face = (weight: string, sizeMm: number): string =>
    `${weight} ${sizeMm * PX_PER_MM}px ${family}`;
  const regular = token('--w-regular');
  const medium = token('--w-medium');

  const [lockup] = await Promise.all([
    loadImage('/brand/lockup.png'),
    // A face the page has not yet set type in is a face not yet loaded, and a
    // canvas would quietly draw the fallback in its place.
    document.fonts.load(face(regular, POSTER_MM.lede.size)),
    document.fonts.load(face(medium, POSTER_MM.title.size)),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A4_MM.width * PX_PER_MM);
  canvas.height = Math.round(A4_MM.height * PX_PER_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas to draw on');
  const px = (mm: number): number => mm * PX_PER_MM;

  const widthOf: Measure = (text) => ctx.measureText(text).width;
  ctx.font = face(medium, POSTER_MM.title.size);
  const titleLines = balancedLines(POSTER_TITLE, px(POSTER_MM.inviteWidth), widthOf);
  ctx.font = face(regular, POSTER_MM.lede.size);
  const ledeLines = balancedLines(POSTER_LEDE, px(POSTER_MM.inviteWidth), widthOf);
  const layout = posterLayout({ titleLines: titleLines.length, ledeLines: ledeLines.length });

  ctx.fillStyle = token('--surface');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = token('--brand');
  for (const bar of [layout.bars.top, layout.bars.bottom]) {
    ctx.fillRect(px(bar.x), px(bar.y), px(bar.width), px(bar.height));
  }

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    lockup,
    px(layout.lockup.x),
    px(layout.lockup.y),
    px(layout.lockup.width),
    px(layout.lockup.height),
  );

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const setLines = (
    lines: readonly string[],
    top: number,
    type: { size: number; line: number },
  ): void => {
    // A line box stands its type in the middle, as CSS does: what is left of
    // the line's height after the face's own ascent and descent is shared
    // above and below.
    const probe = ctx.measureText('Hg');
    const ascent = probe.fontBoundingBoxAscent ?? px(type.size) * 0.8;
    const descent = probe.fontBoundingBoxDescent ?? px(type.size) * 0.2;
    const lead = (px(type.line) - (ascent + descent)) / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, px(layout.centre), px(top + index * type.line) + lead + ascent);
    });
  };
  ctx.fillStyle = token('--ink');
  ctx.font = face(medium, POSTER_MM.title.size);
  setLines(titleLines, layout.title.y, POSTER_MM.title);
  ctx.fillStyle = token('--ink-2');
  ctx.font = face(regular, POSTER_MM.lede.size);
  setLines(ledeLines, layout.lede.y, POSTER_MM.lede);

  const { border, padding, radius, size } = POSTER_MM.frame;
  ctx.strokeStyle = token('--brand');
  ctx.lineWidth = px(border);
  // A stroke straddles its path, so the path runs down the border's middle.
  roundedRect(
    ctx,
    px(layout.frame.x + border / 2),
    px(layout.frame.y + border / 2),
    px(size - border),
    px(radius - border / 2),
  );
  ctx.stroke();

  // A whole number of pixels to the module, centred in the frame: every edge
  // of the code lands on a pixel, so no module is a grey one.
  const room = px(size - (border + padding) * 2);
  const module = Math.floor(room / code.size);
  const inset = (room - module * code.size) / 2;
  ctx.save();
  ctx.translate(
    Math.round(px(layout.frame.x + border + padding) + inset),
    Math.round(px(layout.frame.y + border + padding) + inset),
  );
  ctx.scale(module, module);
  ctx.fillStyle = token('--ink');
  ctx.fill(new Path2D(code.d));
  ctx.restore();

  ctx.fillStyle = token('--brand');
  ctx.font = face(medium, POSTER_MM.address.size);
  setLines([inWords], layout.address.y, POSTER_MM.address);

  return pdfFromJpeg(await jpegOf(canvas), canvas.width, canvas.height, 'McWellness expo poster');
}

/** Hands a file to the browser's own download, and lets go of it afterwards. */
export function savePdf(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Not at once: Safari reads the file after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
