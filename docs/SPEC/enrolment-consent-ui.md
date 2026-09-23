# Enrolment and consent UI

Status: implemented bounded refinement, 24 September 2026.

## Purpose and scope

Make the console navigation easier to scan and make client enrolment and consent signing easier to follow. The implementation preserves McWellness's established visual world: IBM Plex typography, violet navigation and action language, token-based spacing, hairlines, structured forms and plain British English. It does not introduce new workflows, consent wording, endpoints or authorisation rules.

## Navigation

The rail divides permitted destinations into three labelled lists. It filters the existing section array, so the current visible order, before permission filtering, is:

| Group      | Destination order                   |
| ---------- | ----------------------------------- |
| Daily work | Clients, Enquiries, Schedule, Today |
| Finance    | Billing, Books                      |
| Practice   | Audit, Settings, Portal, Kit        |

Empty groups are omitted. Existing links, active states, child pages and role filtering remain in force. Group labels use the existing compact-rail hidden-label treatment; lists have accessible names. The labels do not create new routes.

## Enrolment workspace

The drawer defaults to `min(920px, 90vw)`, using `--enrolment-width`. The existing shared remembered drawer width overrides this through `--drawer-resized`; enrolment does not have an independent stored width preference. Resizing and restoring a width set both the existing drawer value and the new override.

A 176px progress column (`--enrolment-progress`) sits beside the current form. The steps remain Identity, Contacts, Location, Goals, Consent, Health and Review. Reached steps retain their existing navigation behaviour; unreached steps remain unavailable. Each content view adds a title, step count and short instruction. Identity uses paired fields where there is room and separates client details from contact details.

At an enrolment container width of 767px or less, progress becomes a four-column grid, step numbers disappear and fields become one column. This uses a container query so a manually narrowed desktop drawer also adapts. At viewport widths below 768px the drawer is full width. These are layout rules, not a claim of complete device or browser coverage.

After a lead exists, the later non-review steps expose the existing activation summary through an expandable “View what is still needed to activate” area, or “Ready to activate” when complete. Review keeps the requirements visible and retains the existing activation gate. Creating the lead, saving subsequent sections and finishing later retain the existing persistence behaviour; no new autosave or draft system is added.

## Consent signing

When the combined signing form is closed, the Consent tab shows how many required purposes have an active consent on file. A lavender (`--brand-wash`) introduction offers “Select consents and sign once” to permitted writers on non-erased records. The action remains available when all required consents are already active, so staff can record renewals. Each agreement retains its own history.

The combined form starts with a prominent “Select all” checkbox and an individual agreement checklist on the same lavender surface. All eligible purposes are selected initially: four for a child, three for an adult, using the existing required-purpose rules. The select-all checkbox shows a mixed state for a partial selection. A live count reports how many agreements are selected; an empty selection cannot be recorded. Checkbox labels provide at least 44px-high targets, use violet controls and visible keyboard focus, and adapt to one column in narrow space. IBM Plex typography and existing spacing and shape tokens are retained.

The form then presents three numbered sections:

1. Confirm who is signing, using contacts eligible to give every selected consent.
2. Read the selected agreements, with the selected purpose list before the versioned wording and a status line describing the reading gate.
3. Sign once for the selected agreements, using the existing on-screen or photographed/scanned paper method.

The wording remains in a keyboard-focusable scroll region. Existing Arabic language and direction attributes are retained. Signature and upload controls remain disabled until the reading check passes and at least one agreement is selected. Reaching the end is a UI prerequisite, not proof of comprehension. Selection, signer and evidence-method controls are disabled while recording.

Changing the selection or signer clears the signature, selected scan, scan messages and reading state. The reading region, signature pad and file input are keyed to both signer and selection, so previous scroll position and visible evidence do not carry over. Either change invalidates pending scan preparation: a late compression result cannot restore evidence for the previous signer or selection. Changing the signer also clears the typed-name override, allowing existing name derivation to apply to the newly selected signer. The signer must remain eligible for the current selection before submission.

The existing bundle endpoint receives only the selected purposes and their displayed wording version IDs, with one shared signature or scan. Each consent is saved separately with the same evidence; the confirmation and record action reflect the selected count. Actual consent text, version handling, scan processing, purpose-specific eligibility and backend checks remain unchanged. This work does not add remote signing or a new consent policy.

## Implementation and evidence

The implementation is in `app/shell/components/Rail.tsx`, `app/shell/shell.css`, `app/shell/tokens.css`, the shared drawer resize handling, and `app/admin/clients/EnrolmentWizard.tsx`, `ConsentTab.tsx`, `SignAllForm.tsx` and `clients.css`.

Review captures are stored at:

- `.impeccable/review/enrolment-desktop-mobile.png`
- `.impeccable/review/signature-desktop-mobile.png`
- `.impeccable/review/user-viewport.png` (633px viewport)

The bounded review addressed narrow-container enrolment layout and signer-change evidence/reading reset. Screenshots record the captured states; they do not establish that every role, validation outcome, locale or device has been exercised. Existing domain and API behaviour remains the source of truth. This note does not imply user approval of the implementation.

Verification for this refinement passed: 265 test files and 3,196 tests, production build, format check, lint, TypeScript, secret audit and migration audit. The 633px viewport capture was inspected without visible horizontal overflow.

The subsequent consent-selection refinement was independently reviewed at 1100px desktop and 390px phone widths and visually passed. The full suite passed with 3,181 tests before the additional deferred-scan regression test; the focused form suite then passed all 10 tests, including pending scan invalidation. Production build, TypeScript and lint also passed. These checks cover this bounded change and do not imply exhaustive device or locale coverage.
