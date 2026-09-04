# The simple wording

Written 4 September 2026 at the operator's direction: the practice is a very
small starter business, will not be engaging a lawyer for now, and wants every
client-facing document short, plain and free of small print. These four pages
replace the long drafts in the folder above once the founder has reviewed
them. They are written for a household to read in two minutes, not for a
court. Nothing here is offered as legal advice; the founder decides what she
is comfortable putting her name to.

| Page | What it is | Replaces |
|---|---|---|
| for-review.md | Five things the founder decides, one page | nothing; it is the covering note |
| agreement.md | The one agreement a client signs, with a box for photographs and a section for a child | participation, minor-participation, home-visit and photo-video |
| your-information.md | How the practice looks after personal information, half a page | section 6 of the old participation draft |
| bookings-and-packages.md | Notice, late cancellation, packages and refunds, half a page | the "practice's terms" the old draft referred to |

Arabic versions follow once the founder has approved the English, so that the
words are translated once.

When approved: the agreement becomes consent wording version 0.2 in
`db/seed/consent-text.ts` (purposes `participation`, `minor_participation`,
`home_visit` and `photo_video` all point at the same page, with the photograph
box and the child section as the difference), the seed is re-rendered, the
bytes are re-uploaded to the staging bucket with
`scripts/upload-consent-wording.mjs`, and the long drafts are marked
superseded rather than deleted, because consents already recorded name them.
