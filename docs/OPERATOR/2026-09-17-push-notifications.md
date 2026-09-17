# Push notifications for offers and announcements — what is yours to decide

Written 17 September 2026 for you to read once and answer in one message. It
comes from your request of 16 September: "push notifications to clients about
offers, discounts or announcements". The other three requests from that
message are built and waiting for you to merge (the expo form, pull request
184; logging past sessions, 185; the review line, 186). This one is not built,
and it should not be started until four things are decided, because each of
them changes what gets built and one of them is a promise the practice has
already made to every household in writing.

Each item says what it is, what it blocks, the default in force, what is
recommended and why, and the one line to reply with. Where you agree with the
recommendation, "as recommended" is a complete answer. At the end: what gets
built once you have answered, in what order, and the one thing that can be
built now without any of it.

## The promise already made

Every household has been shown, and the adults have signed, wording the
practice's legal advisor approved on 9 September. Both documents say the same
thing:

> We never sell your information. We never use it for advertising. We never
> use it for research. We never use it for anything unrelated to your sessions
> and your account with us. If that ever changes we will ask you first,
> separately, and you may say no.
> — `docs/CONSENT/notices/your-information.en.md`

> We do not sell it. We do not use it for advertising. We do not use it for
> research. We do not use it for anything unrelated to your sessions. If that
> ever changes we will ask you first, separately, and you may say no.
> — `docs/CONSENT/health-data.en.md`

