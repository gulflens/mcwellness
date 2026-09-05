import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_STATUS,
  DELIVERY,
  PAYMENT_METHOD,
  PHRASES,
  PURPOSES,
  RELATIONSHIPS,
  WORDS,
  type Phrase,
} from '../../app/client/i18n/dictionary';

/**
 * The dictionary is the portal's whole vocabulary
 * (docs/SPEC/client-portal.md sections 3 and 4): every string on every screen
 * exists in both languages, and a hardcoded sentence under `app/client/` fails
 * review.
 *
 * The second half of that is a rule nobody can hold in their head, so it is
 * checked mechanically here: the screens are read as text and any run of Latin
 * words long enough to be a sentence is reported. The dictionary itself is
 * exempt, because it is where the sentences live.
 */

const CLIENT_DIR = join(process.cwd(), 'app', 'client');

function everyPhrase(): [string, Phrase][] {
  return [
    ...Object.entries(WORDS),
    ...Object.entries(PURPOSES),
    ...Object.entries(RELATIONSHIPS),
    ...Object.entries(DELIVERY),
    ...Object.entries(CONSENT_STATUS),
    ...Object.entries(PAYMENT_METHOD),
  ];
}

/** Every .tsx and .ts under app/client, except the dictionary itself. */
function screenFiles(dir = CLIENT_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return screenFiles(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (path.endsWith(join('i18n', 'dictionary.ts'))) return [];
    return [path];
  });
}

describe('the dictionary', () => {
  it('has both languages for every word, and neither is the other', () => {
    for (const [key, phrase] of everyPhrase()) {
      expect(phrase.en.trim().length, key).toBeGreaterThan(0);
      expect(phrase.ar.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('writes the Arabic in Arabic', () => {
    // Every Arabic half carries at least one Arabic letter. The trap this
    // catches is a copy-paste that leaves the English standing in both.
    const arabicLetter = /[؀-ۿ]/;
    for (const [key, phrase] of everyPhrase()) {
      expect(arabicLetter.test(phrase.ar), key).toBe(true);
    }
  });

  it('has both languages for the phrases that carry a value', () => {
    const sample = [
      PHRASES.sessionOf(1, 15),
      PHRASES.windowFromTo('10:00', '10:45'),
      PHRASES.greeting('Hazel'),
    ];
    for (const phrase of sample) {
      expect(phrase.en.trim().length).toBeGreaterThan(0);
      expect(phrase.ar.trim().length).toBeGreaterThan(0);
    }
    expect(PHRASES.sessionOf(1, 15).en).toBe('Session 1 of 15');
  });

  it('carries no emoji, in either language', () => {
    // The house rule, and the one place a stray one would reach a household.
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [key, phrase] of everyPhrase()) {
      expect(emoji.test(phrase.en), key).toBe(false);
      expect(emoji.test(phrase.ar), key).toBe(false);
    }
  });

  it('says nothing medical: the client has goals and sessions', () => {
    const clinical = /\b(patient|diagnos|treatment|therapy|condition|cure|prescrib)/i;
    for (const [key, phrase] of everyPhrase()) {
      expect(clinical.test(phrase.en), key).toBe(false);
    }
  });
});

describe('the screens', () => {
  it('hold no sentence of their own: every word comes from the dictionary', () => {
    // A JSX text node of three or more Latin words, or a quoted string of the
    // same, that is not a class name, an import path or an aria role.
    const sentence = /(?:^|[>{'"`])\s*([A-Z][a-z]+(?: [a-z]{2,}){2,}[.,!?]?)\s*(?:[<}'"`]|$)/gm;
    const offenders: string[] = [];

    for (const file of screenFiles()) {
      const source = readFileSync(file, 'utf8');
      // Comments are prose about the code, not copy on a screen.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const match of code.matchAll(sentence)) {
        const text = match[1] ?? '';
        offenders.push(`${file.replace(process.cwd(), '')}: ${text}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('holds no colour literal and no physical CSS property', () => {
    const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    // The four the brief bans: a portal that used them would not mirror.
    const physical =
      /(?:^|[\s{;])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right|text-align:\s*(?:left|right))\s*:/;
    const css = readFileSync(join(CLIENT_DIR, 'portal.css'), 'utf8');
    expect(colour.test(css)).toBe(false);
    expect(physical.test(css)).toBe(false);
  });
});
