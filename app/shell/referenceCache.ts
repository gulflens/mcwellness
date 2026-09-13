/**
 * A per-session cache for reference data: the service types, the VAT rate,
 * the goal categories, the kit options, the choices a booking offers.
 *
 * **Why.** Every API call costs a round trip to a host in Europe plus the
 * server's own floor (measured 2026-09-14: about 0.15 s on the server for a
 * list, and the network on top), and a drawer that fetches two or three
 * reference lists on every open waits for all of them before its form is
 * usable. None of those lists changes between one open and the next, so the
 * second open should cost nothing — and it did not, only because nothing
 * remembered the first.
 *
 * **What it does.** One entry per address, holding the promise of the answer,
 * so two callers asking at once share one request and a caller asking again
 * within the window gets the answer already in hand. Entries expire after
 * `REFERENCE_TTL`, and the whole cache is forgotten on any write and on
 * sign-out (app/shell/auth/AuthContext.tsx) — a write is the one thing that
 * can make a reference list stale, and a sign-out is a different person.
 *
 * **What it deliberately does not do.** It caches only what a caller asks it
 * to; nothing about `apiFetch` itself changes. Personal data never enters it:
 * every address here names a catalogue the practice owns, not a household.
 */

export const REFERENCE_TTL = 5 * 60_000;

export type ReferenceAnswer =
  { ok: true; status: number; body: unknown } | { ok: false; status: number };

type Entry = { at: number; generation: number; answer: Promise<ReferenceAnswer> };
type Fetcher = (path: string) => Promise<Response>;

/**
 * Keyed by the fetcher first and the address second.
 *
 * `apiFetch` is one function for the life of the page — the auth provider is
 * mounted once (app/shell/main.tsx) and does not remount at sign-out — so the
 * fetcher does NOT change between one person and the next on the same device.
 * What keeps their lists apart is the forgetting: `forgetReferences()` runs
 * on every sign-out, the voluntary one and the one a 401 forces
 * (app/shell/auth/AuthContext.tsx). The fetcher key earns its place elsewhere:
 * a test that hands each render its own fetch never sees another case's
 * answers, and a provider that is remounted starts empty. A WeakMap, so a
 * fetcher that is gone takes its entries with it.
 */
const byFetcher = new WeakMap<Fetcher, Map<string, Entry>>();

/**
 * Bumped by `forgetReferences`. A WeakMap cannot be walked, so rather than
 * clearing every map the generation moves on and every entry from before it
 * reads as expired.
 */
let generation = 0;
let held = 0;

/** Injectable, so the tests can move time without waiting through it. */
let now = () => Date.now();

export function readReference(
  fetchImpl: Fetcher,
  path: string,
  ttl = REFERENCE_TTL,
): Promise<ReferenceAnswer> {
  let entries = byFetcher.get(fetchImpl);
  if (!entries) {
    entries = new Map();
    byFetcher.set(fetchImpl, entries);
  }
  const cached = entries.get(path);
  if (cached && cached.generation === generation && now() - cached.at < ttl) {
    return cached.answer;
  }
  const mine = entries;
  const answer = fetchImpl(path)
    .then(async (res): Promise<ReferenceAnswer> => {
      if (!res.ok) {
        // A failure is not remembered: the next open asks again, which is
        // what a person retrying would expect.
        mine.delete(path);
        held = Math.max(0, held - 1);
        return { ok: false, status: res.status };
      }
      return { ok: true, status: res.status, body: await res.json() };
    })
    .catch((error: unknown) => {
      mine.delete(path);
      held = Math.max(0, held - 1);
      throw error;
    });
  const before = mine.get(path);
  if (!before || before.generation !== generation) held += 1;
  mine.set(path, { at: now(), generation, answer });
  return answer;
}

/** Everything, at once: after a write, and at sign-out. */
export function forgetReferences(): void {
  generation += 1;
  held = 0;
}

/**
 * How many addresses have been remembered since the last forgetting; for
 * tests, and for nothing else. An estimate, because a WeakMap cannot be
 * counted: it climbs on a new address and falls to zero on a forgetting.
 */
export function referenceCount(): number {
  return held;
}

/** Tests only. */
export function setReferenceClock(clock: () => number): void {
  now = clock;
}
