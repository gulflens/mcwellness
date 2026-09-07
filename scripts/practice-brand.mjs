import { readFile } from 'node:fs/promises';

// Puts the practice's brand on its own documents: the logo at the top of every
// invoice and receipt, and the telephone number, email address and website in
// the footer band (docs/SPEC/billing.md section 5.6, migrations 909 and 912).
//
//   node scripts/practice-brand.mjs <base-url> <bearer-token> [logo.png] \
//     [--phone "+971 ..."] [--email hello@example.com] [--website https://example.com]
//
// Everything is optional but the base URL and the token: run it with a file
// alone to replace the mark, with the three flags alone to change the footer,
// or with all of them to do both. Nothing is deleted — omitting a flag leaves
// that field exactly as it is.
//
// **Why a script and not a screen.** The settings page can already replace the
// logo (`app/admin/settings/PracticeLogo.tsx`); it cannot yet edit the three
// contact fields, and that page is the trunk's rather than this stream's. Until
// a trunk round adds them, this is how they are set
// (docs/CHANGE-REQUESTS/billing-09.md item 6).
//
// It goes through the API and never near the database, so every rule that
// guards these facts — an owner or an admin only, the media type and the size
// of a logo, the audit trail — is the one the practice's own screens obey.
//
// Nothing here prints the token, and nothing writes it anywhere.

const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function usage(message) {
  console.error(`${message}

  node scripts/practice-brand.mjs <base-url> <bearer-token> [logo.png] \\
    [--phone "+971 50 000 0000"] [--email hello@example.com] [--website https://example.com]`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let at = 0; at < args.length; at += 1) {
  const arg = args[at];
  if (arg.startsWith('--')) {
    const value = args[at + 1];
    if (value === undefined) usage(`${arg} needs a value.`);
    flags[arg.slice(2)] = value;
    at += 1;
  } else {
    positional.push(arg);
  }
}

const [baseUrl, token, logoPath] = positional;
if (!baseUrl || !token) usage('A base URL and a bearer token are both needed.');
const known = ['phone', 'email', 'website'];
for (const name of Object.keys(flags)) {
  if (!known.includes(name)) usage(`I do not know the flag --${name}.`);
}
if (!logoPath && Object.keys(flags).length === 0) {
  usage('Give a logo file, or one of --phone, --email and --website, or both.');
}

const base = baseUrl.replace(/\/+$/, '');

/** One call, with the reason header the practice's own screens send. */
async function call(path, init = {}) {
  const response = await globalThis.fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // PATCH /api/practice insists on a reason: what it changes is what a tax
      // invoice states the supplier is, and somebody may have to account for it.
      'x-reason': "Setting the practice's brand on its own documents.",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // The status and the API's own error code. Never the token, and never a
    // header: this output goes into a terminal somebody may paste from.
    throw new Error(
      `${init.method ?? 'GET'} ${path} answered ${response.status}. ${body.slice(0, 200)}`,
    );
  }
  return response;
}

try {
  if (logoPath) {
    const extension = logoPath.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = LOGO_TYPES[extension];
    if (!mimeType) {
      throw new Error(`A logo is a PNG or a JPEG; ${logoPath} is neither.`);
    }
    const bytes = await readFile(logoPath);
    await call('/api/practice/logo', {
      method: 'POST',
      body: JSON.stringify({ mimeType, bytesBase64: bytes.toString('base64') }),
    });
    console.log(
      `Filed ${logoPath} as the practice's logo (${bytes.byteLength} bytes, ${mimeType}).`,
    );
    console.log('Every document rendered from now on carries it; those already filed keep theirs.');
  }

  const contact = {};
  if (flags.phone !== undefined) contact.contactPhone = flags.phone;
  if (flags.email !== undefined) contact.contactEmail = flags.email;
  if (flags.website !== undefined) contact.website = flags.website;

  if (Object.keys(contact).length > 0) {
    // `PATCH /api/practice` takes the whole form at once, on purpose: the VAT
    // switch and its number have to arrive together or the pair can be left
    // half-recorded (app/api/practice/schema.ts). So the current form is read
    // back and sent again with the three fields changed, exactly as the
    // settings screen does — nothing else about the practice moves.
    const { practice } = await (await call('/api/practice')).json();
    await call('/api/practice', {
      method: 'PATCH',
      body: JSON.stringify({
        legalName: practice.legalName,
        legalNameAr: practice.legalNameAr,
        taxRegistrationNumber: practice.taxRegistrationNumber,
        licenceNumber: practice.licenceNumber,
        licensingAuthority: practice.licensingAuthority,
        licenceExpiresOn: practice.licenceExpiresOn,
        vatRegistered: practice.vatRegistered,
        vatTrn: practice.vatTrn,
        whatsappNumber: practice.whatsappNumber,
        address: practice.address,
        ...contact,
      }),
    });
    for (const [field, value] of Object.entries(contact)) {
      console.log(`Set ${field} to ${value}.`);
    }
    console.log('These are snapshotted onto each invoice as it is numbered, never read back.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
