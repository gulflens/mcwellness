import { createContext, useContext, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps, type To } from 'react-router';

/**
 * The day map is a document, not a screen (docs/SECURITY.md;
 * docs/SPEC/route-planning.md section 8).
 *
 * **Why this exists.** `/admin/schedule/map` is the one address the API serves
 * with a wider content security policy, because Google's Maps JavaScript API
 * cannot run under the strict one. Everything rendered in that document
 * inherits the wider policy — a policy is a property of the document, not of
 * the React tree inside it. So a client-side navigation out of this page does
 * not leave the widened document: it renders the next screen of the practice
 * inside it, under `'unsafe-eval'` and `'strict-dynamic'`, and from there the
 * rail puts Clients, Billing, Books, Audit and Settings one click apart for
 * the rest of that browsing session. That is the review of pull request 121,
 * finding B2, and the first fix round closed only half of it: the route was
 * moved out of the `/admin` layout so the page itself carries no rail, and a
 * `<Link>` inside the call-off drawer still carried the whole console in.
 *
 * **Why a component and not a rule.** The drawers this page renders are the
 * Schedule page's drawers too, and there a client-side link is right — a full
 * document load to reach Billing from the Schedule would be a loss for no
 * reason. So the decision cannot live at the link; it has to live in the tree
 * the link happens to be rendered in. `DocumentBoundary` marks the tree, and
 * `BoundaryLink` asks. A link written next year by somebody who has never read
 * this file is then safe by construction, which is the only kind of safe that
 * survives.
 *
 * **What it does not cover.** A `useNavigate`, a `<Navigate>` or a
 * `history.pushState` inside this tree would move the router without asking
 * anybody. There are none today — the sweep of everything `DayMapPage` renders
 * found only the two links — and the way to keep it that way is that every
 * outward crossing here is a `BoundaryLink` or a plain anchor.
 */
const DocumentBoundaryContext = createContext(false);

/**
 * Marks everything inside as a document that must not be navigated away from
 * in place. `DayMapPage` wraps its whole tree, drawers included.
 */
export function DocumentBoundary({ children }: { children: ReactNode }) {
  return (
    <DocumentBoundaryContext.Provider value={true}>{children}</DocumentBoundaryContext.Provider>
  );
}

/** Whether this tree is such a document. False everywhere else in the console. */
export function useDocumentBoundary(): boolean {
  return useContext(DocumentBoundaryContext);
}

/** A `To` as an address a browser can be given. */
function hrefFor(to: To): string {
  if (typeof to === 'string') return to;
  return `${to.pathname ?? ''}${to.search ?? ''}${to.hash ?? ''}`;
}

/**
 * The props `Link` answers itself, which mean nothing to an anchor and which
 * React would object to being handed. `satisfies` keeps the list honest: a
 * name that stops being one of `Link`'s props stops compiling here.
 */
const ROUTER_ONLY_PROPS = [
  'to',
  'discover',
  'prefetch',
  'reloadDocument',
  'replace',
  'state',
  'preventScrollReset',
  'relative',
  'viewTransition',
  'defaultShouldRevalidate',
  'mask',
] as const satisfies readonly (keyof LinkProps)[];

/** Everything a plain anchor can be given, from a `Link`'s own props. */
function anchorPropsOf(props: LinkProps): AnchorHTMLAttributes<HTMLAnchorElement> {
  const anchor: Record<string, unknown> = { ...props };
  for (const name of ROUTER_ONLY_PROPS) delete anchor[name];
  return anchor as AnchorHTMLAttributes<HTMLAnchorElement>;
}

/**
 * A link that knows what it is inside: a plain anchor within a
 * `DocumentBoundary`, so the browser loads a fresh document and the strict
 * policy comes with it, and an ordinary router `Link` everywhere else.
 *
 * It takes `Link`'s own props so a call site reads the same either way.
 */
export function BoundaryLink(props: LinkProps) {
  const insideBoundary = useDocumentBoundary();
  if (!insideBoundary) return <Link {...props} />;
  return <a href={hrefFor(props.to)} {...anchorPropsOf(props)} />;
}
