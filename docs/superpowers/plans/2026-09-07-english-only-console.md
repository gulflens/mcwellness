# Trunk round 35: the console and the practitioner app are English only

**Decision (operator, 7 September 2026, 19:37 Dubai):** "everything in
app.mcwellnessuae.com should be English only, no need to show the Arabic
fields; Arabic is made only to communicate with clients. Anything facing the
client can be bilingual, but the admin and staff side of the business will be
English only."

This closes item 4 of docs/DESIGN-BRIEF.md section 10 ("Arabic scope for v1"):
an English product for staff, with bilingual client-facing surfaces (the
portal, invoices, receipts, reports, consent wording, the erasure letter and
the messages the practice sends).

## What this round does

Remove every Arabic display and every Arabic input from the staff screens —
`app/admin/**` and `app/therapist/**` — and nothing else. **No API, schema,
policy, seed, or data change.** The server keeps storing and serving the
Arabic columns; the portal and the documents keep rendering them; production
already holds an Arabic legal name, one client's Arabic name, three package
names and five service names, and all of that stays exactly where it is.

Work in the worktree you are given, on a new branch `trunk-round-35` from
`main`. Copy this brief into the repository as
`docs/superpowers/plans/2026-09-07-english-only-console.md` in your first
commit, so the record can cite it.

## Rules that apply

- Read `CLAUDE.md` first. Rule 10 (ownership) is satisfied by the trunk-round
  convention: this round edits several streams' paths and lists every file in
  `docs/CHANGE-REQUESTS/trunk-notes.md` (see below).
- Test first where a test changes behaviour: for the guard test, write it,
  watch it fail on `main`'s code, then make the removals until it passes.
- **Timeouts.** Run every `pnpm` command through the Bash tool with an explicit
  `timeout` (600000 ms for `pnpm verify` and `pnpm build`). Run single test
  files while iterating: `pnpm vitest run <path>`. Never run a silent
  ten-minute command without a timeout — that is what stalled an earlier
  builder.
- Small, single-purpose commits, conventional messages, each ending with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Do not touch `app/client/**`, `app/api/**`, `domain/**`, `db/**`,
  `app/shell/main.tsx` (its Arabic font import serves the portal and the
  consent wording), or any `*.ar.md` under `docs/CONSENT`.
- No new hex literals, no ALL-CAPS labels, no new colour (docs/DESIGN-BRIEF.md).

## The removals, file by file

Line numbers are from `main` at `4fa63f8`; read each region before editing.
Where a comment explained the Arabic rendering rule, replace it with one short
sentence: "The console is English only (operator's decision of 7 September
2026, docs/DESIGN-BRIEF.md section 10 item 4); the Arabic name stays on the
wire for the portal and the documents." Do not leave comments that describe
code that is gone.

### Displays (read-only Arabic beneath English)

1. `app/admin/clients/ClientDrawer.tsx` 108–115: the Arabic name paragraph
   under the heading, and its comment.
2. `app/admin/clients/ClientsPage.tsx` 175–179: the `name__ar` span in the
   Name cell.
3. `app/admin/clients/ContactsTab.tsx` 5 and 77: the `ContactNameAr` import
   and element.
4. `app/admin/clients/contactName.tsx` 27–52: delete `contactNameAr` and
   `ContactNameAr` entirely (ContactsTab is their only importer — grep to
   confirm). Keep `contactName` and `RELATIONSHIP_LABELS`.
5. `app/admin/schedule/WeekPage.tsx` 175–185: the Arabic name span and its
   comment.
6. `app/admin/schedule/ScheduleClientDrawer.tsx` 45–49: the Arabic name
   paragraph; amend the doc comment at line 13 ("id, name, Arabic name") to
   say the Arabic name travels but is not shown.
7. `app/admin/schedule/SchedulePage.tsx` 189–190 and 203–207: the comment's
   "the Arabic name beneath it" and the `name__ar` span.
8. `app/admin/billing/BalancesSection.tsx` 112–116: the `name__ar` span.
9. `app/admin/billing/BillingPage.tsx` 133–137: the `name__ar` span.
10. `app/admin/billing/PackagesSection.tsx` 81–85: the `name__ar` span.
11. `app/admin/settings/PracticePage.tsx` 204–210: the whole "Legal name in
    Arabic" Fact.
12. `app/admin/assessments/Comparison.tsx` 126–129: keep the English sentence,
    remove the Arabic `<p lang="ar" dir="rtl">`. Then in
    `app/admin/assessments/copy.ts` 11–19 amend the doc comment: the sentence
    sits on the screen in English; both halves go on anything printed from it
    (`tests/reports/document.test.ts` still proves the printed pair equals this
    constant, so **keep the `ar` key and its value unchanged**).
13. `app/therapist/session/CheckInPage.tsx` 358–359 and 663–673: delete
    `selectedServiceNameAr` and the paragraph that renders it, with its comment.
14. `app/therapist/session/SummaryStep.tsx` 104–108: the `summary__label-ar`
    span.
