# assessment-02 — the shared-zone changes the export's door needs, now that the equipment is named

**Status.** Written 2026-09-06 in the round that widened the assessment
stream's file door. Item 1 is **applied in this piece's own pull request**,
under the cost rules of `docs/HANDOVER.md` section 6 and the precedent
`assessment-01.md` set for the same file two rounds ago; it is one constant and
one constant beside it in a file this stream already owns a paragraph of. Item
2 is **written and not applied**: it is a change to `domain/shared`, which is
the trunk's, and the stream carries a local check meanwhile.

**Why now.** `docs/SPEC/assessment.md` decision 3 accepted `application/pdf`
alone and a 20 MB cap "until the equipment is named". On 6 September the
founder named it, and the files her workflow produces are not what that
decision assumed: alongside the analysis software's PDF reports there are raw
recordings of 22 to 33 MB apiece, in two formats — the published interchange
format and the amplifier software's own. The spec is amended in the same pull
request.

---

## 1. `app/api/create-api.ts` — the cap and the clock on this one door

`ASSESSMENT_FILE_LIMIT_BYTES` becomes **64 MB** (was 20 MB) and
`ASSESSMENT_FILE_TIMEOUT_MS` becomes **420 seconds** (was 120).

Nothing else in the file moves: the path is still matched by method and path
together, `BODY_LIMIT_BYTES`, `PHOTO_LIMIT_BYTES` and `LOGO_BODY_LIMIT_BYTES`
are untouched, every other method on that same address keeps the 64 KB envelope
and the ordinary ten seconds, and `tests/assessment/request-timeout.test.ts`
asserts all of that as well as the two new numbers.

**Why 64 MB.** The raw recordings the practice sends are 22 to 33 MB each and a
longer session is bigger; 20 MB refuses the very files the door was widened to
carry. Sixty-four leaves room for a long recording while staying a size a
laptop can hold in memory long enough to take a digest of it.

**Why 420 seconds, and what it costs.** `timeout` races the whole handler and
the body read is inside it, so the budget is really a statement about the
slowest link the practice may be on. Two minutes was chosen for 20 MB and asked
about 1.4 Mbit/s; 64 MB inside 420 seconds asks a little under 1.3 Mbit/s, so
the ask of the link is unchanged and only the file grew. The cost is that a
request may hold its transaction open for up to seven minutes. That is a real
cost and it is taken deliberately: the alternative is a practitioner in a
household's sitting room watching a recording fail at six minutes with nothing
filed. The real bound stays the body cap, which refuses anything larger before
the route reads a byte.

## 2. `domain/shared/fileSignature.ts` — the EDF signature (written, not applied)

**The request.** `KNOWN_MIME_TYPES` and `bytesMatchMimeType` know four media
types. The European Data Format is a fifth thing the platform now holds as
evidence, and its header is fixed by the published format: the first eight
bytes are the version, an ASCII `0` followed by seven spaces. That is a
signature of exactly the kind this module exists to check, and it belongs
beside the other four rather than in one stream's own file.

The shape it wants is the one the module already has — a case in
`bytesMatchMimeType` — but EDF has no registered media type to key it on, so
the trunk has a small decision of its own: either a named export
(`bytesAreAnEdf`) beside the switch, or an agreed internal type string. This
request states the fact and leaves the shape to the trunk.

**The local check meanwhile.** `domain/assessment/fileType.ts` carries
`bytesAreAnEdf`, eight bytes and one question, and calls the shared module for
everything else. This is precisely the shape request 1 of `assessment-01.md`
took for the PDF's own five bytes, which the trunk's round 31 then answered by
moving the question to `domain/shared`; when the trunk answers this one, the
local copy goes the same way and no caller moves with it.

**Not requested.** A signature for the amplifier software's own recording
format. It is a vendor's own and unpublished, the practice has sent one file of
it, and one file cannot tell a fixed magic number from a channel count that
moves with the recording. That kind is accepted by its extension together with
a declared `application/octet-stream` — the fallback `docs/SPEC/assessment.md`
itself names — and fenced against the types the platform already recognises and
against anything beginning as markup. A second sample would let a signature
replace the extension, and it should; until then a guess would be a door that
starts refusing the practice's own files without warning.

## 3. Nothing else

No other shared path is touched by this round. The role vocabulary, the
condition column and the filing function all live in this stream's own
migration range (`503`), the drawer's attach control is
`app/admin/assessments/`, and the spec is amended in place.
