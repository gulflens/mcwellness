# client-portal-06 — the shared-zone changes the announcements block needs

**Status.** For the integrator, 2026-10-06. Round 72 (`round-72/announcements`) builds step 2 of the push memo (`docs/OPERATOR/2026-09-17-push-notifications.md`, decision 4, answered "as recommended" on 6 October 2026) and drafts step 1's wording. Everything below is outside the client-portal stream's own paths and rides in the round's own pull request, as trunk round 52 carried the review line's (`docs/CHANGE-REQUESTS/trunk-round-52.md`). Each edit is additive and breaks no caller.

**What, and why.**

1. `domain/shared/actor.ts` and its test: `portal.announcement.write`, for the owner and an admin — decision 3's "written by you or an admin, in Settings". The routes, the screen guard and the policy all ask it.
2. `domain/shared/audit-narrative.ts` and its test: the entity word `announcement` and four sentences in both languages (published, a correction published, withdrawn, read). An announcement names no client, so these read only on the practice's own feed.
3. `app/shell/App.tsx` and `App.test.tsx`, `app/shell/adminAccess.ts` (`canOpenAnnouncements`), `app/shell/AdminLayout.tsx` and `AdminLayout.test.ts`, `app/shell/components/Rail.tsx`: the route `/admin/settings/announcements`, lazily loaded, behind `canOpenAnnouncements`; the rail's Settings family lists it for the owner and an admin, and the test that pins the family says so.
4. `app/admin/settings/SettingsNav.tsx`: the strip's fourth link, "Announcements", for the same audience. The screen itself is the portal stream's (`app/admin/portal/AnnouncementsPage.tsx`), as Settings › Portal's is.
5. `tests/lint/console-is-english.test.ts`: `app/admin/portal/AnnouncementArabic.tsx` joins the allow-list. It is the one file of the screen that marks a box and a preview as Arabic, the precedent of `ArabicVersionField.tsx` (`docs/CHANGE-REQUESTS/reports-02.md`, request 5): every label around it stays English.
6. `docs/SPEC/00-data-model.md`: `announcement` joins section 3 beside `portal_review_prompt`, as round 52 added that table.
7. `docs/CONSENT/drafts/marketing.en.md` and `marketing.ar.md` (new): the marketing consent wording, **DRAFT for the practice's approval**, written from decision 3's rules. In a `drafts/` folder rather than beside the four wordings, deliberately: `db/seed/consent-text.ts` files every top-level `.md` in `docs/CONSENT` as a wording, `db/seed/consent-text.test.ts` pins that no `marketing` wording is offered, and a draft must not be filed or shown before it is approved. On approval the practice's word moves them up one folder with `status: approved`, the two pinned tests gain the purpose, and the portal switch (step 3) is built against them. `docs/CONSENT/README.md` is not edited.

**Not here.** The portal switch for the marketing consent, web push, the vendor row and the Send screen (the memo's steps 3 to 5). No core migration and no core policy: migration 705 sits in the portal's own range and its policies in `db/policies/portal/`.

**Spec.** `docs/SPEC/client-portal.md` sections 3.1, 3.10, 4, 5 (rule 10), 6.5, 6.7, 7 and 9, amended 2026-10-06.
