import { useRef } from 'react';

/**
 * One idempotency key per *request*, not per drawer.
 *
 * The key exists so a straight retry — the button tapped twice, a lost
 * response, a phone that changed network — replays the first answer instead
 * of writing a second sale or a second payment into tables that grant no
 * delete. Minting it once when the drawer opens got that half right and the
 * other half wrong: a coordinator who typed 500, was told the amount was
 * refused, corrected it to 5,000 and pressed again would have sent the
 * corrected amount under the first attempt's key, and been handed back the
 * 500 the server had already recorded.
 *
 * So the key belongs to what is being sent, not to the drawer that is open.
 * `keyFor` takes a signature of the request and returns the same key while
 * that signature holds, and a fresh one the moment any of it changes.
 */
export function useAttemptKey(): (signature: string) => string {
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return (signature: string) => {
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    return attempt.current.key;
  };
}
