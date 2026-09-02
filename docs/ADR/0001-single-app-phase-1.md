# ADR 0001 — Single TypeScript app for Phase 1
Decision: one React app (three role areas, therapist as PWA), Node API routes, PostgreSQL + Supabase (hosting amended by ADR 0003), pg-boss jobs. Deferred: NestJS, React Native, Python workers, Redis, Timescale, monorepo tooling.
Why: solo non-technical owner driving Claude Code; first paid session in under 3 months. Fewer deployables, fewer failure modes. Every deferred piece has a clean attach point.
