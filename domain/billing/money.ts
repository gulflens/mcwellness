import { formatFils } from '../shared/fils';

/**
 * Money is displayed in exactly one place (CLAUDE.md's "Money" rule: doubles
 * are banned for money everywhere; there is one formatter).
 *
 * That place is now `domain/shared/fils.ts`, beside the `Fils` type itself.
 * It stood here while the rendered invoice and the admin screens were the two
 * things showing money — a PDF is drawn by pure code that cannot reach into
 * `app/`, so the domain was the only home they shared. Then the
 * practitioner's stop card and the session's parking field wanted it too, and
 * `docs/SPEC/OWNERSHIP.md` rule 3 says a module never imports another
 * module's `domain/`: two streams duplicated the arithmetic rather than
 * import billing's (`docs/CHANGE-REQUESTS/scheduling-04.md` section 4,
 * `session-capture-02.md`). In `domain/shared` it is importable by everyone
 * and nobody has to think about this again.
 *
 * Re-exported here so billing's own callers — `domain/billing/document/render.ts`
 * and everything through the `@domain/billing` barrel — keep their import.
 */
export { formatFils };
