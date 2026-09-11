# McWellness Pieces Twenty and Twenty-one: the practitioner works on site

Written 8 September 2026 by Claude for the operator. **Not yet approved.**

At 04:47 the operator wrote: *"we need to extend the practioner access
permission; a practioner need to be able to collect money on site, sell a
package or individual session, enroll and update client informations, contacts
and address, complete a conscnet form, so my practioner is basically a sales
person as well."*

One thing was established before the decisions were taken, and it changes what
this is. **Shauna can already do all four of those things today**: she holds
the owner role as well as being the practitioner, and an owner may enrol a
client, edit contacts and addresses, take consent, sell a package and record a
payment. What she cannot do is any of it away from a desk. The console is a
desk tool; the phone app only runs a session and shows the day.

So this is not really a permission request. It is two:

- **the phone must be able to do the work**, at the client's door; and
- **a practitioner who is not also the owner must be allowed to**, which
  matters the day the practice employs somebody.

Three decisions were taken at 04:50:

1. **Where: on the phone, at the client's home.** Not the console. The
   practitioner's app gains enrolment, consent, selling and taking payment.
2. **Who may do what: a switch per person, and nothing on by default.**
   *Revised by the operator at 14:28 on 8 September, replacing the first
   answer, which gave every practitioner everything automatically.* You switch
   each ability on for each practitioner: enrol and correct records, take a
   consent, sell, take money, and see every client rather than only their own.
   A practitioner added tomorrow arrives able to deliver sessions and see
   their own day, and nothing more, until you say otherwise.
3. **Location sharing is the practitioner's own switch, never yours.** It
   belongs to the dispatcher plan (`docs/PLAN/dispatch.md`, piece
   twenty-five), and it is deliberately the other way round from the switches
   above: a permission the employer controls is access, and a permission the
   subject controls is consent. Those are different things and the practice
   needs both.

That is two pieces, in this order:

| Piece | What it is | Size |
| --- | --- | --- |
| Twenty | **The client, on the phone.** Find any client, open their record, correct their details, contacts and addresses, enrol a new one, and take a consent with a signature — all on the phone, at the door. Carries the permission change both pieces need | large |
| Twenty-one | **Money, on the phone.** Sell a package or a single session, take the payment, hand over the receipt | medium |

This file is the plan for both. The specification it approves is
`docs/SPEC/practitioner-on-site.md`, which covers piece twenty in full and
lists what twenty-one will add. Piece twenty-one gets its own short plan when
its turn comes.

## The one switch to think hardest about

Four of the five switches are ordinary: a practitioner may enrol, correct a
record, take a consent, sell, take money. The fifth is not, and it is worth
reading twice.

Today a practitioner sees a client's record only if that client is on their
own schedule: a visit in the last ninety days or the next thirty, and only
one the household has agreed to. One database rule decides this, and **nine
other parts of the system ask it before they show anything**. So the switch
called *see every client* does not only open the client list. For the person
you switch it on for, it opens:

- the client's record, contacts, addresses and access notes;
- their consents, and what they have withdrawn;
- their visits, past and future, and who delivered them;
- their sessions and what was recorded during them;
- their brain maps and every measurement taken;
- their reports, drafts included;
- their money: what they have bought, what they owe, what they have paid.

None of that is on for anybody unless you switch it on for them by name, and
the four ordinary switches work perfectly well without it: a practitioner can
enrol the household in front of them and sell to the client whose living room
they are standing in, on their own schedule, with this one left off. Switch it
on for somebody you trust with the whole practice, and not as a matter of
course.

It can be switched off again, and switching it off is immediate. What cannot
be undone is what somebody has already read while it was on — which is the
only reason this one is worth a moment's thought rather than a shrug.

**One thing is not on any switch, and Claude has taken this as a default
rather than asking:** forgiving a fee. Selling and taking money are a
salesperson's; deciding a household owes nothing after a missed visit is the
practice's, and it stays with the owner, an admin and finance. Say the word
and it becomes a sixth switch.

## What piece twenty is

**Any client, found and opened on the phone.** A search that finds a household
by name or record number, and a record that opens in the phone's own shape —
dark, one column, one thing at a time — carrying who they are, their contacts,
their addresses, their goals and where their consent stands.

