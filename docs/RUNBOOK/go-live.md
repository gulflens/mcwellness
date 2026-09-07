# Runbook — going live at app.mcwellnessuae.com

This is the last part of the first deployment, and it is the part only you can
do. Everything that can be prepared without a password has been prepared: the
site exists on the hosting account, the code has been sent to it, and the
settings that are not secret are already in the list. What is left is seven
values that unlock things, and a login of your own.

**Why you and not Claude.** These seven values open the practice's database,
its documents and its sign-ins. They are typed once by you into the hosting
panel, they never enter the code, they never pass through GitHub, and no
session ever reads them back. That is the whole point of the arrangement
(`docs/SPEC/hosting.md` section 4.4), so nothing below asks you to send a value
anywhere or to paste one into a conversation.

**How long.** Half an hour if the two dashboards open first time, and it is
better done in one sitting than in two: the site does not answer properly until
all seven are in.

**Two words used throughout.** The **hosting panel** is Hostinger's hPanel, at
`hpanel.hostinger.com`. The **Supabase dashboard** is `supabase.com/dashboard`,
where the practice's database, its documents and its sign-ins live.

---

## Before you start

Have these open, and if any of them is not true, stop and say so rather than
working around it.

1. You can sign in to the hosting panel, and under **Websites** there is a site
   called `app.mcwellnessuae.com`.
2. You can sign in to the Supabase dashboard and open the **production**
   project — the practice's own, not the staging one, which holds made-up
   people. If you are unsure which is which, ask before you copy anything.
3. You can sign in to the Google Cloud console, if the practice's map key has
   been made. If it has not, step 6 says what to do instead, and nothing else
   is held up by it.
4. Somewhere safe to keep a copy of what you paste. The practice's password
   manager, not a note on the desktop and not an email to yourself. One of
   these values cannot be replaced later without cost — step 5 says which.

---

## 1. The settings that are already in the list

Open the hosting panel, then **Websites**, then the `app` site, then **Node.js**,
then **Environment variables**. You should see the names below with these
values. You are not changing any of them; this is so the list is familiar
before you add to it, and so a name that is missing is noticed now rather than
at the first check.

| Name | Value | What it is |
| --- | --- | --- |
| `APP_ENV` | `production` | Which system this is. It is what makes the API refuse a placeholder left over from a laptop |
| `NODE_ENV` | `production` | The same thing said in the way the tools expect |
| `SERVE_APP` | `true` | One process serves both the screens and the data, which is what keeps the protective rules over both |
| `HOST` | `0.0.0.0` | Answer on every network the machine has, so Hostinger's front end can reach it |
| `PORT` | a number, or absent | Many hosts hand the process its own port. If this name is absent, that is why; if the site never answers, this is the first thing to ask Hostinger about |
| `PUBLIC_APP_URL` | `https://app.mcwellnessuae.com` | The address the practice hands out. A household's invitation link is built on this and never on whatever a caller typed |
| `TRUSTED_PROXY_HOPS` | `1` | How many of Hostinger's own machines stand in front. It is **measured** at check three below, never guessed |
| `STORAGE_PROVIDER` | `supabase` | Documents go to the practice's private bucket, never to a folder on the server |
| `ROUTING_PROVIDER` | `google` | Drive estimates and the day's map come from Google. Without the key in step 6 the day still works and says plainly that it is estimating in straight lines |
| `SUPABASE_URL` | the project's address | Where the sign-in service and the documents are |
| `VITE_SUPABASE_URL` | the same address | The same thing, for the screens. These two must name the same project |
| `SUPABASE_JWKS_URL` | that address followed by `/auth/v1/.well-known/jwks.json` | The public list of keys the API checks a sign-in against. Public by design: it proves who signed a token and unlocks nothing |
| `VITE_SUPABASE_ANON_KEY` | the project's publishable key | The sign-in key the browser holds. Also public by design — it is in the screens anyone can view — and it is **never** the service key of steps 2 and 3 |

If a name is missing or a value differs, note it and ask; do not invent one.

---

## 2. The seven you paste

All seven go in the same place: the hosting panel, **Websites**, the `app`
site, **Node.js**, **Environment variables**, then **Add variable** for each
one.

Three rules that prevent almost every mistake:

- Type the name **exactly** as written here. `SUPABASE_STORAGE_KEY` is not
  `SUPABASE_STORAGE_KEY ` and not `Supabase_Storage_Key`.
- Paste the value with **no quotation marks** around it and no spaces before or
  after. A trailing space is invisible and breaks a key.
- Do not press save until the end. There is one save and one restart at step 8.

