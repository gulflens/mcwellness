/**
 * Reads the text back out of a PDF this renderer produced.
 *
 * A rendered document's whole job is to say certain things and, when the
 * practice is not registered for VAT, to say certain other things nowhere at
 * all. Asserting that against a byte length or a snapshot proves neither, so the
 * tests read the words off the page: `tests/billing/document.test.ts` asserts
 * the headings, both languages, every figure to the fils, and — the one that
 * matters most — the absence of "Tax Invoice", of a rate and of a VAT number on
 * an unregistered practice's invoice.
 *
 * It works because the writer embeds a `/ToUnicode` map for every face, which a
 * real PDF wants anyway.
 *
 * **One thing that map does not yet give a reader.** Arabic is shaped and put
 * into drawing order before it is written (`arabic.ts`), so the map's entries
 * are presentation forms in visual order: text copied out of an Arabic run
 * comes back reversed and spelt in the FE70 block rather than in the letters
 * somebody would search for. It is legible to this extractor, which is reading
 * the same glyphs the page draws, and to a person reading the page — but it is
 * not usable text on the clipboard. Mapping each glyph back to the logical
 * character it came from would fix it, and is a small change to the writer
 * rather than to this file; it is recorded in
 * `docs/CHANGE-REQUESTS/billing-04.md` rather than done here, because it is not
 * what this round is for and the English half copies correctly today.
 *
 * So: what this reads is what the page draws, which is what the tests are
 * about. It is not a promise about the clipboard.
 *
 * Deliberately narrow: it understands the small subset `pdf.ts` writes
 * (uncompressed streams, hexadecimal strings, one `Tj` per run) and nothing
 * else. It is not a PDF parser and must not grow into one.
 */

const decoder = new TextDecoder('latin1');

type Objects = Map<number, string>;

/** Every `N 0 obj … endobj` in the file, as text. */
function objectsOf(pdf: string): Objects {
  const objects: Objects = new Map();
  const pattern = /(\d+) 0 obj\n([\s\S]*?)\nendobj/g;
  let match = pattern.exec(pdf);
  while (match) {
    const number = Number(match[1]);
    objects.set(number, match[2] ?? '');
    match = pattern.exec(pdf);
  }
  return objects;
}

/** The `beginbfchar` pairs of a ToUnicode CMap: glyph id to the text it draws. */
function bfcharsOf(body: string): Map<number, string> {
  const map = new Map<number, string>();
  const pattern = /<([0-9A-Fa-f]{4})> <([0-9A-Fa-f]{4,})>/g;
  let match = pattern.exec(body);
  while (match) {
    const glyph = Number.parseInt(match[1] ?? '0', 16);
    const target = match[2] ?? '';
    let text = '';
    for (let at = 0; at + 4 <= target.length; at += 4) {
      text += String.fromCharCode(Number.parseInt(target.slice(at, at + 4), 16));
    }
    map.set(glyph, text);
    match = pattern.exec(body);
  }
  return map;
}

/**
 * Every line of text on the page, in the order it was drawn.
 *
 * One entry per `Tj`, which is one entry per run of a single face — so a line
 * that changes language mid-way comes back as two entries. The tests join with
 * a space where they want the whole line.
 */
export function extractText(bytes: Uint8Array): string[] {
  const pdf = decoder.decode(bytes);
  const objects = objectsOf(pdf);

  // Resource name to the glyph map of the face behind it.
  const maps = new Map<string, Map<number, string>>();
  const fontDict = /\/Font << ([^>]*) >>/.exec(pdf)?.[1] ?? '';
  const reference = /\/(F\d+) (\d+) 0 R/g;
  let named = reference.exec(fontDict);
  while (named) {
    const resource = named[1] ?? '';
    const fontObject = objects.get(Number(named[2])) ?? '';
    const toUnicode = /\/ToUnicode (\d+) 0 R/.exec(fontObject)?.[1];
    if (toUnicode) {
      maps.set(resource, bfcharsOf(objects.get(Number(toUnicode)) ?? ''));
    }
    named = reference.exec(fontDict);
  }

  const lines: string[] = [];
  // Content streams are the objects with no /Type and a /Length, holding text
  // operators. Reading them by their operators rather than by object number
  // keeps this indifferent to the numbering pdf.ts happens to use.
  for (const body of objects.values()) {
    if (!body.includes(' Tj')) continue;
    const stream = /stream\n([\s\S]*)\nendstream/.exec(body)?.[1];
    if (stream === undefined) continue;
    let current: Map<number, string> | null = null;
    for (const statement of stream.split('\n')) {
      const font = /^\/(F\d+) [\d.]+ Tf$/.exec(statement);
      if (font) {
        current = maps.get(font[1] ?? '') ?? null;
        continue;
      }
      const shown = /^<([0-9A-Fa-f]*)> Tj$/.exec(statement);
      if (!shown || !current) continue;
      const hex = shown[1] ?? '';
      let text = '';
      for (let at = 0; at + 4 <= hex.length; at += 4) {
        text += current.get(Number.parseInt(hex.slice(at, at + 4), 16)) ?? '';
      }
      if (text.length > 0) lines.push(text);
    }
  }
  return lines;
}

/** Everything on the page as one string, for asking whether a word appears at all. */
export function extractAll(bytes: Uint8Array): string {
  return extractText(bytes).join(' ');
}
