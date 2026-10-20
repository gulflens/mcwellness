# billing-16: a client search sends the name in a body, never the address

The security review of PR 287 (20 October 2026) flagged that the client search
put what a person typed, usually a client's name, in a query string:
`GET /api/clients?q=`. `.claude/rules/ui.md` forbids personal data in a URL
path or query string, because a query string reaches every proxy's access log
on the way. The operator asked for it to be fixed the same day.

The search was billing's to fix only in part: the route is client-record's,
and two of the four screens that search are scheduling's. On the operator's
word the fix was made in one round, across those paths, and is listed here
for the streams that own them.

---

## What changed

**The route** (`app/api/clients/list.ts`, client-record):

- New `POST /api/clients/search`, body `{ q?, status?, emirate? }` (strict).
  Everything else is the GET's: the `client.list` rule checked first and a
  refusal recorded, the practitioner's schedule scope, the two-character
  floor, the fifty-row page, one `list` audit row per client listed, erased
  records only for those who may see them, and `use_lookup` for anything
  shaped like an Emirates ID.
- `GET /api/clients` keeps `status` and `emirate`, which name nobody, and now
  refuses a `q` with 400 `use_search`, as it already refused an identity
  number. Its query is strict, so any other parameter is refused with 400
  too (the security review's note): no caller can put a name in the address
  under any key.

**The callers**, each now a POST with the text in the body:

- `app/admin/clients/ClientsPage.tsx` (client-record): `searchRequest` sends a
  typed term to `/api/clients/search`. The filters alone, with nothing typed,
  stay a GET.
- `app/admin/billing/ClientPicker.tsx` (billing).
- `app/admin/schedule/NewAppointmentDrawer.tsx` and `LogPastSessionDrawer.tsx`
  (scheduling).

**Tests touched outside billing's paths:**

- `app/admin/clients/ClientsPage.test.tsx`
- `tests/scheduling/NewAppointmentDrawer.test.tsx` and `LogPastSessionDrawer.test.tsx`
- `tests/client/db/identity.test.ts`, `list_emirate.test.ts`,
  `list_pagination.test.ts` and `erasure_act.test.ts`
- `tests/db/clients.test.ts` (trunk)

New assertions:

- the GET refuses `q` (`use_search`), whether the text is a name or an
  Emirates ID;
- the search refuses an Emirates ID (`use_lookup`) and a body with a stray
  field;
- the search combines with both filters;
- it writes one audit row per client listed.

**Documentation:** `docs/SPEC/practitioner-on-site.md` sections 5.1 and the
route list name `POST /api/clients/search` in place of `GET /api/clients?q=`.

No migration and no policy file.
