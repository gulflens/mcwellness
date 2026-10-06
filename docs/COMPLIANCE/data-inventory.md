# Data inventory — the categories of personal data the practice holds

What this file is: one entry per **category** of personal data, saying what is
held, why each field is needed, who may read it, what the audit trail keeps
about it, and how it is removed. The register beside it
(`approved-vendors.md`) is of the services that can receive data; this one is of
the data itself.

Begun on 22 September 2026 with the one category below, which trunk round 58
created. **The household categories are owed here and are not written yet.**
They are described today in `docs/SPEC/client-record.md` (what a client record
holds, field by field, and what erasure does to each) and in `docs/SECURITY.md`
(who may read which of them, at the row), and until they are moved here those
two files are the record. A category described in neither is a category nobody
decided on, which is the thing this file exists to prevent.

---

## What the practice keeps about its own staff

**Added:** 22 September 2026 (trunk round 58,
`docs/CHANGE-REQUESTS/trunk-round-58.md`). **Where it lives:** `staff_profile`
(migration `922`), one row per member of staff, beside the sign-in row in
`app_user` that every screen already reads a name from.

### What is held, and why each field is needed

| Field | Why the practice needs it |
|---|---|
| **Job title** | What the person does, on the list and on their own profile, so that a practice of several people can be read at a glance and a role switch can be checked against what somebody was hired to do. |
| **Start date** | How long they have worked here: the date every employment question is answered from — notice, leave entitlement, a pay review's anniversary, and a gratuity calculation when they leave. |
| **Emergency contact: a name** | Who to call if something happens to somebody working alone in a household's home. |
| **Emergency contact: a telephone number** | The same, and the number is the usable half of it. In E.164, as every number on this platform is. |
| **The owners' notes** | Contract terms and reminders about that person's employment, in one place rather than in an inbox. **Nothing about health**, which the field says beneath itself on the screen, because that is minimisation done where the typing happens. |

Nothing else about a member of staff is held here. Salary, pay reviews,
payslips and staff documents were asked for by the operator on 21 September 2026
and are deliberately **not** built: they are pieces B and C of that design, each
with its own decisions, and neither has a column on this table.

### The emergency contact is a third person's data

It is a name and a telephone number belonging to somebody who is neither a
member of staff nor a client, entered by the practice about its own staff, for
the safety of somebody working alone in a household's home. That is the whole
purpose, and there is no other use of it: it is not contacted for anything else,
it reaches no vendor, and it appears on no other screen.

**It is removed by editing the field to empty.** A saved empty box writes
nothing recorded — `null`, not a blank string — so the field is genuinely gone
from the row. Nothing removes it on a timer, as nothing on this platform deletes
on a timer (CLAUDE.md rule 8), and nothing else removes it: a member of staff
who wants a different contact named, or none, asks and it is edited.

### Who may read it

**The owners, and nobody else.** Not an admin, not the lead practitioner, and
not the person the row is about. That is the row rule and not only the screen's:
`db/policies/core/staff_profile.sql` is one restrictive policy, for every verb,
admitting an owner alone, with the tenant fence beneath it. One owner reads the
other owner's profile; one owner may not *save* the other's, which is the API's
own narrower rule.

The person themselves is excluded deliberately, and it is the operator's
decision of 21 September 2026: a note about somebody that they can read is a
different thing from the one he asked for. That is a decision about a screen,
not about the law — see the last section.

### What the trail keeps

**That a field changed, and never what it said.** Migration `967` drops all five
of this table's own columns from `app.audit_redact`'s list, so
`audit_log.old_values` and `new_values` hold none of them. What the trail does
hold is that the row was inserted or updated, by whom, when, with what reason,
and — through `changed_fields`, which is computed from the raw rows before the
redaction runs — which of the five moved.

All five, and not only the three that read as private. The audit trail is
readable by an owner, an admin **and** the lead practitioner, and the activity
feed answers old and new values for every kind of row it is asked about: a job
title and a start date left in the trail would have reached two people this
table exists to keep them from. The reason it matters more here than elsewhere
is that the trail is append-only, is kept a minimum of five years, and is
reached by no erasure — so a value written into it outlives the row it was
copied from, and outlives the person leaving.

