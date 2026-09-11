/**
 * The sub-pages a rail section lists beneath itself, and the two pure
 * questions the rail asks about them (docs/SPEC/coloured-shell.md section 7.1).
 *
 * **Why the answers live here and not in the component.** Both turn on reading
 * an address rather than on rendering anything: a hash that may be absent, a
 * path that is the prefix of another. Kept pure, every case can be stated in a
 * test without a browser, which is the same reason `railState.ts` holds the
 * rail's own modes.
 *
 * **Why the rail does not remember which list is open.** The list showing is
 * the list of the section you are on, derived from the address on every
 * render. There is nothing to store, nothing to migrate, and no way for the
 * rail to disagree with the page it is standing beside.
 */
export type RailChild = {
  key: string;
  label: string;
  /** Where it goes. May carry a hash, for a page that holds its sections in one. */
  to: string;
  /** Exact path only: the view that lives at the section's own address. */
  end?: boolean;
  /**
   * Served as its own document, so it is a plain anchor rather than a `Link`.
   * The day map's wider content security policy is the only case today
   * (docs/SPEC/route-planning.md section 4.1).
   */
  document?: boolean;
};

/**
 * Whether a section's own pages cover this path — which is what decides that
 * its list is the one showing.
 *
 * The boundary is a slash or the end of the path, never a bare `startsWith`:
 * `/admin/billing` must not claim a later `/admin/billing-archive`, and the
 * rail would otherwise open the wrong list on a screen nobody has written yet.
 */
export function sectionHolds(base: string, pathname: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Whether this row is the view on screen.
 *
 * `first` says the row is its section's first, which is the view a page with
 * hash-held sections opens on when the address names none — `BillingPage` and
 * `BooksPage` both do, so the rail must say what the page will show, not what
 * the address literally reads.
 */
export function childIsCurrent(
  child: RailChild,
  pathname: string,
  hash: string,
  first: boolean,
): boolean {
  const [childPath, childHash] = splitAddress(child.to);
  if (childHash !== null) {
    if (pathname !== childPath) {
      return false;
    }
    const named = hash.replace(/^#/, '');
    return named === '' ? first : named === childHash;
  }
  if (pathname === childPath) {
    return true;
  }
  return child.end === true ? false : pathname.startsWith(`${childPath}/`);
}

/** A `to` split into its path and its hash, the hash null when it carries none. */
function splitAddress(to: string): [string, string | null] {
  const at = to.indexOf('#');
  return at === -1 ? [to, null] : [to.slice(0, at), to.slice(at + 1)];
}
