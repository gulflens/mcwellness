---
paths: ["domain/**", "tests/**"]
---
# Testing rules
- `domain/` functions are pure: no I/O, no Date.now() (inject `now`), no randomness (inject).
- Every rule in a spec's "Rules" section has a test file named after the function, covering every branch listed and every "Done when" item.
- Property-based test for `replayEvents` (session) and `checkConflicts` (scheduling).
- Fixtures come from `db/seed/` generators only. Never hand-write a person's name, ID or phone number in a test.
- Test names read as requirements: `it('blocks check-in when participation consent is withdrawn')`.
