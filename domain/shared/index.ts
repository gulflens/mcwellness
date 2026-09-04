// Browser-safe only (docs/SPEC/OWNERSHIP.md, shared-zone notes): nothing here
// may import a Node built-in. domain/shared/identity.ts opens with `node:crypto`
// at module scope and is server-only — import it by its own path,
// 'domain/shared/identity', never through this barrel. tests/lint guards this,
// and the same walk starts from every other stream barrel too, so the rule is
// "every domain barrel is browser-safe", not just this one.
export { addFils, fils, formatFils } from './fils';
export type { Fils } from './fils';
export { ROLES, canActor, hasRole, isCredentialValidOn, isoDateIn } from './actor';
export type { Action, ActionContext, Actor, Capability, IsoDate, Role } from './actor';
export {
  EMIRATES_ID_DIGITS,
  formatEmiratesId,
  normaliseEmiratesId,
  toLatinDigits,
} from './emirates-id';
export {
  assertValidStorageKey,
  clientDocumentKey,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  isValidStorageKey,
  MAX_SIGNED_URL_TTL_SECONDS,
  practiceDocumentKey,
  StorageUnavailableError,
} from './storage';
export type { StorageProvider, StoredObject } from './storage';
export * from './dates';