**Their details, corrected at the door.** A practitioner standing in someone's
living room can fix a phone number, add a second parent, correct the spelling
of a name, record a new address with the entrance and the parking point, and
add the access notes that make the next visit easier. Everything already
possible at the desk, in the hand.

**A new client, enrolled on the spot.** The whole enrolment the console runs —
the household, the client, the first contact, the address, the goals — on the
phone, as a sequence of single questions rather than a wizard on a wide
screen. This is the discovery call turning into a client without anybody going
back to a laptop.

**Consent, taken and signed.** The consent wording the practice has approved,
shown in full, in the language the household reads, with a signature taken on
the phone's own screen. The same evidence the console captures: the wording
they were shown, the version, who signed, when, and how.

**And the switches themselves**, on the Practitioners page in Settings that
pull request 126 has just added — the same screen that already carries each
practitioner's home base. One row per person, five switches, each recording
who granted it and when, and each revocable. No new screen, and nothing for
you to remember when you hire: a new practitioner starts with all five off.

## What piece twenty-one is

Selling and being paid: a package or a single session chosen and sold at the
door, the price and any discount shown before it is agreed, the payment taken
in cash, by transfer or by a link, and the receipt handed over or sent. It
lands after twenty because it needs the client to be findable and openable on
the phone first, which is exactly what twenty builds.

## What it deliberately leaves out

- **Working with no signal.** A session already survives a basement car park,
  because what it records can wait in a queue. Enrolling somebody, taking a
  consent and taking money cannot: a consent needs the exact wording filed as
  evidence, and an invoice needs a number nobody else has taken. All three say
  plainly that they need a bar of signal, and the day's own screens go on
  working without one.
- **Deleting anything.** A practitioner may add and correct. Erasing a client,
  withdrawing a consent on somebody's behalf and cancelling an invoice stay
  with the office.
- **The console changing at all.** Every other role keeps exactly the screens
  and the reach it has today.
- **A second practitioner's own schedule.** A practitioner still sees their
  own day on Today; the day map and the practice's whole diary stay the
  office's.

## Decisions only the operator can take

Two were taken at 04:50 and are recorded above. Three remain, each with a
default that stands until overruled:

1. **Forgiving a fee** stays with the office (above). Default: unchanged.
1a. **Who may work the switches.** Default: the owner and an admin, the same
   pair who may already hand out a role. Not the lead practitioner: granting
   somebody the ability to take money is an ownership act rather than a
   clinical one.
2. **What a practitioner may take on the phone.** Default: cash, bank transfer
   and a payment link — the three the practice already uses — with cash the
   one the screen offers first, because that is what happens at a door.
3. **Whether a practitioner may enrol a client with no consent yet.** Default:
   yes, as the console allows: a client can exist before they have signed
   anything, and nothing can be delivered to them until they have.

## What it costs

Under the cost rules of `docs/HANDOVER.md` section 6. Piece twenty: a builder
on Opus about 1.1 million tokens; one combined review and one re-check about
0.5 million; a fix round about 0.35; a staging pass about 0.3. Roughly 2.3
million — the largest piece since the books. Piece twenty-one: about 1.5
million. Nothing to buy, no new vendor, no new key.

## What you have to do

Before the build: approve this file, and say whether the three defaults above
stand. When piece twenty is on staging: enrol a synthetic client on a phone,
take a consent on it, and say whether the sequence reads right in the hand —
that is the one thing no test can answer.

## Builder notes

The permission change is one line in `domain/shared/actor.ts` and one function
in the database, but that function is consulted by nine migrations and six
policy files across every stream, so it is the highest-risk line in the piece
and it lands first, with its own tests proving exactly which reads open and
which do not. The screens are the console's own flows re-shaped for a phone,
and the rule underneath each — enrolment, consent, contacts, locations — is
already written, tested and shared; almost nothing of the logic is new. What
is new is the shape, and the shape is the practitioner ground of
`docs/DESIGN-BRIEF.md` 6.1: dark, one column, one decision per screen, a
56-pixel action in the thumb's reach, and no chrome during a session.

## What approving this means

Approving this file approves `docs/SPEC/practitioner-on-site.md` as written
for piece twenty and the defaults above as Claude's standing until you
overrule them — including that a practitioner added tomorrow can deliver
sessions and see their own day, and nothing else, until you switch something
on. It approves nothing of piece twenty-one beyond its one-line description;
that comes back to you with a plan of its own.
