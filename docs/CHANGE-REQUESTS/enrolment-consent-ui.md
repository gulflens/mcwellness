# Enrolment and consent UI redesign

The operator requested a redesign of the main app's navigation and client management on 24 September 2026, identifying client enrolment and consent signing as the hardest workflows. This isolated branch implements that cross-surface request across client-record screens and the shared shell. It starts at a4b9cdc6 in `ui/enrolment-consent-redesign`; the invoice work in the team checkout is untouched.

## Scope

- Group the existing permitted navigation destinations into Daily work, Finance and Practice.
- Give enrolment a wider default, persistent step guide, grouped identity/contact fields, step-specific instructions and descriptive next buttons.
- Preserve shared drawer resizing and remembered widths. Adapt the step guide to the drawer's container width, including manually narrowed desktop drawers.
- Keep activation requirements available in a disclosure while making the current step the main task.
- Separate consent into signer, agreements and signature sections. Preserve all exact wording and bundle rules.
- Reset drawn and scanned evidence, signer name and reading progress when the consenting contact changes.

The shared-zone files are `app/shell/components/Rail.tsx`, `app/shell/AdminLayout.tsx`, `app/shell/components/DrawerResizeHandle.tsx`, `app/shell/shell.css` and `app/shell/tokens.css`. The other changes are client-record UI, its regression tests, and design documentation. No API, domain, database or policy change.

## Verification

Synthetic preview at `.impeccable/review/preview.html` uses actual components with an in-memory fetch implementation, and does not talk to production. Desktop 1100px and phone 390px views were inspected together, including the signature section. Reading by keyboard unlocked signing; the resize control changed enrolment from 920px to 888px without horizontal overflow. The reviewer found and confirmed fixes for resize-handle integration and native scan-input reset.

The preview does not constitute a live-backend end-to-end enrolment or consent test. No production consent was signed. No deployment, merge or commit is included.
