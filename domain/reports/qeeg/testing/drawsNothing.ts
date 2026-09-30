/**
 * One of each kind of character that draws nothing, for the tests of
 * `isBlank` and of every place that asks whether typed text is empty.
 *
 * **Why it is a file of its own.** Three test files try each character
 * alone (the text rules, the shape and the second-language rebuild), and a
 * list copied three times would drift. A test file cannot be imported by
 * another without running its tests twice, so the list lives here. Nothing
 * outside a test imports it.
 */

export const DRAWS_NOTHING: readonly string[] = [
  ' ',
  '\u00a0',
  '\u2003',
  '\u3000',
  '\u200c',
  '\u200d',
  '\u00ad',
  '\u3164',
  '\u115f',
  '\u1160',
  '\uffa0',
  '\ufe00',
  '\ufe0f',
  '\u0301',
  '\u0651',
];
