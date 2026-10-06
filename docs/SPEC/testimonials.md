# Testimonials — the website's reviews

*Added 6 October 2026. Migration `978`, `app/api/testimonials/**`,
`app/admin/reviews/**`, `domain/testimonial/**`, `db/policies/testimonial/**`.*

## 1. Why

The website's Testimonials page (`/testimonials.html` and `/ar/testimonials.html`)
had a "Share Your Experience" form until 10 September 2026. Its backend was a
third-party project that stopped resolving, and the form was taken down. The
practice asked for it back. The page promises "Every testimonial is reviewed
before it appears here": a review is sent to the practice system, waits for the
office, and appears on the page only once approved.

The website is a static site on separate hosting and is changed separately. This
file is the contract it is built against (sections 7 and 8).

## 2. What is stored

One row per review, in `testimonial`:

| Field | Why |
|---|---|
| `display_name` | The name the person chose to be shown under ("Hazel H."), 1–40 characters. Published. |
| `context` | Optional line under the name ("HR Director, Dubai"), up to 60 characters. Published. |
| `rating` | 1–5 stars. Published. |
| `body` | What they wrote, 20–1200 characters. Published as written, never edited. |
| `language` | `en` or `ar`, the page it came from. It is shown on that page only. |
| `consent_to_publish` | The tick. Always true: the table refuses a row without it. |
| `status`, `decided_by`, `decided_at` | The office's decision and who made it. |
| `published_order` | Where the office placed it on the page. |
| `ip_hash` | SHA-256 of the sender's address under a fixed prefix, for the submission budget only. Cleared when the review is decided. |

**Nothing a person could be reached by.** There is no email, no telephone and
no name beyond the one they chose to be shown under. The practice publishes a
review or it does not, and never replies to one, so it needs none of them. The
door also refuses a telephone number or an email address typed into the name,
the context line or the review (`carriesContactDetails`,
`domain/testimonial/parse.ts`), because whatever is in those fields is
published.

**Never edited.** Neither the screen nor the database lets the practice change
what somebody wrote, the name they chose, or the stars (`app.testimonial_guard`).

## 3. Who sees it

The **owner and an admin**: they read the reviews, approve, decline, withdraw and
arrange them (`testimonial.list`, `testimonial.decide` in `domain/shared/actor.ts`;
`db/policies/testimonial/readers.sql` and `writers.sql` hold the same beneath).
The lead practitioner, who sees enquiries, does not. Nobody else on the practice's
side does.

The public sees approved reviews only, through section 8.

## 4. Order on the page

Approved reviews in one language are shown by their place (`published_order`,
1 first). A review approved since the list was last arranged has no place yet
and is shown **above** the placed ones, newest decision first, so the office
sees at once what it just approved and can move it down. Moving a review
renumbers that language's whole list from 1. At most 30 are sent.

## 5. The console: Reviews

`/admin/reviews`, on the rail after Enquiries, for the owner and an admin, with a
badge counting what is pending (`GET /api/testimonials/count`, which logs no
read). Three tabs:

