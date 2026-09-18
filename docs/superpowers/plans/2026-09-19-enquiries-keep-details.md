# Dismissed enquiries keep their details — plan (2026-09-19)

## The ask, and the two decisions

The operator, 19 September 2026, 03:11 +04: "dismissed enquiries need to keep
the data visible, i need to be able to have those details, may be i will
revisit those enquiries contacts or retarget them in my social media
campains".

This reverses the scrub of 9 September 2026
(`docs/superpowers/specs/2026-09-09-enquiries-design.md`, Option B). It could
not simply be switched on, for three reasons found before any code was
written:

1. **The expo form promises the opposite, in writing.** Under its tick:
   "We use your details to get back to you about this enquiry. If you go on to
   work with us they become part of your record; if not, once we have replied
   the enquiry keeps nothing personal."
2. **Retargeting is a purpose nobody was told of, and a vendor nobody
   approved.** It means handing numbers or addresses to Meta, TikTok or
   Google. The tick today agrees to contact "about your enquiry" and nothing
   else. `docs/COMPLIANCE/approved-vendors.md` lists none of them for it.
3. **The database enforces the scrub.** `enquiry_actioned_is_scrubbed`
   (migration 916, recreated in 919) forces every personal column null once
   `status <> 'new'`, and the update policy admits no change to a row already
   actioned.

Put to the operator at 03:13 +04, with the draft wording shown. Both answers
are the operator's:

- **Route: change the wording, and add an optional marketing tick.**
- **On dismiss: keep by default, erase on choice.**

## What is promised, and therefore what is kept

A row remembers which wording its person read. `notice_version` is set by the
door when the row is lodged and never changes.

| `notice_version` | What the person read | On dismissal |
| --- | --- | --- |
| 1 | "…once we have replied the enquiry keeps nothing personal." (every row to date; every form that does not say otherwise) | **Scrubbed, always**, as promised. The screen says so and offers no choice. |
| 2 | "…and we keep them so we can follow up with you later. You can ask us to delete them at any time." | **Kept**, unless the person dismissing chooses to erase. |

Consequences stated to the operator and not open to choice: what was already
dismissed is already scrubbed and cannot be recovered; a row lodged under
notice 1 is scrubbed on dismissal whatever the screen would prefer.

**A form that says nothing is notice 1.** So the website, which is a separate
codebase not under version control, keeps being scrubbed on dismissal until
its own wording and privacy page change and its forms say `notice: 2`. That is
a separate piece (below), and until it ships the safe thing happens by
default.

**Converted rows are scrubbed as before.** The person is on the client record
from that moment. The marketing tick does **not** travel to the client record
in this round: a client's consents are the versioned consent documents, and a
tick on an enquiry form is not one. Recorded as a known gap, the operator's to
ask for.

## The wording (the operator chose this draft)

Under the expo form, replacing the present paragraph:

> We use your details to get back to you about this enquiry, and we keep them
> so we can follow up with you later. You can ask us to delete them at any
> time. How we look after your information is set out in our privacy policy.

The existing tick, unchanged and still required:

> By submitting, you agree to be contacted by McWellness about your enquiry.

A second tick, **optional**, unticked by default:

> Keep me posted about McWellness news and offers, including on social media.

English only, as the form is, by the owner's decision of 16 September.

## Build order

Each step is test-first, and each leaves the gate green.

1. **Migration `921_enquiry_kept_details.sql`** (trunk range; 921 is free on
   `main` and on every open branch).
   - `notice_version smallint not null default 1 check (notice_version in (1, 2))`.
   - `marketing_opt_in boolean` — three-valued like `consent`: null is "never
     asked".
   - `enquiry_actioned_is_scrubbed` replaced by `enquiry_actioned_keeps_only_what_was_promised`:
     an actioned row is either scrubbed entire (as today, plus
     `marketing_opt_in is null`), **or** it is `dismissed`, `notice_version = 2`,
     still has its name and number, and has lost its `ip_hash` — the address
     hash has no follow-up purpose and goes either way.
   - Two triggers, because a policy's `with check` cannot see the old row:
     a dismissed row stays dismissed; a scrubbed row stays scrubbed.
   - `app.lodge_enquiry` recreated, same signature and grants, reading
     `notice_version` (anything but 2 is 1) and `marketing_opt_in`.
   - A `-- rollback:` block.
2. **Policy `db/policies/enquiry/writers.sql`**: the update policy also admits
   a dismissed row that stays dismissed — the erase. (Re-applied by hand on
   the hosted databases at the pass; policies are not migrations.)
3. **Domain**, pure, tests first: `parse.ts` reads `notice` and `marketing`;
   new `keep.ts` — `dismissalKeeps(noticeVersion, erase)`, `carriesAPerson(row)`,
   `isMarketable(row)`.
4. **API**: the door passes the two fields; `POST …/dismiss` takes
   `{ reason, erase? }` and answers what it did; `POST …/:id/erase` (new,
   `enquiry.erase` in `domain/shared/actor.ts`, audited as `erase`); the list
   logs a read for **every row that carries a person**, not only the waiting
   ones; `GET /api/enquiries/marketing.csv` — rows that ticked and still carry
   a person, logged as an export, the number guarded as text.
5. **The console**: the Dismissed table regains Name, WhatsApp, Email and
   Details for kept rows, says "Details erased" for scrubbed ones, and has
   "Erase details". The dismiss form offers keep or erase for a notice-2 row
   and says why it offers nothing for a notice-1 row. "Download marketing
   list", with the same keep-it-on-your-own-device note the expo file has.
6. **The expo form**: the new paragraph, the second tick, `notice: 2`.
7. **Documents**: the spec amended; `docs/SPEC/00-data-model.md` (the Enquiry
   section); `approved-vendors.md` — Meta, TikTok and Google custom audiences
   entered as **not approved**, so the register tells the truth the day the
   list exists; `trunk-round-54.md`.
8. **Reviews**: schema, security and compliance, all three, before merge.
9. **Staging pass, then production on the operator's word.** Databases first:
   921, its ledger row with the file's sha256, `writers.sql` re-applied, the
   fingerprint across three databases.

## Not in this round

- **The website.** Its forms (eleven English pages, their Arabic mirror, and
  `content/site-content.json`) carry the tick but not the promise; its privacy
  page says enquiry details are used to "Respond to your enquiries" and that
  the site uses no advertising cookies, and says nothing of keeping details
  or of marketing. It needs the new paragraph, the second tick, `notice: 2`
  in what it posts, and a privacy page that says details are kept, that news
  and offers go only to people who asked, and that those may be shown through
  social platforms. It is not under version control and deploys separately.
- Carrying the marketing tick onto a client's record at conversion.
- Any upload to a social platform. The app makes a file; what is done with it
  is the practice's own act, and the vendor register must say yes first.

## Rules this touches

Rule 5 (every read of personal data is logged): a kept dismissed row is such
a read, so the round-53 sentence "a page of dismissed rows logs nothing"
becomes "a page logs each row that carries a person". Rule 8 (nothing deletes
on a timer): unchanged; a kept row is kept until somebody erases it. Rule 9
(vendors): the register is updated in this round, as not approved. The PDPL's
purpose limitation is met by `notice_version`; its marketing consent by the
second tick; its right of erasure by "Erase details".
