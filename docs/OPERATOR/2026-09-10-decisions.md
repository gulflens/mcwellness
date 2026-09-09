# What is yours to decide — Thursday 10 September 2026

Written for you to read once and answer in one message. It comes from the
completeness audit of 10 September, which looked at everything planned, built
or deferred since 2 September and found twelve questions that only you or
Shauna can answer. None of them stops the practice working today: each is
answered for now by a default that was chosen so the build could continue, and
each default is written down. Answering them lets the next pieces be planned
on your decisions rather than on guesses.

Each item says what it is, what it blocks, the default in force, what is
recommended and why, and the one line to reply with. Where you agree with the
recommendation, "as recommended" is a complete answer. At the end are four
acts only you can do from your own accounts, and one draft ready to send.

## Answered, 10 September 2026 at 05:47 (the operator's clock)

The operator answered every item in one message. Each answer, and what
follows from it:

| # | Answer | What follows |
|---|---|---|
| 1 | The books start on **15 September 2026**; nothing said on the relief, so it stays elected pending the adviser | The start day is set on production under the founder's account, with the reason recorded; the first opening of Books posts nothing dated before it |
| 2 | As recommended | Unregistered; the tax-point question goes to the adviser in writing; nothing built |
| 3 | **30 days** | The Enquiries screen surfaces an enquiry still new after thirty days as waiting, with one press to dismiss; nothing dismisses itself. Built in the next trunk round |
| 4 | As recommended | One takings figure for everyone, an erased household's money included. A billing round with its own short plan |
| 5 | As recommended | Check-in admits confirmed visits only, refusing a proposed one with a plain sentence. Built in the next trunk round, in the session-capture stream's paths |
| 6 | **Not until mid 2027** | No service type for Compassionate Inquiry until then; nothing built |
| 7 | **Leave it off** | The certification gate stays off; nothing built |
| 8 | As recommended | A progress report prints the practitioner's observation and no brain-map figure; nothing built |
| 9 | As recommended, **with two three-month extensions** | Packages expire six months from purchase; up to two extensions of three months each on request, no charge; the notice period and fee stay 24 hours and AED 150. A billing round with its own short plan |
| 10 | **Mark this feature as coming soon** | The questionnaire and the reading of the equipment's export are shown as coming soon on the assessment screens rather than waiting on a file; the practitioner keeps typing the figures. Built in the next trunk round |
| 11 | **Build the dispatcher** | The plan and specification on pull request 128 are approved: the board first (piece twenty-two), then telling and hearing back, the notification, and live location last with its consent page. Pull request 127, the practitioner on site, stays open and unbuilt |
| 12 | **Do it for me** | The staging project's leaked legacy service-role key is retired: a new secret key of the current kind is minted, placed in the laptop's staging settings without being shown, and the legacy keys are switched off, which invalidates the old one. Recorded below when done |

## Done since the answers, the same hour

- **Decision 1.** The books' start day on production is **15 September 2026**,
  set at 21:53 UTC under the founder's account through the API with the
  reason recorded, with the entry count read as zero before and after.
  Small Business Relief stays elected; the adviser's line is still wanted.
- **Decision 12, half.** The staging app no longer uses the leaked key: the
  project's current-style secret key was placed in the laptop's staging
  settings without being shown, the staging server restarted on it (health
  and deep health green) and the key proved against the storage API. **The
  leaked legacy key is still valid until the legacy keys are switched off**,
  which the management API does with a token this session may not read in
  its current mode. One click finishes it: Supabase dashboard, project
  `mcwellness` (the staging one), Settings › API Keys, "Disable legacy API
  keys". Nothing on staging still uses them.

## The twelve decisions

### 1. The day the books start, and Small Business Relief

**What it is.** The books have never been opened on production. The first
time Books is opened, every invoice, payment and credit already recorded is
posted into the journal from the practice's first day. The start day can be
changed in Books › Settings until the first entry exists, and not after. The
corporate-tax estimate assumes Small Business Relief is elected (revenue under
AED 3 million; the relief runs to the end of 2029).

**What it blocks.** Nothing today. The first opening of Books fixes the start
day for good.

**The default in force.** The start day is the day the practice was created
on production, 7 September 2026; the relief is assumed elected
(`docs/SPEC/accounting.md` section 13).

**Recommended.** Keep 7 September: it is the practice's first day and nothing
predates it. Ask the tax adviser to confirm the relief in one line, in
writing, before the first corporate-tax pack is produced.

**Reply.** "As recommended", or the earlier day you want the books to start,
and the adviser's answer on the relief when you have it.

### 2. VAT registration, and the tax point on prepaid packages

