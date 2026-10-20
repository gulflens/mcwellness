/**
 * Editing a package (operator, 20 October 2026): everything but its name can
 * change, and how the change is written depends on one thing.
 *
 * A package somebody has bought keeps the contents it was sold with (the
 * guard of migration 403): their refund and their records are worked out from
 * it. So when the contents of a sold package change, the edit is a new version
 * — the same name, the same place in the list — and the old one is retired out
 * of sight. Anything else (the list price, the term, the contents of a package
 * nobody has bought yet) changes in place, and applies to new sales only,
 * because each sale keeps its own figures and its own end date.
 *
 * Every edit also writes a new price row, whose reason is what the packages
 * table shows as its Notes; `validateNewPrice` (price.ts) decides when it may
 * start.
 */
import type { ExpiryTerm } from './expiry';

export type EditablePackage = {
  listPriceFils: number;
  term: ExpiryTerm | null;
  components: readonly { serviceTypeId: string; quantity: number }[];
};

export type PackageEditPlan =
  | { ok: true; kind: 'in_place'; componentsChanged: boolean }
  | { ok: true; kind: 'new_version' }
  | {
      ok: false;
      code: 'superseded' | 'withdrawn' | 'duplicate_component' | 'version_starts_today';
    };

function sameContents(a: EditablePackage['components'], b: EditablePackage['components']): boolean {
  if (a.length !== b.length) return false;
  const quantities = new Map(a.map((c) => [c.serviceTypeId, c.quantity]));
  return b.every((c) => quantities.get(c.serviceTypeId) === c.quantity);
}

export function planPackageEdit(
  current: EditablePackage,
  edit: EditablePackage,
  at: { replaced: boolean; withdrawn: boolean; sold: boolean; validFrom: string; today: string },
): PackageEditPlan {
  // A version a later one replaced is history, and a withdrawn package is off
  // the list until it is reinstated: neither is edited.
  if (at.replaced) return { ok: false, code: 'superseded' };
  if (at.withdrawn) return { ok: false, code: 'withdrawn' };
  // One line per service; the quantity says how many.
  if (new Set(edit.components.map((c) => c.serviceTypeId)).size !== edit.components.length) {
    return { ok: false, code: 'duplicate_component' };
  }
  const componentsChanged = !sameContents(current.components, edit.components);
  if (!componentsChanged || !at.sold) return { ok: true, kind: 'in_place', componentsChanged };
  // The old version is withdrawn the moment the new one is written, so the new
  // one goes on sale today: a later date would leave the package unsellable
  // in between.
  if (at.validFrom !== at.today) return { ok: false, code: 'version_starts_today' };
  return { ok: true, kind: 'new_version' };
}

/** A package code holds at most forty characters (migration 401's check). */
const CODE_MAX = 40;

/**
 * The code of a package's next version: the code it started with, suffixed
 * `-v2`, `-v3`… and shortened to fit, never leaving a hyphen doubled. Only the
 * suffix the last version was given comes off, so a first code that happens
 * to end in `-v2` keeps it.
 */
export function nextVersionCode(code: string, version: number): string {
  const suffix = `-v${version}`;
  const previous = `-v${version - 1}`;
  const base = (version > 2 && code.endsWith(previous) ? code.slice(0, -previous.length) : code)
    .slice(0, CODE_MAX - suffix.length)
    .replace(/-+$/, '');
  return `${base}${suffix}`;
}