### Step 1 — `SUPABASE_JWT_SECRET`

**Where it comes from.** The Supabase dashboard, the production project, then
**Project settings**, then **API**. The JWT secret is on that page, behind a
**Reveal** button. Some projects show it under a **JWT keys** heading on the
same settings menu; either way it is the one called the JWT secret, and it is a
single long line.

**What it is for.** Proving a sign-in was issued by the practice's own project
and not by someone else.

Paste it as `SUPABASE_JWT_SECRET`.

### Step 2 — `SUPABASE_STORAGE_KEY`

**Where it comes from.** The same page. Look for the key called
**service_role** — the one the page itself marks as secret, with a warning that
it bypasses the row rules. Reveal it and copy it.

**What it is for.** Filing the practice's documents in its private bucket. Only
this process ever holds it; a browser never does.

Paste it as `SUPABASE_STORAGE_KEY`.

**The one mistake worth naming.** The **anon** or **publishable** key sits
beside it on the same page and looks similar. That one is public and belongs in
`VITE_SUPABASE_ANON_KEY`, which section 1 shows is already set. If you paste
the anon key here, documents fail with a permission error rather than an
obvious one.

### Step 3 — `SUPABASE_AUTH_ADMIN_KEY`

**Where it comes from.** The same **service_role** key as step 2. The same
value, pasted a second time under a second name.

**What it is for.** Issuing a household's invitation to the client portal. It
has its own name because it is its own job: if the practice ever wants the two
separated, they can be, and until then nothing has to be guessed about which
job a key is doing.

Paste it as `SUPABASE_AUTH_ADMIN_KEY`.

### Step 4 — `API_DATABASE_URL`

This one has two halves: setting a password on the database account the
platform uses, and then writing the address that uses it.

**Why the platform has its own database account.** It is called
`mcwellness_api`, the migrations created it, and it owns nothing and can bypass
nothing — every request it makes runs inside the same fence a household's rows
sit behind. It was created **without** a password on purpose, so that no
password has ever existed in the code. You are giving it one now.

**4a. Set the password.** In the Supabase dashboard, open the **SQL editor**,
and run this one line with a long password of your own in place of the words
in angle brackets:

```sql
alter role mcwellness_api with password '<the password you chose>';
```

Choose it the way the password manager would: long, random, and not typed
anywhere else. Save it in the password manager now — Supabase will not show it
to you again, and if it is lost you simply run the line again with a new one.

**4b. Write the address.** In the Supabase dashboard, **Project settings**,
then **Database**, then **Connection string**. Take the **transaction pooler**
form, the one on port **6543** — not the direct connection on 5432. It looks
like this, and the two parts you replace are the project's own reference and
the password you just set:

```
postgresql://mcwellness_api.<ref>:<the password you chose>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

The user name is the platform's account, a full stop, and the project
reference: the dashboard's own connection string shows this shape with
`postgres` where `mcwellness_api` belongs, so change that word and leave the
rest of the shape alone. The region is the project's, `ap-south-1` for Mumbai.

Paste the finished line as `API_DATABASE_URL`.

**If you get it wrong, the API says so plainly.** It refuses at startup to
connect as any account but `mcwellness_api`, and names what it was given
instead. That refusal is the guard working, not a fault.

### Step 5 — `IDENTITY_KEY`

**Where it comes from.** Nowhere. You make it, once, on your own machine. In
the Terminal:

```bash
openssl rand -hex 32
```

That prints one line of 64 characters. That line is the value.

**What it is for.** It is the key behind the fingerprint the platform keeps of
an Emirates ID number, so that a number can be recognised without being stored
in a readable form.

**Read this part twice.** Keep a copy in the password manager before you paste
it. It must be this system's own — never the staging one's — and it must not be
changed later: the sealed identity values already recorded can only be read
back with the key that sealed them, so replacing it silently orphans them.

Paste it as `IDENTITY_KEY`.

### Step 6 — `GOOGLE_MAPS_API_KEY`

**Where it comes from.** The Google Cloud console, the practice's project,
then **APIs and services**, then **Credentials**. The key is named
**McWellness desk and platform server**. Copy it with the copy button beside
it.

**What it is for.** Drive estimates between visits and the small map on the
day's screen. What Google receives is coordinates and nothing else — never a
name, a record number or an address.

Paste it as `GOOGLE_MAPS_API_KEY`.

**If that key does not exist yet**, leave this one out and change
`ROUTING_PROVIDER` from `google` to `straight-line` in the list from section 1.
The day's screen then estimates in straight lines and says so on the screen.
Nothing else is affected, and this is the one item here that can be finished
next week (`docs/OPERATOR/2026-09-06-decisions.md` section 1.8).

### Step 7 — `GOOGLE_MAPS_SIGNING_SECRET`, only if it exists

Some Google projects issue a second value, a **URL signing secret**, on the
same credentials page. If the practice's project has one, paste it as
`GOOGLE_MAPS_SIGNING_SECRET`. If it does not, skip this step entirely: do not
add the name with an empty value.

### Step 8 — Save, and wait

Press **Save**. The site restarts itself, which takes a few seconds to a
minute. Do not reload the address repeatedly while it restarts; give it a
minute and then go to section 3.

---

## 3. The three checks, in this order

### Check one: the process is running

Open `https://app.mcwellnessuae.com/api/health` in a browser.

