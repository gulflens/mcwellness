# What is yours to decide — Saturday 6 September 2026

Written for you to read once, over coffee, and act on. It covers the night of
5 to 6 September, in which three pull requests merged: the platform's home
(deploy, guard, backup, health checks), the measurements the practice takes,
and the reports a practitioner signs.

Nothing below is a technical instruction you have to carry out yourself. Each
item says what it costs, what Claude recommends and why, and what happens if
you leave it. Two ready-to-send drafts sit at the end: one to Hostinger, one
to your lawyer.

Where the repository does not answer a question, this page says so rather than
guessing. Every figure here is copied from a document in the repository; none
is estimated.

**What merged overnight.**

| Pull request | What it is | Merged (UTC) | Tests at the head |
|---|---|---|---|
| 80 | A home for the platform: deploy by tagging, a migration guard, a restored backup, quieter logs | 2026-09-05 22:46 | 1,491 and 839 |
| 81 | Measurements: the brain map, the questionnaire and the comparison | 2026-09-05 23:47 | 1,625 and 925 |
| 83 | Reports a practitioner signs, and the household's copy | 2026-09-06 01:42 | 1,799 and 1,001 |

Two columns of tests because the suite runs in two parts: the ordinary tests,
then the ones that need a real database.

---

## 1. The decisions that unblock the first deploy

Nothing runs in production today. The screens and the API are built and tested
on the laptop, staging is a Supabase project in Mumbai patched by hand, and the
demonstrations are served from your own machine. The machinery to change that
now exists and has never been run. These are the parts of it that are yours.

### 1.1 Where the API runs

This is the one that blocks the rest, and it is first for that reason.

The plan assumed the Hostinger Premium plan you already pay for could run the
platform. Reading Hostinger's own interface could not confirm it. Nothing on
your account is a Node.js application today, the plan's runtime reads as
ordinary shared PHP hosting, and Hostinger's own pages disagree with each
other — one lists Node.js among Premium's features, another sells persistent
Node.js as two separate products. What the platform needs is not "Node.js
exists" but **always-on**: one long-lived process that keeps its database
connections warm and stays up when nobody is asking for a page. A runtime that
starts a process per request, or sleeps when idle, does none of that.

**What it costs.** Figures as Hostinger published them on 5 September 2026, in
US dollars. The promotional column is a first term; the renewal column is the
one to plan on.

| Option | What it gives | Promotional | At renewal |
|---|---|---|---|
| The Premium plan already held | Four sites today, PHP on CloudLinux; always-on Node.js unconfirmed | paid to 2030-07-29 | 131.88 per year |
| Hostinger Web Apps Hosting, Unlimited | Managed Node.js, git or editor deploy; 50 GB storage (a companion page states 2 processors and 3 GB memory) | 3.99 per month | 16.99 per month |
| Hostinger Web Apps Hosting, Cloud Startup | As above, 4 processor cores, 4 GB memory, 100 GB, up to 10 applications | 7.99 per month | 25.99 per month |
| Hostinger VPS | Full control and Docker; 2 processors, 8 GB memory, 100 GB, 8 TB traffic; we patch the server ourselves | 8.99 per month | 14.99 per month |
| Another host that runs Node continuously | Adds a vendor row and a second account | not priced in the repository | not priced in the repository |
| Split: screens on Premium, API elsewhere | Uses the plan already paid for | not priced in the repository | not priced in the repository |

**What Claude recommends.** Do not bet the first deploy on the Premium plan.
Move the platform to Hostinger's managed Node.js product on the same account,
in Mumbai. That keeps one vendor, one bill and one line in the vendor
register, and it is a small monthly figure against the cost of discovering on
launch day that the process sleeps. Send Appendix A to Hostinger in parallel:
if the answer is a genuine always-on process, the saving is discovered rather
than assumed, and undoing the move is cheap.

The rejected alternative is the split — screens from the Premium plan you
already have, API elsewhere. It saves a few dollars a month and costs the
property the security design leans on, which is that one process serves both,
so the same protective rules cover the screens as cover the data. It also
introduces a boundary between two addresses where none exists today.

**Why Mumbai.** Not a privacy decision, a speed one. The database, the sign-in
service and the documents are already in Mumbai, and most screens make several
trips to the database. A web tier in Boston or Frankfurt puts an ocean between
the process and its database on every one of them. Of the fourteen data
centres Hostinger offers this account, none is in the UAE and Mumbai is the
nearest to Dubai.

