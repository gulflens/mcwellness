# Full-page client workspace

Approved by the operator on 24 September 2026: main client records and enrolment use the full admin content area, with section navigation on the left, a spacious consent surface and a return to the preserved client list. This supersedes the drawer treatment for these two workflows in the earlier enrolment and consent refinement.

## Scope

- Render main records and enrolment as in-flow pages within the existing admin shell; retain other focused task drawers.
- Use vertical section navigation on desktop and a labelled section select in narrow containers.
- Put only the opaque client ID and selected section in the record URL. Support direct loading and reload; replace section history entries so browser Back returns to the list.
- Preserve list search, filters, focus and scroll in memory while the page remains mounted. Do not put list search terms in the browser URL or promise their persistence after reload.
- Keep existing role restrictions, record fetching, consent wording, evidence gates, APIs and persistence rules. Escape no longer exits these full-page workflows.

## Evidence

The actual `AdminLayout` with synthetic records was reviewed at 1100px and 390px. Captures: `.impeccable/review/workspace-consent.png`, `.impeccable/review/workspace-signing.png`, `.impeccable/review/workspace-enrolment.png`. The independent reviewer disposition was ship for the bounded scope; 35 focused tests passed. The full suite was running when this note was written, so no full-suite result is asserted here.

See `docs/SPEC/enrolment-consent-ui.md` for the resulting behaviour and limitations. No live consent signing, deployment, merge or commit is implied by the review.

Final local verification: 264 test files / 3,184 tests passed, TypeScript and lint passed, production build succeeded, and secret/migration audits passed. The independent reviewer also approved the additional 633px user viewport. Shared tab styling remains in the always-loaded shell stylesheet.
