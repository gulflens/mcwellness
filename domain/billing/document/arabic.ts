/**
 * Arabic, set the way it is read.
 *
 * A PDF places glyphs; it does not lay out a script. Arabic asks two things of
 * whoever places them, and both have to be done before the bytes are written:
 *
 *   **The letters change shape.** A letter is drawn differently depending on
 *   what it joins to on either side — isolated, at the start of a word, in the
 *   middle, at the end. Unicode stores the reading order (the letters), and
 *   the font draws the shapes, which live in the Arabic Presentation Forms-B
 *   block. Choosing between them is this file's first job. IBM Plex Sans
 *   Arabic — the app's own Arabic face, already in the repository — carries
 *   140 of those 144 forms, which is every one this uses.
 *
 *   **It reads right to left.** The glyphs still go into the content stream in
 *   the order they are drawn, left to right, so an Arabic run is reversed
 *   before it is written. Latin and digits inside that run keep their own
 *   direction: "الفاتورة INV-000001" has an Arabic word and a reference that
 *   is still read left to right, and reversing the whole thing would print the
 *   reference backwards.
 *
 * This is deliberately not a full bidirectional algorithm and does not pretend
 * to be one. It is the subset a bilingual invoice needs: Arabic words, Latin
 * words, digits and punctuation, in short labelled phrases. Anything richer —
 * nested embedding levels, mixed paragraph direction — is not on this document
 * and would want a real implementation rather than a wider version of this.
 *
 * Pure: text in, code points out (.claude/rules/testing.md).
 */

/** Isolated, final, initial, medial — in that order, as the tables below hold them. */
type Forms = readonly [number, number, number?, number?];

/**
 * Every Arabic letter this sets, and the presentation forms it takes.
 *
 * A letter with two forms joins only to its right (a following letter cannot
 * join onto it); one with four joins on both sides. The distinction is not
 * stored separately — the length of the entry *is* the joining class, which is
 * the same fact said once.
 */
const FORMS = new Map<number, Forms>([
  [0x0621, [0xfe80, 0xfe80]], // hamza: joins nothing, but takes an isolated shape
  [0x0622, [0xfe81, 0xfe82]],
  [0x0623, [0xfe83, 0xfe84]],
  [0x0624, [0xfe85, 0xfe86]],
  [0x0625, [0xfe87, 0xfe88]],
  [0x0626, [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c]],
  [0x0627, [0xfe8d, 0xfe8e]],
  [0x0628, [0xfe8f, 0xfe90, 0xfe91, 0xfe92]],
  [0x0629, [0xfe93, 0xfe94]],
  [0x062a, [0xfe95, 0xfe96, 0xfe97, 0xfe98]],
  [0x062b, [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c]],
  [0x062c, [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0]],
  [0x062d, [0xfea1, 0xfea2, 0xfea3, 0xfea4]],
  [0x062e, [0xfea5, 0xfea6, 0xfea7, 0xfea8]],
  [0x062f, [0xfea9, 0xfeaa]],
  [0x0630, [0xfeab, 0xfeac]],
  [0x0631, [0xfead, 0xfeae]],
  [0x0632, [0xfeaf, 0xfeb0]],
  [0x0633, [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4]],
  [0x0634, [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8]],
  [0x0635, [0xfeb9, 0xfeba, 0xfebb, 0xfebc]],
  [0x0636, [0xfebd, 0xfebe, 0xfebf, 0xfec0]],
  [0x0637, [0xfec1, 0xfec2, 0xfec3, 0xfec4]],
  [0x0638, [0xfec5, 0xfec6, 0xfec7, 0xfec8]],
  [0x0639, [0xfec9, 0xfeca, 0xfecb, 0xfecc]],
  [0x063a, [0xfecd, 0xfece, 0xfecf, 0xfed0]],
  [0x0641, [0xfed1, 0xfed2, 0xfed3, 0xfed4]],
  [0x0642, [0xfed5, 0xfed6, 0xfed7, 0xfed8]],
  [0x0643, [0xfed9, 0xfeda, 0xfedb, 0xfedc]],
  [0x0644, [0xfedd, 0xfede, 0xfedf, 0xfee0]],
  [0x0645, [0xfee1, 0xfee2, 0xfee3, 0xfee4]],
  [0x0646, [0xfee5, 0xfee6, 0xfee7, 0xfee8]],
  [0x0647, [0xfee9, 0xfeea, 0xfeeb, 0xfeec]],
  [0x0648, [0xfeed, 0xfeee]],
  [0x0649, [0xfeef, 0xfef0]],
  [0x064a, [0xfef1, 0xfef2, 0xfef3, 0xfef4]],
  [0x0671, [0xfb50, 0xfb51]],
]);

/**
 * Lam followed by one of four alefs is drawn as a single glyph, not two. This
 * is not decoration: the two letters written separately is simply not how the
 * word is spelt on the page, and every Arabic font ships the ligature.
 */
const LAM = 0x0644;
const LAM_ALEF = new Map<number, readonly [number, number]>([
  [0x0622, [0xfef5, 0xfef6]],
  [0x0623, [0xfef7, 0xfef8]],
  [0x0625, [0xfef9, 0xfefa]],
  [0x0627, [0xfefb, 0xfefc]],
]);

/**
 * Marks that sit on a letter rather than beside it: vowels, shadda, sukun, the
 * superscript alef. They take no shape of their own and — the part that
 * matters here — they do not interrupt a join, so a letter looks past them to
 * find its neighbour.
 */