15. `app/therapist/session/Slider.tsx` 30–34: the `rating__label-ar` span;
    rewrite the doc comment at 3–12 (it currently says the runner "had been
    dropping" the Arabic; now it drops it on purpose). Leave line 69's
    `labelAr: ''` alone — the `RatingQuestion` type still carries the field.
16. `app/therapist/session/PreflightStep.tsx` 146–150: the `check__label-ar`
    span.
17. `app/therapist/today/TodayPage.tsx` 388–390 and 403–407: `arabicName` and
    the `stop__name-ar` span; amend the comment at 228 if it still refers to an
    Arabic name beside the window.
18. `app/therapist/session/SessionRunner.css` 140–147: delete the three
    `-ar` rules and their comment. (`name__ar` and `stop__name-ar` have no CSS
    rule anywhere — grep to confirm — so nothing else to delete.)

### Inputs (Arabic fields in staff forms)

19. `app/admin/clients/EnrolmentWizard.tsx`: state at 113–114, the two body
    spreads at 201–202, the two `Field`s at 390–405. The wizard sends no
    Arabic name at all afterwards.
20. `app/admin/clients/ContactForm.tsx`: state at 92–93, the `names` object at
    186 (drop the two Arabic keys), the `field-row` at 279–296 (delete the
    whole row). **Editing an existing contact must not erase an Arabic name
    that is already on the record:** the create path omits the keys; on the
    edit path the PATCH body must simply not mention `givenNameAr` /
    `familyNameAr` (the API's PATCH treats an absent key as "leave alone" —
    verify in `app/api/clients/contacts.ts` and say in the commit message
    which line proves it).
21. `app/admin/settings/PracticeDrawer.tsx`: state at 99, the body key at 208,
    the `Field` at 296–305. **The practice's PATCH sends the whole form at once**
    (docs/SPEC/00-data-model.md, round 20: "the whole form travels at once");
    read `app/api/practice/routes.ts` 150–200 and `app/api/practice/schema.ts`
    to see whether `legalNameAr` is required in the body. If it is required,
    keep sending the value the drawer loaded (`practice.legalNameAr ?? null`)
    from a constant, not from an input, so a save never blanks the Arabic
    legal name that is on production's invoices. If it is optional and absent
    means "leave alone", omit it. Say which in the commit message.
22. `app/admin/billing/PackageDrawer.tsx`: state at 77, the body key at 173
    (send `nameAr: null` only if the schema requires the key; otherwise omit —
    check `app/api/billing/schema.ts`), the `Field` at 245–254.

### Tests

23. `app/admin/assessments/AssessmentsTab.test.tsx` 339–346: the test "carries
    the fixed sentence in English and Arabic" becomes "carries the fixed
    sentence in English, and nothing in Arabic": the English text is present;
    `screen.queryByText(NOT_A_DIAGNOSIS.ar)` is null.
24. Add tests where a form's request body is asserted, if one exists for the
    enrolment wizard, contact form, practice drawer or package drawer, so the
    body's shape after this round is pinned (grep each `*.test.tsx` for
    `JSON.parse` or `body`). If none asserts the body today, add one assertion
    to the closest existing test rather than a new file.
25. **The guard:** `tests/lint/console-is-english.test.ts`, in the style of
    `tests/lint/no-hex-colour.test.ts` (read it first). Walk every `.tsx` and
    `.ts` file under `app/admin` and `app/therapist` (not tests) and fail on
    any of: `lang="ar"`, `lang: 'ar'`, `dir="rtl"`, `dir: 'rtl'`. One
    allowlist entry, with the reason in a comment beside it:
    `app/admin/clients/RecordConsentForm.tsx` — the consent wording is the
    household's text, read and signed in its own language on the practice's
    screen. Assert at least forty files were visited, so an empty walk cannot
    pass. Write this test first; it must fail before the removals and pass
    after. Do not add `app/shell` to the walk (the Arabic font import is
    deliberate).
26. Existing fixtures that carry Arabic names (`ClientDrawer.test.tsx`,
    `EnrolmentWizard.test.tsx`, `ContactForm.test.tsx`, `RecordTabs.test.tsx`)
    stay as they are: they prove Arabic data on the wire breaks nothing.

### Documents

27. `docs/DESIGN-BRIEF.md` section 10 item 4: append one sentence in the
    section's own voice: "Decided 7 September 2026: the staff screens (the
    console and the practitioner app) are English only; every client-facing
    surface — the portal, invoices and receipts, reports, consent wording, the
    erasure letter and the messages the practice sends — stays bilingual."
    Section 4.1 stays: the typeface decision still governs the portal and the
    documents.
28. `docs/SPEC/assessment.md` section 3.3: "One fixed sentence sits on the
    screen in English, and in English and Arabic on anything printed from it".
29. `docs/CHANGE-REQUESTS/trunk-notes.md`: append "## Round 35, 2026-09-07
    (the console is English only)" in the shape of round 34's entry but far
    shorter: the decision, what changed, **every file this round touched
    outside the trunk's own paths grouped by stream** (client-record,
    scheduling, billing, assessment, session-capture), "no migration and no
    policy file", and a "What the streams should know" line per stream: the
    Arabic columns and the API contract are unchanged; a screen that wants to
    show Arabic again is a decision, not a fix.
30. `docs/HANDOVER.md`: update the opening paragraph's date/time and add a
    step to section 10 recording round 35 (pull request number to be filled by
    the integrator — write "pull request (number to follow)").

## Finish

- `pnpm vitest run tests/lint/console-is-english.test.ts` green; the changed
  screens' own test files green individually; then `pnpm verify` with a
  600000 ms timeout, then `pnpm build` the same way.
- `git push -u origin trunk-round-35` and open the pull request with `gh pr
  create --base main --title "Trunk round 35: the console is English only"`;
  the body in plain language for a non-developer: what changed, what did not
  (the portal and the documents), the one consequence (the Arabic legal name
  and package names can no longer be edited in the app), the checks run, and
  the files touched outside the trunk's paths. End the body with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Report back in at most fifteen lines: the pull-request number and URL, the
  head commit, the results of `pnpm verify` and `pnpm build`, any deviation
  from this brief with the reason, and your approximate token use.