Reading a profile is itself recorded: opening one writes a read of the person
and a read of the profile row, so the question "who has looked at this" has an
answer and not only the question "who may".

### Private on the screen is not private in law

A member of staff has the same right of access and correction as anybody else
the practice holds data about (the PDPL). **A request from them reaches these
notes.** "Only the owners can see it" is a statement about who the software
shows it to; it is not a reason to withhold it from the person it is about when
they ask, and it is not a reason to write anything here that could not be read
out to them.

The field says so beneath itself, in these words: "Contract terms and reminders.
Nothing about health. The person may ask to see what is written here."

### Retention

As everywhere on this platform: kept while it is needed, a minimum of five years
after the person's last activity for anything a financial or employment record
depends on, and nothing deletes on a timer. An emergency contact is the one
field with a shorter natural life than the rest — it stops being needed the day
the person stops working alone in households' homes — and it is removed by the
edit described above rather than by a rule.

---

## Reviews sent from the website

**Added:** 6 October 2026 (`docs/SPEC/testimonials.md`). **Where it lives:**
`testimonial` (migration `978`), one row per review sent from the website's
Testimonials page in English or Arabic.

### What is held, and why each field is needed

| Field | Why the practice needs it |
|---|---|
| **The name to show** | The name the person chose to be published under ("Hazel H."), as they typed it. A review is shown with a name; the person picks how much of theirs. |
| **The context line** (optional) | A line under the name they chose to add, such as a job or a place. Published. |
| **The rating and the review** | What is published, once approved. Never edited by the practice. |
| **The language** | Which of the two pages it came from, so it is shown on that page. |
| **The tick to publish** | The basis for holding and publishing it at all; a review without it is refused. |
| **The decision** | Pending, approved or declined, who on the practice's side decided and when, and where it stands on the page. |
| **An address hash** | A keyed hash (HMAC-SHA-256) of the sender's internet address, under a random key the application's own role cannot read, made inside the database for the submission budget that stops one sender flooding the queue. Never the address itself; cleared the moment the review is decided, and in any case after 24 hours. |

**Deliberately not held:** an email address, a telephone number, a full name, or
any link to a client record. The practice publishes a review or it does not and
never replies to one, so it needs no way to reach the person. The door refuses a
telephone number or an email address typed into any of the published fields,
because whatever is typed there would be published.

### Who may read it

**The owner and an admin.** Row rule `db/policies/testimonial/readers.sql`, with
the tenant fence beneath it. Approved reviews are public by design, through the
website, in four fields: the name to show, the context line, the rating and the
review — no id and no date.

### What the trail keeps

**Who read and who decided, never what was written.** The table is outside the
audit trigger by decision (its comment begins `unaudited by decision`), for the
same reason as `enquiry`: the trigger would copy the review into the append-only
log, and a withdrawn review would then outlive its withdrawal there. The routes
log each read of the list as a read of each review on it, and each approve,
decline, withdraw and move under the person, by id.

### Retention

| State | Kept |
|---|---|
| Pending | 180 days after it arrived, then deleted |
| Declined or withdrawn | 30 days after the decision, then deleted |
| Approved | While it is published |

Deleted once a day by the in-process scheduler (`app.purge_stale_testimonials`).
This is a timer, unlike everywhere else on this platform, because a review is not
a client record: CLAUDE.md rule 8 is the household record's floor, and once the
office has said no there is no purpose left in keeping somebody's words.

### A person's request

**To have theirs taken down:** Withdraw on the Reviews screen. It leaves the
website within a minute and is deleted within 30 days. The person identifies it by the
name they used and what they wrote; nothing else is held to match on.
**To see what is held:** the row is the whole of it, and the office can read it
out from the Reviews screen.

### Who else receives it

Nobody new. It passes through the app at Hostinger and is stored in the practice
system's database at Supabase, both already in `approved-vendors.md`, and once
approved it is published on the practice's own website. The website's privacy policy should say so in both
languages; as of 6 October 2026 it does not mention reviews.