**If it waits.** Everything waits. The address depends on it, the deploy step
names it, the record you add to your domain points at it, and the one setting
that has to be measured on the first deploy cannot be measured without it.

**One small thing to read while you are in there.** Which data centre your
existing plan sits in is not something the interface reports to us — it is a
line you can see in hPanel. If it is not Mumbai, moving it takes the existing
website with it, so it is not a small act and it is worth a conversation with
Hostinger rather than a click.

### 1.2 The GitHub environment named `production`

The release works like this: pushing a version tag runs the checks, then
**asks you to approve**, then builds, migrates the database, hands the release
to the host and calls the live address to confirm it answers. A tag proposes a
release; a person releases it.

The thing that makes the approval real is a GitHub "environment" called
`production` with you as the required reviewer. It does not exist. The build
tried to create it and was refused, because creating it changes the
repository's settings, and that is not a change an agent makes while nobody is
watching.

**What it costs.** Nothing, and about a minute.

**What Claude recommends.** Create it today. It does not depend on 1.1 and it
is the cheapest item on this page.

In the browser: the repository, then Settings, Environments, New environment,
name it `production`, tick "Required reviewers" and add yourself. Leave the
deployment branch policy at "All branches" — the release is triggered by a
tag, not a branch, and a branch rule would block it. Add no secrets yet.

Or, in a terminal, signed in to the GitHub command line as the owner:

```bash
gh api --method PUT repos/gulflens/mcwellness/environments/production \
  --field 'wait_timer=0' \
  --field 'reviewers[][type]=User' \
  --field "reviewers[][id]=$(gh api user --jq .id)"
```

Then confirm it exists:

```bash
gh api repos/gulflens/mcwellness/environments --jq '.environments[].name'
```

**If it waits.** The release cannot deploy. That is the safe direction to
fail in, but it means a tag pushed in a hurry stops at the gate.

### 1.3 The DNS record for `app.mcwellnessuae.com`

The address a household is eventually given. It is a single record added to
the domain's settings, pointing at whatever answers.

**What it costs.** Nothing but the minutes.

**What Claude recommends.** Add it the day 1.1 settles, and not before —
what the record points at is exactly what 1.1 decides. The repository does not
say what type of record it will be or what value it carries, because that
depends on the product chosen; whoever you buy from will tell you, and it is
one line.

**If it waits.** There is no address. The release's last step calls the live
address to confirm the platform answers, and a release that cannot do that
fails on purpose.

### 1.4 The settings, and which store each one goes in

Two stores, and neither of them is the code. Claude never handles these values
and none of them enters the repository.

**Store one: the repository's `production` environment**, which is what 1.2
creates. Set once, by you.

| Name | What it is |
|---|---|
| `VITE_SUPABASE_URL` | The production Supabase project's address, baked into the screens |
| `VITE_SUPABASE_ANON_KEY` | The public sign-in key for the screens |
| `PRODUCTION_MIGRATION_DATABASE_URL` | The connection the release uses to bring the database up to date |
| `HOSTINGER_API_TOKEN` | The credential the release deploys with |
| `HOSTINGER_USERNAME` | The hosting account's user name |
| `HOSTINGER_DOMAIN` | The site the release is delivered to |
| `PUBLIC_APP_URL` | Set as a variable rather than a secret: the live address |

**Store two: the repository's own secrets**, used only by the weekly backup
job, which runs from GitHub because GitHub is already a vendor we use and the
backup therefore passes through nobody new.

| Name | What it is |
|---|---|
| `BACKUP_DATABASE_URL` | A read-only database credential created for backups alone — not the API's and not yours |
| `BACKUP_SUPABASE_URL` | The second Supabase project, in a different region, that holds the backups |
| `BACKUP_SUPABASE_SERVICE_KEY` | That second project's key |

**Store three: the host's own secret store**, typed into the hosting panel.
These never pass through GitHub at all.