**Good:** `{"ok":true,"service":"mcwellness-api"}`.

**Not good:** anything else, including a Hostinger error page or a page that
never loads. That means the process did not start. The reason is in the
hosting panel under the site's **Node.js** section, in the runtime log, and it
is almost always the name of the setting that is missing or misspelt — the API
refuses to start without one rather than starting half-configured. Fix that
name and save again.

### Check two: the database is reachable

Open `https://app.mcwellnessuae.com/api/health/deep`.

**Good:** `{"ok":true}`.

**Not good:** `{"ok":false}`. The process is running but cannot reach the
database, which points at step 4 — the password, the pooler form, or the port.
The answer is deliberately just those few characters: a stranger learns whether
the practice's system is working and nothing about how it is built. The reason,
in more detail, is in the runtime log.

### Check three: one signed-in request, and the proxy count

Sign in at `https://app.mcwellnessuae.com` with the login you make in section 4,
and open one ordinary screen — the day's list is enough.

Then the measurement, which needs the integrator beside you for two minutes,
because nothing on a screen shows it. `TRUSTED_PROXY_HOPS` tells the API how
many of Hostinger's machines stand between it and the person calling. Hostinger
terminates the encryption and fronts the site with its own delivery network, so
the number is **at least one**, and it is read from what the API actually
receives rather than assumed (`docs/SPEC/hosting.md` section 2.3).

- **Right:** the address the API counts the request against is the caller's own
  public address — the one a "what is my IP address" page shows you.
- **Too low:** the API sees a Hostinger address instead, and then every caller
  in the country shares one allowance. One household's phone could exhaust the
  budget for everybody.
- **Too high:** the API believes an address the caller could have written
  themselves, which lets a determined caller choose their own allowance.

Set it to what was measured, save, and note the number and the date in this
file. If it turns out not to be `1`, that is worth knowing rather than
worrying about.

---

## 4. Your own login

Two halves: the account, which is yours, and the person in the practice's
records that the account is joined to.

1. **Make the account.** In the Supabase dashboard, production project, open
   **Authentication**, then **Users**, then **Invite user**, and type your own
   working email address. You will get an email; follow it and set a password
   you choose. Turn on the second factor when it is offered — this account can
   see every household.
2. **Join it to your person in the practice's records.** Supabase gives the new
   account an identifier. Your owner row in the platform is joined to it by
   that identifier, and that is the join that makes the account *you* rather
   than a stranger with a password. It is one line in the SQL editor, exactly
   as staging does it (`docs/STAGING.md` section 4), and the integrator runs it
   with you, because on a brand-new system the practice's own rows — the
   practice, and you in it — are created as part of setting it up rather than
   by this file.
3. **The walk that proves it** (`docs/STAGING.md` section 7). Sign in as
   yourself, open a client, and see the timeline. Then sign in as a
   practitioner and see their own day. If both are true, the system is
   genuinely working and not merely answering.

Never make an account with an identifier copied from the repository. The
practice's own records point at accounts, never the other way round.

---

## 4a. The practice's own brand on its documents

The invoice and the receipt carry the practice's logo at the top and its
telephone number, email address and website in the band at the foot of the page
(`docs/SPEC/billing.md` section 5.6). None of the four is in this repository:
they are the practice's own row, set once against a live environment.

The logo can be replaced from **Settings → Practice** in the console, by an
owner or an admin. The three contact fields have no screen yet
(`docs/CHANGE-REQUESTS/billing-09.md` item 6), so both are set with one script:

```bash
node scripts/practice-brand.mjs https://app.mcwellnessuae.com "<bearer token>" ~/Documents/mcwellness-logo.png \
  --phone "+971 55 586 4039" --email info@mcwellnessuae.com --website https://mcwellnessuae.com/
```

