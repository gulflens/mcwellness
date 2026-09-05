import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { formatFils } from '../../../domain/shared';
import {
  CONSENT_STATUS,
  DELIVERY,
  PAYMENT_METHOD,
  PHRASES,
  PURPOSES,
  RELATIONSHIPS,
  WORDS,
  say,
  sayFrom,
  type Locale,
  type Phrase,
  type WordKey,
} from './dictionary';

export {
  CONSENT_STATUS,
  DELIVERY,
  PAYMENT_METHOD,
  PHRASES,
  PURPOSES,
  RELATIONSHIPS,
  WORDS,
  say,
  sayFrom,
} from './dictionary';
export type { Locale, Phrase, WordKey } from './dictionary';

/**
 * The portal's language, and everything that depends on it
 * (docs/SPEC/client-portal.md section 3).
 *
 * **Where the choice comes from, in order.** The person's own
 * `preferred_locale`, which the practice set from the client's record when it
 * invited them and which `/api/me` now carries; then whatever they last chose
 * in this browser. The choice is deliberately *not* saved on the server (the
 * spec's section 12): a household reading English on a laptop and Arabic on a
 * phone is a household, not a preference to be reconciled.
 *
 * **`dir` and `lang` are set on the portal's own root**, so the Arabic edition
 * is a mirrored layout rather than a flipped English one: every rule in
 * `portal.css` is written in logical properties, and the browser does the
 * mirroring itself once the direction is declared.
 *
 * **Dates and times are the practice's**, in the person's language. A visit at
 * ten in Dubai is at ten whoever is reading and wherever they are, so the time
 * zone comes off the tenant row and never off the browser.
 */

const STORAGE_KEY = 'mcwellness.portal.locale';

type LanguageValue = {
  locale: Locale;
  setLocale(locale: Locale): void;
  /** The practice's own time zone, for every date and time on every screen. */
  timezone: string;
  setTimezone(timezone: string): void;
};

const LanguageCtx = createContext<LanguageValue | null>(null);

/** What the browser remembers, when it remembers anything. */
function remembered(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'en' || value === 'ar' ? value : null;
  } catch {
    // A browser with storage switched off is a browser that reads English, or
    // whatever the person's own record says. Never a reason to fail.
    return null;
  }
}

export function PortalLanguage({
  children,
  initial = 'en',
  timezone: initialTimezone = 'Asia/Dubai',
}: {
  children: ReactNode;
  /** The person's own `preferred_locale`, from `/api/me`. */
  initial?: Locale;
  timezone?: string;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => remembered() ?? initial);
  const [timezone, setTimezone] = useState(initialTimezone);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Nothing to do: the choice holds for this visit and is not remembered.
    }
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale, timezone, setTimezone }),
    [locale, setLocale, timezone],
  );
  return <LanguageCtx.Provider value={value}>{children}</LanguageCtx.Provider>;
}

export function usePortalLanguage(): LanguageValue {
  const value = useContext(LanguageCtx);
  if (!value) throw new Error('usePortalLanguage needs a PortalLanguage above it.');
  return value;
}

export type Words = {
  locale: Locale;
  /** One word from the dictionary. */
  t(key: WordKey): string;
  /** One phrase that carries a value. */
  phrase(phrase: Phrase): string;
  purpose(purpose: string): string;
  relationship(relationship: string): string;
  delivery(mode: string): string;
  consentStatus(status: string): string;
  paymentMethod(method: string): string;
  /** A date in the practice's own day, written in the person's language. */
  date(iso: string): string;
  /** A time of day, the same way. */
  time(iso: string): string;
  /** An arrival window, both ends, in the reader's own order. */
  window(startIso: string, endIso: string): string;
  /** Money: integer fils through the one formatter, and nowhere else. */
  money(amountFils: number): string;
};

/** BCP 47 for the two editions, so Intl formats each properly. */
const INTL_LOCALE: Record<Locale, string> = { en: 'en-GB', ar: 'ar-AE' };

export function useWords(): Words {
  const { locale, timezone } = usePortalLanguage();

  return useMemo(() => {
    const dateFormat = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timeFormat = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return {
      locale,
      t: (key: WordKey) => say(WORDS[key], locale),
      phrase: (phrase: Phrase) => say(phrase, locale),
      purpose: (purpose: string) => sayFrom(PURPOSES, purpose, locale),
      relationship: (relationship: string) => sayFrom(RELATIONSHIPS, relationship, locale),
      delivery: (mode: string) => sayFrom(DELIVERY, mode, locale),
      consentStatus: (status: string) => sayFrom(CONSENT_STATUS, status, locale),
      paymentMethod: (method: string) => sayFrom(PAYMENT_METHOD, method, locale),
      // A date-only value is read at the practice's own midnight, not UTC's.
      date: (iso: string) =>
        dateFormat.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)),
      time: (iso: string) => timeFormat.format(new Date(iso)),
      window: (startIso: string, endIso: string) =>
        say(
          PHRASES.windowFromTo(
            timeFormat.format(new Date(startIso)),
            timeFormat.format(new Date(endIso)),
          ),
          locale,
        ),
      // The one formatter in this codebase (domain/shared/fils.ts). The
      // currency is named once, by the column header or the label, never
      // repeated on every row (docs/DESIGN-BRIEF.md).
      money: (amountFils: number) => formatFils(amountFils),
    };
  }, [locale, timezone]);
}
