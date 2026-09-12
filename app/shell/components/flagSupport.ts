/**
 * Whether this browser draws a flag emoji as a flag.
 *
 * Windows has never shipped flag glyphs: it renders the two regional-indicator
 * letters instead, so a country column there reads as two grey letters rather
 * than a picture. The operator chose emoji flags with that stated
 * (docs/superpowers/specs/2026-09-12-uae-formats-design.md), so this does not
 * replace them — it substitutes the ISO code only where the glyph is missing.
 *
 * Measured, not sniffed: a supported flag renders narrower than the two letters
 * it is built from. Canvas is unavailable under jsdom, so the measurement is a
 * DOM one and the whole thing answers `false` if anything is missing.
 */
let answer: boolean | null = null;

/**
 * Test-only: clears the memoised answer so a test can force a fresh
 * measurement instead of reusing whatever an earlier test in the same file
 * already decided.
 */
export function resetFlagsRenderForTests(): void {
  answer = null;
}

export function flagsRender(): boolean {
  if (answer !== null) return answer;
  // document.body is null until <body> exists (e.g. a script running in
  // <head>); either absence answers false rather than throwing.
  if (typeof document === 'undefined' || document.body === null) return (answer = false);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:32px;white-space:nowrap';
  document.body.appendChild(probe);
  probe.textContent = '\u{1F1E6}\u{1F1EA}'; // AE as a flag
  const asFlag = probe.getBoundingClientRect().width;
  probe.textContent = '\u{1F1E6}\u{1F1E6}'; // AA — assigned to no country, never a flag
  const asLetters = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);
  // jsdom measures everything as zero; that reads as "no flags", which is the safe answer.
  return (answer = asFlag > 0 && asFlag < asLetters);
}