**What it is.** The practice is not registered for VAT and the switch is in
Settings › Practice; it refuses to turn on without the fifteen-digit number.
When a household pays for a package up front, when the VAT on it falls due
(at invoice, or as each session is delivered) is a question for the tax
adviser once the practice is registered.

**What it blocks.** Nothing today: with the switch off no VAT is charged, no
invoice names a rate, and the platform watches the AED 375,000 threshold and
says when it is near.

**The default in force.** Unregistered; the platform records the tax point at
invoice (`docs/SPEC/billing.md` section 5.3).

**Recommended.** Stay unregistered until the threshold watch says otherwise;
register only when the Federal Tax Authority issues the number. Put the
tax-point question to the adviser in writing now, so the answer exists before
it matters.

**Reply.** "As recommended", and the adviser's answer on the tax point when
you have it.

### 3. Enquiries nobody actions

**What it is.** An enquiry from the website sits on the Enquiries screen until
somebody makes it a lead or dismisses it. A duplicate, a mistake, or a person
who changed their mind holds a name and a number for as long as nobody presses
a button.

**What it blocks.** Nothing today; one synthetic test enquiry from the go-live
walk is on the screen for you to dismiss.

**The default in force.** Kept until actioned; nothing dismisses itself.

**Recommended.** A stated period after which the screen surfaces them as
waiting — fourteen days — with one press to dismiss, and nothing that
dismisses them by itself: dismissing is an act with a reason, and nothing on
this platform deletes on a timer.

**Reply.** "As recommended", or the number of days you prefer.

### 4. The takings figure changes with who asks

**What it is.** An erased household's money is visible to the owner and the
lead practitioner and not to finance or an admin, so cash collected and
revenue recognised read smaller for finance in any month that contains an
erased household (`docs/CHANGE-REQUESTS/billing-04.md` section 8).

**What it blocks.** Nothing today: no household has been erased.

**The default in force.** Each role sees the figure its own row access
allows.

**Recommended.** One figure for everyone. An erasure removes the person and
keeps what tax law requires, and the money is exactly what tax law requires;
finance must see the true takings. The rows stay anonymised; only the totals
change, to agree.

**Reply.** "As recommended", or "each role its own figure".

### 5. May a practitioner check in to a visit nobody confirmed?

**What it is.** Check-in admits a "proposed" visit, one the household has not
been told about, while the practitioner's view of the client opens only once
the visit is "confirmed". One of the two is wrong. Meanwhile the close was
narrowed so nothing unconfirmed is quietly marked complete
(`docs/CHANGE-REQUESTS/session-capture-02.md` section 8).

**What it blocks.** Nothing today, with one practitioner who is also the
person confirming.

**The default in force.** Check-in admits a proposed visit.

**Recommended.** Confirmed only. A practitioner at the door of a household
that was never told is a failure to surface on the schedule, not a session to
run; refusing the check-in with a plain sentence ("this visit was not
confirmed with the household — call the office") is the safer of the two.

**Reply.** "As recommended", or "admit proposed visits".

### 6. Compassionate Inquiry has no price and no service type

**What it is.** The catalogue holds five services: discovery call,
consultation, brain map, results call, neurofeedback session. Compassionate
Inquiry is on the website and has no service type in the app, so it cannot be
booked or sold. Shauna's qualification is expected in February 2027 and the
website says so.

**What it blocks.** Booking or selling a Compassionate Inquiry session.

**The default in force.** Absent from the catalogue.

**Recommended.** Add the service type now, unpriced, so a session can be
scheduled and its delivery recorded, and leave the price for when the
qualification is in hand; an unpriced service that is delivered is flagged on
the billing exceptions list rather than silently free.

**Reply.** "As recommended", or a price in AED (net), or "not until 2027".

### 7. The certification gate is off on every service

**What it is.** Each service can require a valid credential of the
practitioner assigned to it. The gate was left off "for now" when the
catalogue was loaded on 7 September. Shauna's five credentials are on file
and valid.

**What it blocks.** Nothing today: with one certified practitioner, the gate
changes nothing for her.

**The default in force.** Off on all five services.

**Recommended.** On, for the brain map and the neurofeedback session. It costs
nothing today and stops an uncertified second practitioner being booked for
either the day one joins.

**Reply.** "As recommended", or "leave it off".

### 8. What a household may see of a brain-map comparison

**What it is.** A progress report prints nothing for the brain-map comparison,
because the stored figures are band powers per electrode site and no rule says
which of them a family may be shown. The practice decides; the report follows.

**What it blocks.** The comparison section of a progress report.

**The default in force.** The report prints the practitioner's written
observation and no figure.

**Recommended.** Keep it that way for the first programmes: a figure in a
family's hands invites a diagnosis to be read into it, and the consent wording
says the comparison is not one. Revisit after the first re-map, when there is
a real comparison to look at together.

**Reply.** "As recommended", or name the figure and the words that go with
it.

### 9. Package expiry and extension; the notice period and the fee

**What it is.** The app carries a notice period and an unfit-to-proceed fee in
its settings (24 hours; AED 150), and the website's terms name them. What a
package's expiry and extension terms are has never been settled.

**What it blocks.** Nothing today; it becomes a household's question the
first time a package runs past its natural end.

**The default in force.** Packages do not expire; the notice period and fee
are as loaded.

**Recommended.** Confirm the website's terms and the settings agree (they do
today: 24 hours, AED 150). Set an expiry of six months from purchase for the
three programmes, with one extension of three months on request and no
charge, and let the settings hold it; the refund quote for a package stopped
early already exists.

