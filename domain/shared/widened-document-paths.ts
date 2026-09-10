/**
 * The two documents the API serves with a widened content security policy
 * (`MAP_DOCUMENT_PATHS`, `app/api/_middleware/security.ts`, docs/SPEC/
 * route-planning.md section 8) and that the practitioner app's service
 * worker must never write into the offline shell cache (`app/shell/sw.ts`'s
 * own rule 1: one visit to a widened document would make it every later
 * offline navigation's shell — the review of pull request 121, finding B2).
 *
 * One list, imported by both, rather than two hand-kept copies: a third
 * widened document added to one and not the other would be served widened
 * *and* cached as the offline shell, with no test failing, because nothing
 * compared the two (the whole-branch review of trunk round 43, finding 4 —
 * this branch doubled the list from one entry to two and so doubled the
 * drift). Dependency-free by construction, and it must stay that way: this
 * module is reached both from the API's own Node process and from the
 * practitioner app's service worker, a separate, browser-only bundle that
 * cannot load anything of the API's (`docs/SPEC/OWNERSHIP.md`'s browser-safe
 * rule for `domain/shared`, extended here to the worker) — so nothing may
 * ever be added to this file's imports, only to the array itself.
 */
export const MAP_DOCUMENT_PATHS: readonly string[] = ['/admin/schedule/map', '/admin/clients/pin'];