| Name | Note |
|---|---|
| `APP_ENV` | `production` |
| `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_SECRET` | The sign-in service |
| `API_DATABASE_URL` | The API's own restricted database role |
| `IDENTITY_KEY` | Freshly generated for production, never staging's |
| `STORAGE_PROVIDER` | `supabase` |
| `SUPABASE_STORAGE_KEY`, `SUPABASE_AUTH_ADMIN_KEY` | Documents, and issuing invitations |
| `SERVE_APP`, `HOST`, `PORT` | How the process serves |
| `TRUSTED_PROXY_HOPS` | Measured on the first deploy, never guessed — see section 7 |
| `PUBLIC_APP_URL` | `https://app.mcwellnessuae.com` |
| `ROUTING_PROVIDER`, `GOOGLE_MAPS_API_KEY` | The map and drive estimates — see 1.8 |

**If it waits.** The release stops on its first step with a plain sentence
naming exactly what is missing. It was written that way so a half-configured
environment is discovered before anything is touched, rather than after.

### 1.5 The production Supabase project, after the lawyer

**This one cannot be done early and undone later.** A Supabase project's region
is fixed when the project is created. Creating it in Mumbai now and moving it
after the lawyer answers is not a settings change; it is a new project and a
migration of every row and every file.

**What it costs.** The organisation is already on the paid Supabase plan that
provides the daily snapshots; the repository does not carry a figure for
adding this project, so ask Supabase or read it in the billing page.

**What Claude recommends.** Wait for the lawyer's answer on region (section
4), then create it. Everything else in this section can be prepared first.

**If it waits.** The database, the backups, the restore rehearsal and the
deploy all wait with it. This is the item most worth chasing your lawyer for.

### 1.6 The restore rehearsal on a real project

A backup nobody has restored is a belief. One rehearsal has been done, on the
laptop, and it earned its keep: four separate failures that would otherwise
have been discovered during an emergency.

| The rehearsal of 6 September 2026 | |
|---|---|
| Source | A local stand-in for staging: 57 migrations, the synthetic practice, 200 audit entries |
| Size of the backup | 92,012 bytes compressed; 796,053 bytes uncompressed |
| Time to make it, and to restore it | under a second, each |
| Checked | Migration count, all nine parts of the schema comparison, every table's row count, the audit chain, and the full sign-in walk-through |
| Result | Identical in every check; the audit chain verified; the permission rules survived the restore |

What it could **not** prove is the part that needs real hosting: downloading a
backup from the bucket and restoring it into a fresh hosted project, how long
that takes at real size, and whether the screens come up against it.

**What it costs.** A throwaway Supabase project for the duration. The
repository does not price it, which is why it is yours to authorise rather
than Claude's to run.

**What Claude recommends.** Authorise it once the production project and the
backups project exist and the first weekly backup has been written, and before
the first deploy. It replaces the laptop rehearsal.

**If it waits.** You go live with a backup that has been proved on a laptop
and never in the place it would actually be needed.

**One honest limitation, recorded rather than solved.** A backup taken before
an erasure still holds that household's rows until it ages out. The runbook
therefore says in one line that a restore is followed by re-applying any
erasure raised since the backup was taken, and the retention period bounds how
long that can matter.

| Backups | |
|---|---|
| Supabase's own snapshot | Daily, as the plan provides — the fast path for "yesterday was fine" |
| The weekly copy | Sundays at 03:00 UTC, which is 07:00 in Dubai |
| Kept | 90 days |
| Where | A private bucket in a second Supabase project in a different region |

### 1.7 The uptime service, and the address the alert wakes

Today nothing tells you the platform has stopped except a household ringing
you. The platform now answers two health questions: a shallow one that says
the process is running, and a deeper one that asks the database a single
question and answers only "working" or "not working" — no version, no host, no
error text, so a stranger learns whether the practice's system is up and
nothing about how it is built.

Something outside has to ask. The proposal in the vendor register is Better
Stack's free tier, marked as Claude's suggestion; no account has been created
and nothing has been signed up for.

**What it costs.** Nothing on the proposed free tier. Any service that can
telephone you will do instead.

**What Claude recommends.** Accept it or name another, then choose the number
or address the alert wakes, and fire the alert once on purpose to prove it
arrives. The alternative that needs no vendor — a scheduled job in GitHub that
calls the address — was considered and rejected: scheduled runs are delayed
under load and nothing they do reaches a phone at two in the morning.

The checker receives nothing about anybody. It calls one public address that
answers a fixed sentence carrying no personal data at all. What the service
holds is the address it calls, the answers it got, and your own contact
details for the alert.

**If it waits.** An outage is noticed by whoever notices first, which is a
household.

### 1.8 The Google key

Two keys, not one, and neither is the key inside the old Flutter app.