**Reply.** "As recommended", or your expiry and extension terms.

### 10. Which equipment, which export, which questionnaire

**What it is.** A reader for the amplifier software's numeric export cannot be
written until one such file exists to write it against; the questionnaire
mechanism ships with one synthetic sample and no licensed instrument; and the
practice's amplifier, laptop and electrode set are not yet registered under
Settings › Kit with the amplifier's calibration date.

**What it blocks.** The export parser (a later piece); a real questionnaire;
the calibration warning at check-in.

**The default in force.** The practitioner types the figures from the
software; the questionnaire mechanism is proved on the synthetic sample; no kit
is registered.

**Recommended.** Three things from Shauna, none urgent: one numeric export
file from the analysis software (with no client in it, or a test recording),
the name of the first questionnaire she wants and whether it is licensed, and
the kit's serials and the amplifier's last calibration date typed into
Settings › Kit.

**Reply.** The file and the two answers, when convenient.

### 11. Two planned pieces await your word, and one stale pull request

**What it is.** The dispatcher (the whole practice's day on a board, with the
practitioner's live location designed consent-first and off by default) and
the practitioner-on-site piece (every practitioner sees the whole practice's
clients) were planned and specified on 8 September and sit as open pull
requests 128 and 127; nothing of either is built. Pull request 116, three
documentation files from 7 September, fell behind the current record.

**What it blocks.** Both pieces.

**The default in force.** Neither is built. Pull request 116's content is
carried into `docs/PRODUCTION.md` by trunk round 41 and the pull request
closes when that round lands, so that part needs nothing from you.

**Recommended.** Hold both until there is a second practitioner: the
dispatcher is for a practice with more than one person on the road, and the
on-site piece's one big choice (everyone sees everyone's clients) is easier to
take when the second person is real. When you want one, say which, and its
plan is already written.

**Reply.** "Hold both", or "build the on-site piece", or "build the
dispatcher".

### 12. Rotate the staging project's service key

**What it is.** Owed since 6 September, when a shell redirection printed the
staging project's service-role key into a working log. Staging
holds synthetic data only; this is hygiene, not exposure.

**What it blocks.** Nothing.

**The default in force.** The key stands.

**Recommended.** Rotate it now: Supabase dashboard, the staging project,
Project Settings › API, "Generate new service role key". Five minutes. Then
say so, and the new value is placed in `.env.staging` on the laptop without
being shown.

**Reply.** "Done" when it is.

## Four acts only you can do

1. **Pause the old app's Supabase project** (`gqvpapvdqcfjlifgwhpk`) from the
   dashboard, once real enquiries have landed through the new door — the API
   refuses to pause a paid project, and a guard in the repository stops any
   automated step touching it. Its `lodge_enquiry` is the revert path until then. Delete its two
   Firebase keys at the same time.
2. **Sign up to Better Stack** for uptime alerts to your phone, if you want
   them; the GitHub probe already checks both health routes every five
   minutes and opens an issue when they fail, which reaches your email.
3. **One line to Hostinger about IPv6.** Their edge does not answer on IPv6,
   so anything that tries IPv6 first waits about two and a half minutes before
   falling back; browsers cope. The draft is below.
4. **The translation rule in the QEEG Report Builder.** The desktop report
   builder sends a practitioner's free text to Google Cloud Translation for
   the Arabic. Google is not on the approved vendor list for a client's text.
   Either approve it (it then goes on the list, and the consent wording gains
   a line saying so), or leave the rule as it is: never on text about a
   client.

And the kit register (decision 10), which is typed into the app.

## Draft to Hostinger

> Hello. Our Node.js website app.mcwellnessuae.com (order 1009508471) is
> reachable over IPv4 but connections to its IPv6 addresses (the AAAA records
> for the CDN edge) time out on port 443. Could you check IPv6 on the edge
> serving this site, or remove the AAAA records if IPv6 is not supported on
> this plan? Thank you.