function isTransparent(code: number): boolean {
  return (
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4) ||
    (code >= 0x06e7 && code <= 0x06e8) ||
    (code >= 0x06ea && code <= 0x06ed)
  );
}

/** Whether a character belongs to an Arabic run at all. */
export function isArabic(code: number): boolean {
  return (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  );
}

/** A letter that can join onto the letter before it (it has a final form). */
function joinsToPrevious(code: number): boolean {
  return FORMS.has(code);
}

/** A letter that a following letter can join onto: the four-form ones. */
function joinsToNext(code: number): boolean {
  return (FORMS.get(code)?.length ?? 0) === 4;
}

/** Neighbours, looking past any marks between. */
function neighbourBefore(codes: readonly number[], at: number): number | null {
  for (let index = at - 1; index >= 0; index -= 1) {
    const code = codes[index];
    if (code === undefined) return null;
    if (!isTransparent(code)) return code;
  }
  return null;
}

function neighbourAfter(codes: readonly number[], at: number): number | null {
  for (let index = at + 1; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === undefined) return null;
    if (!isTransparent(code)) return code;
  }
  return null;
}

/**
 * Replaces the letters of an Arabic run with the shapes they take in it, still
 * in reading order. A character with no entry — a digit, a comma, a space —
 * passes through untouched.
 */
export function shape(codes: readonly number[]): number[] {
  const shaped: number[] = [];
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === undefined) continue;

    const previous = neighbourBefore(codes, index);
    const next = neighbourAfter(codes, index);
    const joinedBefore = previous !== null && joinsToNext(previous);

    // Lam-alef, taken as one glyph and the alef stepped over.
    if (code === LAM && next !== null && LAM_ALEF.has(next)) {
      const ligature = LAM_ALEF.get(next);
      if (ligature) {
        shaped.push(joinedBefore ? ligature[1] : ligature[0]);
        // Skip the alef, and any marks that sat between the two letters.
        while (index + 1 < codes.length) {
          const skipped = codes[index + 1];
          if (skipped === undefined) break;
          index += 1;
          if (skipped === next) break;
        }
        continue;
      }
    }

    const forms = FORMS.get(code);
    if (!forms) {
      shaped.push(code);
      continue;
    }
    const joinedAfter = next !== null && joinsToPrevious(next) && joinsToNext(code);
    const medial = forms[3];
    const initial = forms[2];
    if (joinedBefore && joinedAfter && medial !== undefined) {
      shaped.push(medial);
    } else if (joinedBefore) {
      shaped.push(forms[1]);
    } else if (joinedAfter && initial !== undefined) {
      shaped.push(initial);
    } else {
      shaped.push(forms[0]);
    }
  }
  return shaped;
}

/** Digits and Latin: read left to right even inside an Arabic phrase. */
function isLeftToRight(code: number): boolean {
  return (
    (code >= 0x0030 && code <= 0x0039) ||
    (code >= 0x0041 && code <= 0x005a) ||
    (code >= 0x0061 && code <= 0x007a) ||
    (code >= 0x00c0 && code <= 0x024f)
  );
}

/**
 * Punctuation that takes its direction from what surrounds it rather than
 * having one of its own: the separators inside a figure, a date or a reference.
 *
 * The comma being here is not a detail. Without it "1,234.56" comes apart at
 * the comma and is drawn as "234.56,1" — a wrong number on an invoice, from a
 * character nobody thinks of as directional.
 */
function isNeutral(code: number): boolean {
  return (
    code === 0x0020 || // space
    code === 0x002c || // comma
    code === 0x002d || // hyphen
    code === 0x002e || // full stop
    code === 0x002f || // solidus
    code === 0x003a // colon
  );
}

/**
 * Puts a shaped run into the order the glyphs are drawn in: right to left,
 * except for stretches of Latin and digits, which keep their own order.
 *
 * The trailing-space detail is why this is not a plain reverse of everything
 * but the digits: a space between an Arabic word and a number belongs to
 * whichever side it sits beside once the line is turned round, and attaching it
 * to the left-to-right stretch is what stops "INV-000001 الفاتورة" losing its
 * gap.
 */
export function toVisualOrder(codes: readonly number[]): number[] {
  const out: number[] = [];
  let index = 0;
  while (index < codes.length) {
    const code = codes[index];
    if (code === undefined) break;
    if (isLeftToRight(code)) {
      // Take the whole left-to-right stretch, including spaces and punctuation
      // inside it, and keep it as it stands.
      const start = index;
      let end = index;
      for (let look = index; look < codes.length; look += 1) {
        const at = codes[look];
        if (at === undefined) break;
        if (isLeftToRight(at)) {
          end = look;
        } else if (isNeutral(at)) {
          // Carried along, but never extending the run on its own: a space
          // between a number and the Arabic that follows belongs to the Arabic.
          continue;
        } else {
          break;
        }
      }
      out.unshift(...codes.slice(start, end + 1));
      index = end + 1;
      continue;
    }
    out.unshift(code);
    index += 1;
  }
  return out;
}

/**
 * An Arabic string, ready to be placed: shaped, then put into drawing order.
 * The one call the renderer makes.
 */
export function forDrawing(text: string): number[] {
  return toVisualOrder(shape([...text].map((character) => character.codePointAt(0) ?? 0)));
}