| Key | For | State |
|---|---|---|
| Staging | Drive estimates and the day's map picture on staging | Not supplied; staging runs the straight-line fallback and Today says the map needs the practice's key |
| Production | The same, on the live system | Its own key, its own spending cap, never staging's |

In the practice's Google Cloud project: enable the Routes API and the Maps
Static API, mint a server key restricted to those two, set a spending cap, and
hand it to a session to place in the right settings file. Claude can do the
console work if you ask.

**What it costs.** Whatever Google charges for the calls, bounded by the cap
you set. The repository does not carry a figure.

**What Claude recommends.** Mint the staging key when convenient and the
production key with the production project. What the key touches is
coordinates only — never a name, a record number, an address or an identity —
and the practitioner's navigation hand-off sends a client's entrance
coordinates only on a deliberate tap.

**If it waits.** Nothing breaks. The practitioner's day works on the
straight-line fallback and says so plainly. This is the least urgent item in
section 1.

### 1.9 The security scan on the first tag

A deep scan was started once and never finished. It has to run against the
exact revision the first release tag names, not against the main line, which
moves.

**What it costs.** A session of its own, and it is expensive. The repository
does not price the scan. The only scale available is what the night's own work
cost, below.

| Pull request | Approximate tokens across all agents |
|---|---|
| 80, the platform's home | 0.90 million |
| 81, measurements | 1.53 million |
| 83, reports | 1.93 million |

**What Claude recommends.** Cut the first tag, run the scan against it in its
own session, triage each finding — each accepted one becomes its own small
change with the usual review, each rejected one recorded with the reason — and
only then approve the deploy. A scan whose findings were never verified is
worth less than no scan, because it produces confidence without evidence.

**If it waits.** The first thing a stranger on the internet meets is a system
nobody has looked at that way.

### 1.10 What blocks what

| Item | Can be done today | Waits on |
|---|---|---|
| 1.2 The `production` environment | yes | nothing |
| 1.1 Where the API runs | yes | your decision, and Appendix A if you want the answer first |
| 1.8 The staging Google key | yes | nothing |
| 1.7 The uptime service and alert address | yes to choose; the drill waits | a live address for the drill |
| 1.3 The DNS record | no | 1.1 |
| 1.4 The settings | partly | 1.1 and 1.5 |
| 1.5 The production Supabase project | no | the lawyer's region answer |
| 1.6 The hosted restore rehearsal | no | 1.5 and the first weekly backup |
| 1.9 The security scan | no | the first tag |

---

## 2. Piece ten: five decisions, and the defaults already built

Piece ten is the measurements the practice takes and the documents it hands a
household. Both streams merged overnight. Five decisions were named as yours;
the build took a default for each and none of them is settled.

| # | The decision | The default built | What changes if you answer differently |
|---|---|---|---|
| 1 | Which equipment and software the practice uses, and what its export file looks like | Built regardless: the practitioner uploads the equipment's own file and types the figures, exactly as the session's signal check already works | Only a convenience. Naming the equipment lets a later piece read the file automatically instead of typing. Nothing else waits on it |
| 2 | Which questionnaires the practice actually uses | The brain map is built in full. The questionnaire *mechanism* is built and exercised by one synthetic sample; no licensed questionnaire's name, questions or scoring appears anywhere, because several are somebody else's property and need a licence the practice holds | Adding the one you license is one more entry in a list |
| 3 | Whether a report is deleted when a household asks to be erased | Delete it. An erasure now removes the report files and the words inside them — goals, ratings, summaries — and the record of who was sent what. What stays is a note that a report once existed and who signed it, holding nothing about the family | If the lawyer says a report must be kept, the erasure step changes. Claude's view: the practice should have to be told to keep it, not told to delete it |
| 4 | A report written for a child's school | The practice may write and issue one and hand it to a parent, who passes it on. Nothing sends anything to an institution | The agreements a household signs do not cover sharing a child's measurements with a school. For the lawyer's list — section 4 |
| 5 | The draft mark on reports | Yes, on every copy: until the lawyer approves the wording, every report carries the same visible draft line the agreements carry today | It comes off the day the wording is approved |

Two other things the build settled that are worth knowing, because they show
where the line was drawn: the platform makes **no interpretation of any
figure** — no colour on a number, no word like high or low, no comparison
against a reference database of its own — and a **measurement is never edited**.
A figure typed wrongly is corrected by a new version with a reason, and both
stay. The database enforces that rather than trusting it: nobody can change or
delete a measurement, not through the app and not at a database prompt.

