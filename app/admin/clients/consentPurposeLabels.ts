/**
 * What each consent purpose is called on screen.
 *
 * `ConsentTab.tsx`'s per-purpose rows and `SignAllForm.tsx`'s stacked
 * wordings both need the same seven words, and since the fix round of 10
 * September 2026 so does the filed signature image's own caption
 * (`SignAllForm.tsx` builds it from this map, `SignaturePad.tsx` draws it):
 * the spec is explicit that the caption names a purpose in the same words
 * the heading above it used, so a label changed in one file and not the
 * other would put one wording on the tab and a different one on a legal
 * artefact. One module, every importer (docs/SPEC/OWNERSHIP.md: a thing two
 * modules share moves and both import it).
 */
export const PURPOSE_LABELS: Record<string, string> = {
  participation: 'Participation',
  minor_participation: "Guardian's consent for a child",
  home_visit: 'Visits at home',
  health_data: 'Brain-map and neurofeedback information',
  photo_video: 'Photographs and video',
  research: 'Research',
  marketing: 'Marketing',
};