A message about an offer or a discount, sent to a person because they are a
client, is using their information for advertising. It is allowed, but only
on the terms the practice itself set: ask first, separately, and take no for
an answer. That is why the `marketing` consent purpose already exists in the
system and is deliberately not offered on any screen today (the legal
advisor's recommendation of 9 September, `domain/client/types.ts`). Nothing
below is a way round that sentence. Everything below is how to keep it.

An announcement that is not an offer (the studio is closed for Eid; a new
practitioner has joined) is not advertising and needs no new consent. The
split matters for decision 3.

## The four decisions

### 1. Ask households for a marketing consent, and where

**What it is.** A fifth consent wording, in English and Arabic, saying in
plain words what the practice would send (offers, discounts, news), how often
at most, by which channel, and that saying no or stopping later changes
nothing about their sessions. Versioned and filed like the four wordings
that exist, approved by the legal advisor before it is shown to anybody,
signed per household by an adult, withdrawable in one press.

**What it blocks.** Everything else here. No push, no offer by any channel,
until a household has said yes to this wording.

**The default in force.** No marketing consent is asked for; nothing is sent.

**Recommended.** Ask for it on the household portal, under Agreements, as a
switch the person turns on themselves after reading the wording, and turns
off themselves in one press — not at the studio with the four consents the
first session needs. Two reasons. It keeps the practice's own promise
exactly: separately, and with no as easy as yes. And a consent given on a
person's own phone, in their own language, with the switch beside the
wording they read, is the kind the law is written for; one given at a kitchen
table beside the health questions, to a practitioner waiting with a tablet,
is the kind that gets argued about. The portal today only *asks* the practice
to withdraw a consent (a request the office handles); this switch would be
the first consent the portal itself records and withdraws, which is one more
reason to keep it to this one purpose.

**Reply.** "As recommended", or "at the studio with the others", and whether
the legal advisor should see the draft wording before or after you do.

### 2. The channel: the phone's own notifications, or WhatsApp

**What it is.** How a message reaches the person. Two real options.

*Web push*: the portal, added to the phone's home screen, receives
notifications through Apple's, Google's or Mozilla's push service. The
practice's server holds one address per device and sends each message,
encrypted, to that service, which delivers it. On an iPhone this works only
once the portal has been added to the home screen (iOS 16.4 and later); from
Safari's own tab it does not work at all, so every household would need to be
shown the two taps that put the portal there.

*WhatsApp Business API*: the practice sends from its own WhatsApp number
through Meta's paid service, with each message template approved by Meta in
advance. Everything the practice sends today by WhatsApp is a hand-off — the
platform writes the message, a person presses send in their own WhatsApp —
and the vendor register says in as many words that the Business API is "not
yet" approved and not needed for that.

**What it blocks.** The vendor row. CLAUDE.md rule 9: anything that receives
personal data is listed in `docs/COMPLIANCE/approved-vendors.md` before any
code. Web push means a row for the three push services, receiving a device
address and an encrypted message they cannot read; WhatsApp means the
Business API row turning from "not yet" to approved, with Meta receiving the
number and the text of every message.

**The default in force.** Neither. Nothing is sent from this server to
anybody, by any channel, and the register says so.

**Recommended.** Web push. The push services learn a device address and the
size and timing of an encrypted message, and never a name, a number or a
word of it; that is the smallest thing any vendor on the register would
receive. The Business API hands Meta the number and the text of every offer,
costs money per message, and needs each template approved by Meta. The cost
of web push is the home-screen step on iPhones, which the practitioner
already talks households through for the practice's own app, and which the
portal can explain on its home in one sentence with a picture.

**Reply.** "As recommended", or "WhatsApp"; and if web push, confirm the
register row for Apple, Google and Mozilla's push services may be written.

### 3. What may be sent, to whom, and how often

**What it is.** The rules every message obeys, written down before the first
one, because a screen will enforce them and the wording in decision 1 will
promise them.

**What it blocks.** The wording. A consent has to say what it is consent to.

**The default in force.** None; nothing is sent.

**Recommended.**
- *Two kinds.* An **announcement** (practice news, a closure, a new service,
  a new practitioner) goes to every adult with a portal login, because it is
  not advertising. An **offer** (a discount, a package price, a season)
  goes only to adults whose marketing consent is on. Never to a young
  person's own login, whatever the kind.
- *Written by you or an admin*, in Settings, in both languages, and sent
  from there. Nothing sends itself and nothing is scheduled.
- *A discount named in an offer is a discount the price list carries*
  (`docs/PLAN/billing-discounts.md`): money off the list figure, with its
  reason recorded, so the offer and the invoice say the same thing.
- *No medical claim, ever*, in either kind. Sessions, goals, measurements;
  the wellness positioning of 2 September applies to every word that leaves
  the practice.
- *At most two offers a month*, and the wording says so. An announcement
  has no ceiling but has no reason to be frequent.
- *One press to stop*, honoured at once: the switch on the portal, and a
  "stop" in every offer that leads to it.
- *A record of every message*: what was sent, when, by whom, to how many,
  and each household's consent standing at that moment — so the practice can
  show a regulator, or a household, exactly what it did.

**Reply.** "As recommended", or the ceiling and the kinds you want instead.

### 4. The interim: an announcements block on the portal home

**What it is.** A short block on the household's portal home, written from
Settings by you or an admin, in both languages, seen by every adult the next
time they open the portal. Nothing is sent to anybody; the practice's own
page says something new. No consent is needed because no information is
used, and no vendor is involved because nothing leaves this server.

**What it blocks.** Nothing. It can be built now, before any of the above,
and when push arrives an announcement becomes the thing a push points at.

**The default in force.** The portal home carries no announcements.

**Recommended.** Build it, as one round, while the wording of decision 1 is
with the legal advisor. Two rules to keep it what it is: it says practice
news and may name an offer only in the plain words the price list already
shows a household on the money screen, and the portal spec's section 4 gains
one dated line for it beside the review line's, since a block of the
practice's own words on a person's record is a thing that section was
written to keep small.

**Reply.** "As recommended", or "wait for the push round".

## What gets built once you answer, in order

1. **The wording**, `docs/CONSENT/marketing.en.md` and `.ar.md`, drafted from
   decision 3's rules for the legal advisor; filed as a versioned consent
   text like the four that exist. No code until it is approved.
2. **The announcements block** (decision 4), if you want it first: a small
   table of announcements, the Settings screen that writes one, the portal
   home that shows it, in both languages, audited.
3. **The switch on the portal** (decision 1): the marketing consent given
   and withdrawn by the person on their own record, pointing at the exact
   wording they read, audited like every consent.
4. **The register row and the plumbing** (decision 2): the vendor row; a
   table of device subscriptions per adult login; the portal's "turn on
   notifications" step with the iPhone home-screen instructions; the
   service worker's listener; one secret key pair for the practice, made at
   deploy and never shown, which is the one act at deploy time only you can
   do; and a sending job that runs from inside the API process the way the
   two existing jobs do (`app/api/scheduler.ts`), since the platform has no
   separate job runner and should not gain one for this.
5. **The Send screen** (decision 3): write a message, choose the kind, see
   how many will receive it, send once, and the record of it.

Rounds 1 and 2 need only your answers. Rounds 3 to 5 need the legal
advisor's approval of the wording first, and round 4 the register row.

## Acts only you can do

- Put the draft marketing wording to the legal advisor, with decision 3's
  rules beside it, once it is written.
- Confirm in one line that the practice's own promise — "we will ask you
  first, separately, and you may say no" — is met by a switch on the portal.
  That is the line a regulator would ask for.
- At deploy time, when round 4 lands: run the one command that makes the
  practice's push key pair on the server, which nothing here can do for you.
