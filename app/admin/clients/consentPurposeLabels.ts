import type { ConsentPurpose } from '@domain/client';

/**
 * What each consent purpose is called on screen.
 *
 * `ConsentTab.tsx`'s per-purpose rows and `SignAllForm.tsx`'s stacked
 * wordings both need the same seven words, and since the fix round of 10
 * September 2026 so does the filed signature image's own caption
 * (`SignAllForm.tsx` builds it from this map, `SignaturePad.tsx` draws it).
 * That round decided the caption names a purpose in the same words the
 * heading above it used — not the plan's own shorter, lowercased ones —
 * because the image is a legal artefact and cannot say less than what the
 * household actually read; a label changed in one file and not the other
 * would then put one wording on the tab and a different one on that
 * artefact. One module, every importer (docs/SPEC/OWNERSHIP.md: a thing two
 * modules share moves and both import it).
 *
 * `Record<ConsentPurpose, string>`, not `Record<string, string>`: the
 * narrower type is what makes the compiler refuse a build that adds an
 * eighth purpose without a label for it, which is worth more than the
 * `?? purpose` fallbacks at every call site look — kept anyway, since every
 * one of those sits behind either this exhaustiveness or a value already
 * typed `ConsentPurpose`/`RequiredConsentPurpose`, so they cost nothing and
 * still stand between a stray untyped read and a raw enum key rendered onto
 * a household's screen or filed signature.
 */
export const PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  participation: 'Participation',
  minor_participation: "Guardian's consent for a child",
  home_visit: 'Visits at home',
  health_data: 'Brain-map and neurofeedback information',
  photo_video: 'Photographs and video',
  research: 'Research',
  marketing: 'Marketing',
};
