import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The practice's consent wording, read from docs/CONSENT (its README explains
 * why they are files rather than rows): one markdown document per purpose per
 * language, each with front matter naming the purpose, the language, the
 * version and whether the lawyer has approved it.
 *
 * These are the real texts, not synthetic ones — a wording is the practice's
 * own words, and a person signs the version they were shown — so the seed
 * files them as they are, fingerprints them, and writes the bytes through the
 * storage seam. Reading them here keeps the seed deterministic: the same
 * files give the same rows, byte for byte.
 */

export type ConsentTextLocale = 'en' | 'ar';
export type ConsentTextStatus = 'draft' | 'approved';

export type ConsentText = {
  /** The file's own name, for a message that has to name one. */
  file: string;
  purpose: string;
  locale: ConsentTextLocale;
  version: string;
  status: ConsentTextStatus;
  /** The whole file, front matter included: what was hashed is what is stored. */
  bytes: Buffer;
  sha256Hex: string;
};

export const CONSENT_TEXT_MIME_TYPE = 'text/markdown';
const CONSENT_DIR = new URL('../../docs/CONSENT/', import.meta.url);
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** One `key: value` line of front matter. Values are plain scalars; nothing here needs YAML. */
function frontMatter(text: string, file: string): Record<string, string> {
  const match = FRONT_MATTER.exec(text);
  if (!match?.[1]) {
    throw new Error(
      `${file} has no front matter; a consent wording needs purpose, locale, version and status.`,
    );
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
}

function required(fields: Record<string, string>, name: string, file: string): string {
  const value = fields[name];
  if (!value) throw new Error(`${file} has no "${name}" in its front matter.`);
  return value;
}

/**
 * Every wording file, in a fixed order: purpose then language, so the seed's
 * document ids are the same on every machine and every run.
 */
export function loadConsentTexts(): ConsentText[] {
  const dir = fileURLToPath(CONSENT_DIR);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();
  const texts: ConsentText[] = files.map((file): ConsentText => {
    const bytes = readFileSync(fileURLToPath(new URL(file, CONSENT_DIR)));
    const fields = frontMatter(bytes.toString('utf8'), file);
    const locale = required(fields, 'locale', file);
    const status = required(fields, 'status', file);
    if (locale !== 'en' && locale !== 'ar') {
      throw new Error(`${file} has locale "${locale}"; the practice publishes English and Arabic.`);
    }
    if (status !== 'draft' && status !== 'approved') {
      throw new Error(`${file} has status "${status}"; a wording is draft or approved.`);
    }
    return {
      file,
      purpose: required(fields, 'purpose', file),
      locale,
      status,
      version: required(fields, 'version', file),
      bytes,
      sha256Hex: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  if (texts.length === 0) {
    throw new Error(
      "docs/CONSENT holds no wording files; the seed cannot file the practice's consents.",
    );
  }
  // Two files claiming the same purpose, language and version would be two
  // different texts a consent row could not tell apart. The database refuses
  // it too (migration 902); saying so here names the file.
  const seen = new Set<string>();
  for (const text of texts) {
    const identity = `${text.purpose}/${text.locale}/${text.version}`;
    if (seen.has(identity)) {
      throw new Error(
        `Two wording files claim ${identity}; a version exists once. See ${text.file}.`,
      );
    }
    seen.add(identity);
  }
  return texts;
}