- The **bearer token** is the one a signed-in owner's browser holds. Take it
  from the console's own session; it is short-lived and belongs in no file.
- The **logo** is a PNG or a JPEG under 500 KB. Only a PNG is drawn onto a
  document — truecolour or greyscale, eight bits, not interlaced, no alpha
  channel — and a file the writer cannot embed leaves the wordmark set in type
  at the top of the page rather than a gap. Export it against a white
  background.
- Every flag is optional and nothing is cleared: run it with a file alone to
  replace the mark, or with the flags alone to change the footer.

Two things follow, and both are deliberate:

- **Documents already filed keep the mark they were filed with.** The logo is
  drawn as it is today, so a re-render of last year's invoice would carry this
  year's mark — which is why the platform never replaces a document it has
  already filed. Nothing about what a document *states* changes: the legal
  name, the address and the registrations are snapshotted onto the invoice at
  numbering time and read back from it for ever.
- **The contact details are snapshotted too**, so changing the telephone number
  changes the documents issued from that moment and no earlier one.

Check it by opening one invoice in the console and pressing the link.

## 5. If the site goes to sleep

The thing to watch for in the first fortnight: the deep check
(`/api/health/deep`) taking several seconds, or failing, after nobody has used
the platform for a while — and then being fine once somebody has. A first
screen of the morning that hangs and then behaves for the rest of the day is
the same symptom.

That is the platform's process being stopped when idle and started again on
demand. It is not a fault to fix in the code: it means the hosting product
underneath does not keep one process running, which the platform needs — it
holds its database connections warm and keeps its own rate-limit counters in
its memory.

**The answer** is Hostinger's **Web Apps Hosting** product on this same
account, in Mumbai beside the database. That is decision 1 in
`docs/OPERATOR/2026-09-06-decisions.md`, with what it costs. Moving to it
changes nothing in this file: the same settings, the same seven values, the
same checks.

---

## 6. What this hand deploy skipped, and where it was run instead

When a release is made the ordinary way, pushing a version tag runs two gates
before anything reaches the practice's system
(`.github/workflows/release.yml`). This first deployment was made by hand, so
those two gates did not run there. They were run on the builder's machine
instead, on the same revision, and this is the record of it.

| The gate | What it is for | Run | Result |
| --- | --- | --- | --- |
| `pnpm verify` | Formatting, lint, types, the secrets scan, the migration audit, and the whole test suite | 6 September 2026, on the branch this deployment was built from | Green: 1,853 tests in 169 files; the secrets scan read 1,258 tracked files and found nothing that looks like a secret; 71 migrations unedited since merge |
| `pnpm audit:deps` with `AUDIT_DEPS_STRICT=true` | Known high or critical advisories against anything the running system depends on. Strict means an unreachable advisory service fails too, rather than being excused | The same day, the same revision | Green: no high or critical advisory applies to a production dependency |

Two things follow. Every deployment after this one should go through the tag,
so the gates run where they belong and a person still approves the release.
And the deep security scan of `docs/OPERATOR/2026-09-06-decisions.md` section
1.9 has still not been run against a release revision; it is not one of the two
above and this file does not stand in for it.

---

## What this file is not

It is not the restore procedure — that is `docs/RUNBOOK/restore.md`, and it is
worth reading once before it is needed rather than for the first time during
an incident.

---

## 7. What the first deploy taught (7 September 2026)

Facts about Hostinger that this file could not know until the process ran,
each of which cost an hour to find. `docs/PRODUCTION.md`, "the first live
pass", has the evidence.

- **The site must be its own website.** A Node.js web app is added under
  Websites, Add Website, Deploy Web App — as a new website, never as a
  subdomain folder of an existing site. The folder kind builds and never runs.
- **Output directory: `.`** — the app root, because the API serves the built
  screens itself. Naming `dist` deploys nothing and the address answers the
  web server's own 404.
- **Entry file: `app/api/start.mjs`**, which also restores the execute bit the
  host strips from the TypeScript loader's helper program (pull request 106).
- **`PORT` is not needed.** The host intercepts the listen call; the log
  prints the port as `undefined`, and that is normal here.
- **`SUPABASE_JWT_SECRET` is not needed** while the project signs with its
  ES256 key; the JWKS address covers sign-ins.
- **The process sleeps when idle** and starts on the next request, in about a
  second. Section 5 describes the symptom and the product that keeps a process
  running, if the practice ever wants it.
- **The seven values can be placed by a script** with the two API tokens the
  laptop already holds: `Documents/tools/go-live.py` (outside the repository),
  `--check` first, then the real run; `--env-only` re-sends the saved file.
  Nothing it does prints a value.
