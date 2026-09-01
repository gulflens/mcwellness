# ADR 0002 — Session capture uses a single-writer outbox, not a sync engine
Decision: a session has one author (the practitioner on one device during one visit). Writes are append-only events in IndexedDB, flushed idempotently when online; the server projects events into the session row. Read data is cache-only on device.
Why: removes conflict resolution entirely. See docs/SPEC/session-capture.md §2.
