/**
 * Breaking a signature image's caption into lines that fit (fix round of 10
 * September 2026, `docs/CONSENT/README.md`'s sibling brief: the filed image
 * must name the purposes in the headings' own words, and those run wider
 * than one `fillText` line ever holds). Pure, so it can be proved against a
 * fake measurer without a real canvas — `SignaturePad.tsx` is the one caller
 * and passes `(text) => ctx.measureText(text).width`.
 *
 * Breaks only on spaces. A single word that alone measures wider than
 * `maxWidth` is never split — canvas text has no hyphenation to fall back
 * on, so it is left on its own line rather than cut at the edge.
 */

export type TextMeasurer = (text: string) => number;

export function wrapCaption(text: string, maxWidth: number, measure: TextMeasurer): string[] {
  const words = text.split(' ').filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = words[0] as string;
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}
