import { getDefaultNormalizer } from '@testing-library/react';

/**
 * A text normaliser that also removes the bidirectional isolates an arrival
 * window is wrapped in (`formatArrivalWindow`, domain/scheduling/window.ts).
 *
 * The isolates are invisible and are what stop "09:00–09:45" rendering as
 * "09:45–09:00" beside an Arabic name. They are still two real code points in
 * the DOM, so a test asking for the window by its plain text needs to say so;
 * asking for a looser regex instead would stop the tests noticing if the
 * window text itself ever changed.
 */
export const plainText = {
  normalizer: (text: string) => getDefaultNormalizer()(text).replace(/[⁦-⁩]/g, ''),
};