Likewise a **signed report never changes**. A mistake is corrected by issuing a
new version that says why, and both are kept, because a family may already be
holding the first one.

---

## 3. Two defaults a parent might ask you about

These two are called out separately because they are the kind of thing a
parent asks at a kitchen table, and you should have decided your answer before
they do.

**A child's own portal login can read a report about themselves.** A young
person with their own sign-in sees the Reports screen and can open the
practitioner's written summary of themselves. They see no money screen,
because a balance is the household's business — but a report about them was
judged not to be the same kind of thing. This was Claude's reading of the
specification, which says the portal shows "issued reports for their own
client" without narrowing it. **It is for you to say yes to.** If you would
rather a minor's reports went only to the parent's login, that is a change to
one rule, and it should be made before a household is ever given a portal.

**A progress report prints no brain-map figure today.** The comparison between
two brain maps is built and reads the real measurements, but it prints nothing,
and honestly so. A brain map's stored figures are band powers at electrode
sites, and the rule that no report may print an electrode site or a band means
there is nothing in a brain map a report is currently allowed to quote. The
table is therefore empty rather than wrong.

**The question this raises, and it is the practice's call:** which figure, if
any, may a household be shown from a brain map? A summary the equipment's
software produces? A single index? Nothing at all, with the practitioner's
words carrying the whole meaning? Answer it and the comparison has something
to print. Leave it and a progress report is the practitioner's narrative plus
the session ribbon, which is not a bad report — just a quieter one than the
specification imagined.

---

## 4. The questions for the lawyer

One list, with the wording each question needs. Appendix B is the covering
note; this is the list to attach to it.

**First, the state of the papers, so the lawyer is not confused by what they
find.** There are two sets. The long drafts — four agreements, each in English
and Arabic, eight documents in all, plus the erasure confirmation letter — are
what the app loads and shows today, every one marked as a draft on its face.
The four short plain-language pages written on 4 September at your direction
are what you intend a household to actually read, and their Arabic versions do
not exist yet. Tell the lawyer which set you want reviewed. Claude's
recommendation: review the short set, because that is what a family will
actually sign, and have the long set retired once the short set is approved
and translated.

**The seven points the drafts already flag**, each marked in square brackets
in the texts:

1. "Please confirm the practice's legal name, trade licence number, tax
   registration number and registered address as they should appear on a
   document a client signs."
2. "Our database, sign-in service and documents are hosted outside the UAE.
   Please tell us how the agreement should describe where personal data is
   held, and what the lawful basis for that transfer is under the UAE Personal
   Data Protection Law, Federal Decree-Law 45 of 2021." (This is the same
   question as the hosting region below; they are one answer in two places.)
3. "We describe ourselves as a wellness provider and not a medical clinic: no
   diagnosis, no treatment, no prescription, and we tell every client to keep
   seeing their doctor. Please confirm that wording is right for a practice
   with no health-authority licence, and correct it if it is not."
4. "Who may give consent for a child under UAE law, and must we check a
   document proving they may? If so, which, and must we keep a copy?"
5. "Please settle the wording for our cancellation, late-cancellation and
   unfit-to-attend fees, package expiry and refunds. The amounts are ours to
   set; the wording is yours."
6. "Which governing law and which dispute route should these agreements name?"
7. "We propose keeping client records for five years after the last activity,
   keeping invoices as tax law requires, and excepting invoices and the audit
   trail from an erasure request. Please confirm, or tell us the right
   periods."

**Then the three that come from this month's work:**

8. **The hosting region — the one that blocks a deploy.** "Our database,
   sign-in service and documents would sit on Supabase in Mumbai, India, and
   the process serving the website on Hostinger, also in Mumbai. There is no
   UAE option with either supplier. We are a wellness company, not a licensed
   clinic. Is holding this data in India acceptable under the UAE Personal
   Data Protection Law, and if so, what must the client agreement say about
   it? If it is not acceptable, we need to know now, because the decision
   cannot be reversed once the systems are created."

   *Why it is urgent:* a Supabase project's region is fixed at creation.
   Creating it in Mumbai and moving later is a rebuild, not a setting. If the
   answer is that the data must stay in the UAE, neither supplier can serve
   it, and the alternative is Amazon's UAE region with the database and
   sign-in run by us — about a further week's work.

