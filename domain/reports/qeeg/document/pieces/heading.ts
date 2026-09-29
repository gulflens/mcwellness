/**
 * A title of the report: a heading or a subheading, underlined, in the
 * accent, set from the start edge.
 *
 * **Why it takes `Words`.** Most titles are the report's own wording, but a
 * map's label is a title a person typed, and reads the way its first letter
 * does. The caller says which; this piece never guesses.
 *
 * The underline, the size and the colour are the role's (`styles.ts`), so a
 * title here holds nothing of its own but the words it is handed.
 */

import type { Block } from '../block';
import { finite } from '../metrics';
import { typeset } from '../typeset';
import type { Drawing } from '../typeset';
import type { Words } from './words';

export type HeadingInput = {
  readonly words: Words;
  readonly level: 'heading' | 'subheading';
};

export function heading(input: HeadingInput, width: number, drawing: Drawing): Block {
  finite('heading', 'width', width);
  if (width < 0) {
    throw new RangeError(`heading needs a width of zero or more, and was given ${width}.`);
  }
  // Refused here, under its own name, rather than by the paragraph it sets.
  if (width === 0) throw new RangeError('heading is left no room for its words by a width of 0.');
  return typeset(input.level, input.words.text, width, drawing, { typed: input.words.typed });
}