- **Pending**: Approve, Decline.
- **Approved**: Move up, Move down (within the review's own language), Withdraw
  (asks first: "Take it off the website?"). Withdraw makes it declined at once.
- **Declined**: read only, with the note that it is deleted 30 days after the
  decision.

Staff routes (behind the fence): `GET /api/testimonials?status=pending|approved|declined`,
`GET /api/testimonials/count`, `POST /api/testimonials/:id/approve`, `…/decline`,
`…/withdraw`, `…/move` with `{"direction":"up"|"down"}`.

**The trail.** The table is outside the audit trigger, as `enquiry` is (migration
978 says why: a copy of the words in the append-only log would outlive a
withdrawal). The routes log each list read as a read of each review on it, and
each approve, decline, withdraw and move under the person, by id and never by
content.

## 6. Retention and removal

| State | Kept |
|---|---|
| Pending | 180 days after it arrived, then deleted |
| Declined (including withdrawn) | 30 days after the decision, then deleted |
| Approved | While it is on the page |

Deleted once a day by the scheduler (`testimonial-retention`,
`app/api/scheduler.ts`) through `app.purge_stale_testimonials`, which refuses a
cutoff sooner than either period. The periods are `domain/testimonial/retention.ts`.

**A person asking for theirs to be taken down** is met by Withdraw: it leaves the
website at once and is deleted within 30 days. They identify it by describing
what they wrote and the name they used; nothing else is held to match on. If
they ask for it to go sooner than 30 days, that is not offered by the screen
today; the database owner can delete the row.

## 7. Submitting a review: `POST /api/testimonials`

```
POST https://app.mcwellnessuae.com/api/testimonials
Origin: https://mcwellnessuae.com          (or https://www.mcwellnessuae.com)
Content-Type: application/json
```

```json
{
  "display_name": "Hazel H.",
  "context": "Parent, Dubai",
  "rating": 5,
  "body": "Twenty to twelve hundred characters of what they want to say.",
  "language": "en",
  "consent_to_publish": true,
  "website": ""
}
```

| Field | Rule |
|---|---|
| `display_name` | Required. 1–40 characters after trimming. No telephone number or email address. |
| `context` | Optional; empty or absent is none. Up to 60 characters. No telephone number or email address. |
| `rating` | Required. Integer 1–5 (the digit as a string, `"5"`, is also accepted). |
| `body` | Required. 20–1200 characters after trimming, counted as characters (an Arabic letter or an emoji is one). No telephone number or email address. Never shortened: too long is refused. |
| `language` | Required. `"en"` from `/testimonials.html`, `"ar"` from `/ar/testimonials.html`. |
| `consent_to_publish` | Required. Must be `true` (`"true"` and `"on"` are accepted). |
| `website` | The hidden honeypot field. Send it empty. `botcheck` is accepted as the same. |

Answers:

| Status | Body | Meaning |
|---|---|---|
| `201` | none | Received. Also the answer to a filled honeypot and to a sender over the budget, on purpose. Show the thank-you. |
| `400` | `{"error":"invalid","fields":["body",…],"requestId":"…"}` | Fields to correct, in the form's order: any of `display_name`, `context`, `rating`, `body`, `language`, `consent_to_publish`. |
| `403` | `{"error":"origin_refused","requestId":"…"}` | Not sent from one of the two origins. |
| `413` | `{"error":"payload_too_large",…}` | Body over 16 KiB. |
| `415` | `{"error":"unsupported_media_type",…}` | Not `application/json`. |
| `429` | `{"error":"too_many_requests",…}` with `Retry-After` | Over the per-minute budget. |
| `503` | `{"error":"unavailable","requestId":"…"}` | The practice system could not take it. Ask them to try again later. |

Budgets: per address, 5 a minute at the door (the enquiry door's rate and its
setting, `RATE_LIMIT_ENQUIRY_DOOR_PER_MINUTE`, halved by the operator on
6 October 2026; each of the host's two worker processes counts its own),
and 3 kept per 10 minutes in the database (further ones answer `201` and are not
kept). The database stops keeping new reviews while 500 are pending.

The browser sends a preflight (`OPTIONS`) first, because the body is JSON. It is
answered `204` with `Access-Control-Allow-Methods: POST, OPTIONS` and
`Access-Control-Allow-Headers: content-type`. Send no credentials and no other
headers.

## 8. Reading the published reviews: `GET /api/testimonials/published`

```
GET https://app.mcwellnessuae.com/api/testimonials/published?lang=en
```

`lang` is `en` or `ar`; absent means `en`; anything else is `400`.

```json
{
  "testimonials": [
    {
      "display_name": "Hazel H.",
      "context": "Parent, Dubai",
      "rating": 5,
      "body": "What they wrote."
    }
  ]
}
```

Approved reviews in that language only, in the office's order (section 4), at
most 30. `context` may be `null`. No ids and no dates. Render `body` as text,
never as HTML, and keep its line breaks (`white-space: pre-line`).

`Cache-Control: public, max-age=300`: a newly approved or withdrawn review can
take up to five minutes to change on the page. A simple `fetch` with no custom
headers; no preflight is needed.

## 9. Origins and headers, both routes

- Allowed origins: `https://mcwellnessuae.com` and `https://www.mcwellnessuae.com`
  (the same two as the enquiry door; `ENQUIRY_ORIGINS` overrides both doors).
- `Access-Control-Allow-Origin` echoes an allowed origin, otherwise names the
  apex (so another site's page cannot read the answer). `Vary: Origin`.
- Every answer from the two routes carries these headers, the 413, 415 and 429
  included, so the page's script can read the refusal.
- `Cross-Origin-Resource-Policy: cross-origin` on the door's `POST`/`OPTIONS` and
  the read's `GET`/`OPTIONS`; every other route keeps `same-origin`.
- `GET /api/testimonials` (no `published`) is the console's list: it is behind
  sign-in and carries no CORS headers.

## 10. Owed elsewhere

- The website's change itself (the form and the list), against sections 7–9.
- The website's privacy policy, in both languages, should say what a review
  keeps (section 2), that it is published only after approval, how long an
  unpublished one is kept (section 6), and how to ask for one to be withdrawn.
- `.claude/rules/data-model.md` and `.claude/rules/compliance.md` name the two
  tables exempt from the audit trigger and from `created_by`; `testimonial` is a
  third, by the same reasoning as `enquiry`, and needs the integrator to add it
  there (`tests/db/schema.test.ts` already admits it by its table comment).