9. **Deleting a report on erasure.** "When a household asks to be forgotten,
   we intend to delete the reports we have written about them — the files and
   the words inside them — keeping only a note that a report existed and who
   signed it, holding nothing about the family. We keep invoices for five
   years because tax law requires it; nothing appears to require that of a
   report, and a report is the most personal thing we produce. Please confirm
   we may delete them, or tell us what we must keep and for how long."

10. **A report for a child's school.** "A parent may ask us to write a report
    for their child's school. Our agreements do not currently cover sharing a
    child's measurements or a practitioner's summary with an institution. Our
    intention is that we write the report, hand it to the parent, and the
    parent passes it on — we send nothing to a school ourselves. Is that
    sound, and if we ever wanted to send one directly, what consent wording
    would we need?"

---

## 5. The question for the tax adviser

One appointment, three questions, and the first is the one that matters.

**The tax point on prepaid packages.** "A client pays for a package in January
and we deliver its sessions through to May. When is VAT due — at the moment of
payment, or as each session is delivered? UAE VAT generally sets the tax point
at the earlier of payment or invoice, which would mean VAT falls due on the
whole package at sale even though we earn the revenue over months. Please
confirm in writing with our specific facts, because we intend to build the
answer into our system rather than guess it."

**Two riders to ask at the same sitting:**

- "We are a wellness business, not a licensed healthcare provider, so we
  believe the healthcare zero-rating does not apply and every service and
  package is standard-rated. Please confirm in writing before we issue our
  first invoice."
- "We bill households, who are private individuals and not registered
  persons. We believe what we issue is a simplified tax invoice, which need
  not carry the recipient's name and address. Please confirm."

**The figures that frame it**, all from the platform's own specification:

| | |
|---|---|
| Standard rate applied to every service and package | 5 per cent |
| Registration threshold | AED 375,000 of taxable supplies |
| Where the practice stands today | Not registered; the threshold has not been crossed (your determination, 5 September 2026) |
| Filing, once registered | Quarterly, within 28 days |
| Records kept | 5 years, which is also the client-record retention period |
| Electronic invoicing: appoint an accredited service provider by | 31 March 2027 |
| Electronic invoicing: live by | 1 July 2027 |

The VAT switch in the practice's settings stays off until the Federal Tax
Authority registers the practice and issues a number, because an invoice may
not carry VAT without one. Turning it on stays a deliberate human act. You
asked for the platform to watch the threshold and tell you when it is near;
that watch is on the list of small things and is not built yet.

---

## 6. The staging key to rotate, and why

**What to do.** In the Supabase dashboard, on the staging project, under API
settings, rotate the service-role key. Then a session replaces it in the
staging settings file and restarts the staging server. It takes a few minutes
and nothing depends on it being done today.

**Why.** During the eighth staging pass a shell command's redirection appended
onto the wrong line of the staging settings file, and the diagnostic that found
the fault printed that line — key included — into the agent's own transcript.
It was fixed the same minute. It was never committed to the repository and
never written anywhere else.

**How much it matters.** Little, and it should still be done. The key is
staging's, the data behind it is entirely synthetic, and it grants nothing on
the production project or on the old app's project. Rotating it closes the
matter rather than leaving a key that was once printed somewhere in
circulation.

---

## 7. The checks only a person with a phone can do

No agent can do these. They are short and they are the difference between
believing the system works and knowing it.

| Check | When | What good looks like |
|---|---|---|
| The setup photograph on a real phone | Immediately after the first live deploy | A practitioner takes the sensor photograph on their own phone and it files against the household's consent. It needs a secure address, which is why it could not be done before now |
| The uptime alert drill | After 1.7, on the live address | Stop the API on purpose. Your phone rings or buzzes at the address you chose. Then start it again. Record that it happened |
| The WhatsApp hand-off | On the phone that would really send it | Open the drafted message for an invoice and for a report. Read what a family would receive, in English and in Arabic. Nothing is sent from our server: the message and the household's number reach WhatsApp from the sender's own phone, when the sender presses send |

**And three that need a person but not a phone**, listed here so they are not
forgotten:

