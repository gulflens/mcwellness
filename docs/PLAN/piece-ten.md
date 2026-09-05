# McWellness Piece Ten

Written 5 September 2026 by Claude for the operator. **Not yet approved.**

The approval of `docs/PLAN/pieces-seven-to-nine.md` on 4 September let
Claude write the two specifications that plan stopped short of ("An honest
limit"). They are now written — `docs/SPEC/assessment.md` and
`docs/SPEC/reports-v1.md` — and this file says what building them costs,
what they leave out, and the questions only the operator can answer.

| Piece | What it is | Size |
| --- | --- | --- |
| Ten | The measurements the practice takes, and the signed documents it hands a household | large, about two weeks across two streams |

## What piece ten is

Two things the practice does today on paper, brought inside.

**Measurements.** The brain map is already a service the platform sells,
books and delivers — ninety minutes at home, two in the Silver programme,
three in Gold, four in Platinum. What it has nowhere to put is the
measurement that visit produces. This adds it: the figures the equipment's
software reported, the software's own file kept beside them as the
evidence, and a screen that sets one brain map against another and shows
the difference. Questionnaires sit in the same place, scored to a total.

Nothing on that screen says what a figure means. A measurement is a fact
about a day; what it means is the practitioner's judgement, which belongs
in a document with a name on it.

**Documents.** Two kinds. A short report after a visit, for the parent who
asks what happened. A progress report over a stretch of the programme:
sessions delivered against sessions bought, the goals and what has moved,
the comparison between brain maps, and the practitioner's summary. Both are
signed by a named person, numbered, filed as a PDF, sent by the WhatsApp
hand-off the practice already uses for an invoice, and read in the
household's portal. A signed report is never edited: a mistake is corrected
by a new version that says why, and both stay.

The whole of what a household ever sees of a measurement is a report. The
figures themselves stay with the practice, and that is a rule the database
keeps rather than a screen that happens to have no link on it.

## What it deliberately leaves out

- **Reading the equipment's export automatically.** The practitioner
  uploads the software's file and types the figures, as the session's
  signal check already works. A reader for that file is a later piece and
  waits on decision 1.
- **Any interpretation by the platform.** No colour on a figure, no word
  like high or low, and no comparison against a reference database of the
  platform's own. The equipment's software makes that comparison; the
  platform keeps what it reported and adds nothing.
- **Charts**, beyond the session ribbon the design brief has always put on
  a report's cover; the comparison is a table, because a chart invites a
  shape to be over-read. **Templates the practice edits itself**, and
  reports for insurers or a health authority, which it has neither of.

## Decisions only the operator can take

1. **Which equipment and software the practice uses, and what its export
   is.** Nothing in the repository names them. The piece is built regardless
   — a person uploads the file and types the figures — but a reader for that
   file waits on this. It unblocks a later convenience and nothing else.
2. **Which questionnaires the practice actually uses.** An early note named
   seven; several are somebody else's property and need a licence the
   practice holds. Claude's default: the brain map and one you name, then
   the rest as you license them.
3. **Whether a report is deleted when a household asks to be erased.** For
   the lawyer, through you. An invoice is kept five years because tax law
   says so; nothing says that of a report, and a report is the most personal
   thing this platform produces. Claude's default: delete it, and the
   practice should have to be told otherwise.
4. **A report written for a child's school.** The agreements a household
   signs do not cover sharing a child's measurements with an institution.
   Claude's default until they do: the practice may write and issue one and
   hand it to a parent, who passes it on. For the lawyer's list.
5. **The draft mark.** Until the lawyer approves the wording, every report
   carries the same visible "draft" line the agreements carry today.
   Claude's default: yes, on every copy, off the day it is approved.

The smaller decisions are Claude's own and sit in the specifications.

## Builder notes

**Before either worktree opens, one afternoon of the trunk's time.** The
PDF writer that renders invoices lives inside the billing module, and the
ownership rules forbid one module reaching into another's. Its byte-level
half and the sending seam move to `domain/shared/`; the invoice's own
wording and layout stay with billing. Copying would leave two shapers to
drift.

**Two streams, in parallel.** `assessment` (migrations `500–599`) and
`reports` (`600–699`), each in its own worktree with its own database, as
`docs/SPEC/OWNERSHIP.md` already provides. Reports quotes a brain-map
comparison through ids carried in its own snapshot, never a foreign key, so
neither stream waits on the other's tables.

**What the streams owe the trunk**, each a change request and not an edit
of their own: the two new tables in the data model with the column
differences each specification lists; the tab mount points on the client
record; the seed generators; the two policy paths the ownership map omits;
and — the one that must not slip — the erasure steps, which must delete a
household's brain-map files and its reports, clear the words inside them,
and say so in the confirmation letter. Each ships in the round that ships
the first assessment and the first report, never later.

**The portal's sixth screen** is the client-portal stream's to build, from
what the reports specification says it shows; piece seven left it out and
named this piece as the reason. Everything else is checked as pieces one to
nine were: one combined review and one re-check under the cost rules in
`docs/HANDOVER.md`, the record posted, the merge in order, a staging pass.

## What approving this means

Approving this file approves `docs/SPEC/assessment.md` and
`docs/SPEC/reports-v1.md` as written, the defaults marked as Claude's
standing until you overrule them, as in every earlier plan. The five
decisions can be answered later; only the first changes what gets built.
