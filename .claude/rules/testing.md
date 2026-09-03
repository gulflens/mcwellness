---
paths: ["domain/**", "tests/**"]
---
# Testing rules
- `domain/` functions are pure: no I/O, no Date.now() (inject `now`), no randomness (inject).
- Every rule in a spec's "Rules" section has a test file named after the function, covering every branch listed and every "Done when" item.
- Property-based test for `replayEvents` (session) and `checkConflicts` (scheduling).
- Fixtures come from `db/seed/` generators only. Never hand-write a person's name, ID or phone number in a test.
- Test names read as requirements: `it('blocks check-in when participation consent is withdrawn')`.
- The reserved fake ranges, enforced by `.claude/hooks/no-real-identifiers.sh` and by the
  generator's own tests: Emirates IDs `784-1900-*`; phones `+971 50 000 xxxx` (the seed uses
  `1xxx`, hand-written test fixtures `00xx`); emails at `example.com`; names only from
  `db/seed/names.ts`; ids of the form `0000000K-0000-4000-8000-*` or, for a two-character kind such as the billing catalogue's `d0` to `d3`, `000000KK-0000-4000-8000-*`. `generateSeed()` in
  `db/seed/generate.ts` is the fixture source; `applySeed()` writes it.
