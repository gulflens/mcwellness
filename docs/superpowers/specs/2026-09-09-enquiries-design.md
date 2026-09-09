# Enquiries: the practice system's first public write path

**Date:** 9 September 2026, 23:40. **Status:** design settled by the operator; building.

## Why

The public website's two enquiry forms post to `lodge_enquiry` on the retiring
Supabase project `gqvpapvdqcfjlifgwhpk`, and the practice system has nowhere to
receive them. Until it does, that project cannot be paused without silently
losing every enquiry. This round gives the practice system its own door and
retires the dependency.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| What an enquiry becomes | A **lead** — a client with status `lead` | operator, 22:34 |
| Who sees enquiries | admin and lead practitioner (and the owner) | operator, 22:34 |
| How long they are kept | until actioned — converted or dismissed | operator, 22:34 |
| Where it lands | a **quarantine table**, never straight into `client` | Claude, agreed |
| The audit actor | **Option B**: outside the trail until a person touches it; *Convert to lead* is its first audited event | operator, 23:01 |
| Lawyers | none; the client's own approval is final | operator, 23:34 |

## The one design call this spec makes

**The public endpoint is the practice system's own API** —
`POST https://app.mcwellnessuae.com/api/enquiries` — not a Supabase edge
function. One codebase; the rules are pure TypeScript in `domain/enquiry` with
tests; the service key never leaves the server; reviewers can read it. The old
Deno function is the reference for what the forms send, not the template. It
follows the portal's invitation door exactly: mounted **ahead of the
authentication fence**, with its own rate-limit budget by address, opening its
own transaction and stamping only the request id.

## Shape

**`enquiry`** (migration 916, trunk core range). A row per lodging: `source`
(`website` | `discovery_call`), the person's name and WhatsApp number in E.164,
optional email, area, message, and the discovery-call form's `concern`,
`preferred_time`, `contact_method`; a three-valued `consent`; `ip_hash` for the
throttle; `status` `new` → `converted` | `dismissed`; `actioned_at`,
`actioned_by`, `client_id` (set on conversion), `dismiss_reason`.

**Lodging** is a `security definer` function, `app.lodge_enquiry(jsonb)`, the
only way a row gets in: it resolves the practice's one tenant, refuses more than
five lodgings from one address in ten minutes (answering exactly as it answers
success — a form that says "rate limited" tells a script what to change), and
inserts. `app_role` has no insert policy on the table.

**Actioning** is authenticated and audited. *Convert to lead* creates the client
(status `lead`) and its first contact from the enquiry, links `client_id`, and
scrubs the enquiry's personal fields. *Dismiss* takes a reason and scrubs the
same. Reading the list is a read of personal data by a person and is logged as
one. **What is scrubbed:** name, number, email, area, message, concern,
preferred time, contact method, ip hash. What stays: when, from which form,
what happened, who did it, which client.

**Option B, as columns.** The row carries no `created_by`: nobody made it. The
audit trigger is **not** attached, and `.claude/rules/data-model.md`'s
exemption list says so and why. The client row the conversion creates is
audited from its first byte, under the person who pressed the button.

**The screen.** `/admin/enquiries`: a table, newest unactioned first — received,
name, number, source, the first line of the message, status — with *Convert to
lead* and *Dismiss* on each `new` row, and a link to the client once converted.
English only, like the rest of the console. In the rail for owner, admin and
lead practitioner.

**The website.** Twenty-two pages carry the inline script; its `ENDPOINT`
becomes the practice system's door. The script already sends form-encoded by
`sendBeacon`, which is a simple request with no preflight; the door accepts
form-encoded and JSON, answers CORS for the apex and `www`, and 204s OPTIONS.

## Not in this round

Pausing the old project — reported as safe once the repoint is verified live,
and left to the operator. A retention job for unactioned enquiries: the rule is
"until actioned", by decision. Erasure: a converted enquiry holds no personal
data, so erasing the client leaves nothing behind it.

## Risks stated

- First public write path. The fence, the budget, the honeypot and the definer
  function are the whole defence; the door validates and clamps every field and
  writes nothing on a bot's submission.
- Bots that pass the honeypot land as `new` rows for a person to dismiss. That
  is the quarantine doing its job.