| Check | When | What good looks like |
|---|---|---|
| The app installs and works with no signal | On the laptop, any time | Install the built app from Chrome, and again from Safari, then reload it with the network switched off in the browser's developer tools. It should open. The builder's own browser refused to register the offline worker, so its rules are currently proved only by tests |
| The number of proxies in front of the API | On the first deploy, once | Confirm a request is counted against the caller's own address and not the content network's. It is measured, never guessed: too few and every caller in the country shares one budget, too many and the address can be chosen by an attacker |
| The live address is properly encrypted | On the first deploy, once | The address answers over HTTPS with the year-long strict-transport header. It can only be checked once something answers |

There is also a walk-through waiting on staging that a person has to do rather
than read about: write a report, sign it, render it in both languages, file it,
hand it off, and read it back on the portal as the household. The seed writes
no reports, so the first report the practice ever writes is the test.

---

## Appendix A — the question to Hostinger

Send from the account's own email so support can identify the account without
you quoting numbers. Subject line: **Does the Premium plan run an always-on
Node.js application?**

---

Hello,

We are about to put a small business application live on a new subdomain of
`mcwellnessuae.com`, and I would like to confirm what our current plan can do
before I buy anything else. We are on Premium Web Hosting, and the account
already serves `mcwellnessuae.com` and two subdomains.

The application is Node.js. What I need to confirm is not whether Node.js is
available, but whether the Premium plan can run it as a **single, long-lived
process that stays running when nobody is visiting the site**. Specifically:

1. Does the Premium plan run a Node.js application as a persistent process,
   started once and kept alive, rather than started on each request?
2. If it is kept alive, is it ever stopped or put to sleep when the site is
   idle, and if so after how long?
3. Can that process hold open connections to an external PostgreSQL database
   between requests, and keep values in its own memory between requests?
4. Which data centre is our current hosting order in, and can an application
   on this account be run from your Mumbai location?
5. If the answer to any of the above is no, which of your products would you
   recommend for this, and can it be added to our existing account so that we
   keep one bill?

I ask because your website lists Node.js among the Premium plan's features,
while your Node.js hosting page sells persistent Node.js as separate products.
I would rather have the answer in writing than discover it on launch day.

Many thanks,

---

## Appendix B — the covering note to the lawyer

Attach the list in section 4 above, and the documents themselves.

---

Dear [name],

I run McWellness, a small wellness practice in the UAE offering neurofeedback
and brain mapping in people's homes. We are not a licensed medical clinic: we
do not diagnose, treat or prescribe, and we tell every client to keep seeing
their doctor.

We are about to move from paper to a proper system, and before a single family
signs anything I would like your eyes on the wording. There are two sets of
papers and I would value your view on which to use:

- **Four short pages in plain English** — one agreement a client signs, with a
  section for a child and a box for photographs; a half-page on how we look
  after personal information; and a half-page on bookings, packages and
  refunds. These are what I want a family to actually read, at a kitchen
  table, in two minutes. They are not yet translated into Arabic.
- **A longer set of four agreements**, each in English and Arabic, plus the
  letter we would send confirming that we had erased someone's information.
  These are what our system currently shows, every one marked as a draft.

Neither set was written by a lawyer, and every point that needs your judgement
is marked in square brackets in the text. The attached list sets out ten
questions, in the order they matter to us.

**One of them is holding up our launch**, and it is question 8: where the data
may be held. Our database and documents would sit with a supplier in Mumbai,
India, because neither our hosting company nor our database company has a UAE
location. Once those systems are created their location cannot be changed
without rebuilding them, so I would rather have your answer before I create
them than after. If the answer is that the data must stay in the UAE, we can
do that — it is roughly another week of work and a different supplier — but I
need to know now.

The others are the ordinary ones: our legal identity as it should appear, who
may consent for a child, how long we keep records and what we may delete when
somebody asks to be forgotten, our cancellation and refund wording, and which
law governs the agreement. Two are newer and more particular: whether we may
delete the reports we write about a client when that client asks to be
forgotten, and what we would need in place before writing a report intended
for a child's school.

Every document currently carries a visible line saying the wording is a draft.
That line comes off the day you approve it, and not before.

I would be glad to talk any of it through if that is quicker than writing.

Kind regards,

---

*Prepared from the repository's own documents on 6 September 2026: the
hand-over, the hosting specification, the piece-ten plan, the consent folder's
outstanding points, the hosting decision record, the billing specification's
VAT section, the restore runbook, and the records on pull requests 80, 81 and
83. Where a figure is absent above, the repository does not carry it.*
