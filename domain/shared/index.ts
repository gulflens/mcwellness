// Browser-safe only (docs/SPEC/OWNERSHIP.md, shared-zone notes): nothing here
// may import a Node built-in. domain/shared/identity.ts opens with `node:crypto`
// at module scope and is server-only — import it by its own path,
// 'domain/shared/identity', never through this barrel. tests/lint guards this.
export { addFils, fils } from './fils';
export type { Fils } from './fils';
export { ROLES, canActor, hasRole, isCredentialValidOn, isoDateIn } from './actor';
export type { Action, ActionContext, Actor, Capability, IsoDate, Role } from './actor';
export * from './dates';
