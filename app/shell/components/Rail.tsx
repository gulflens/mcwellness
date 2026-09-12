import { useCallback, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { childIsCurrent, sectionHolds, type RailChild } from '../railChildren';
import { useDrawer } from './useDrawer';
import {
  AuditIcon,
  BillingIcon,
  BooksIcon,
  ClientsIcon,
  EnquiriesIcon,
  KeyIcon,
  KitIcon,
  PinIcon,
  PortalIcon,
  RailIcon,
  ScheduleIcon,
  SettingsIcon,
  SignOutIcon,
  TodayIcon,
} from './Icons';

/**
 * The admin console's left rail: icon and label, and a control that closes it
 * to a strip of icons (docs/DESIGN-BRIEF.md section 6.2, reversed on the
 * operator's instruction of 7 September 2026; docs/SPEC/responsive-console.md
 * section 6). Every section is a destination: the rail lists nothing it cannot
 * open (the last placeholder, Sessions, was removed in trunk round 41,
 * 2026-09-10, docs/CHANGE-REQUESTS/trunk-notes.md).
 */
export type RailSection = {
  key: string;
  label: string;
  to: string;
  icon: ReactNode;
  /**
   * The pages this section holds, listed beneath it while you are on one of
   * them (the operator's instruction of 2026-09-12; docs/SPEC/coloured-shell.md
   * section 7.1). Absent where a section is a single screen.
   */
  children?: readonly RailChild[];
  /**
   * The address every one of those pages sits under, where it is not `to`
   * itself. Settings is the case: its entry points at the first screen the
   * reader may open, which is not the family's root.
   */
  base?: string;
};

export const ADMIN_SECTIONS: readonly RailSection[] = [
  { key: 'clients', label: 'Clients', to: '/admin/clients', icon: <ClientsIcon /> },
  // What the website's forms sent, until someone makes each one a lead or
  // dismisses it. AdminLayout shows it only to the three roles that may action
  // one (adminAccess.ts).
  { key: 'enquiries', label: 'Enquiries', to: '/admin/enquiries', icon: <EnquiriesIcon /> },
  {
    key: 'schedule',
    label: 'Schedule',
    to: '/admin/schedule',
    icon: <ScheduleIcon />,
    // The day is the section's own address, so it is marked `end`: without it
    // every page beneath would light the day up as well. The map is a plain
    // anchor because it is served as its own document with the wider policy a
    // browser map needs, exactly as the Schedule header's own link is.
    // AdminLayout drops the board for anyone whose rule refuses it.
    children: [
      { key: 'day', label: 'Day', to: '/admin/schedule', end: true },
      { key: 'week', label: 'Week', to: '/admin/schedule/week' },
      { key: 'board', label: 'Board', to: '/admin/schedule/board' },
      { key: 'map', label: 'Day map', to: '/admin/schedule/map', document: true },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    to: '/admin/billing',
    icon: <BillingIcon />,
    // One page holding five sections, named in the address after the hash
    // (app/admin/billing/BillingPage.tsx). The order is the page's own, so the
    // rail and the tabs beneath it read the same way, and the first is what
    // the page opens on when the address names none.
    children: [
      { key: 'prices', label: 'Prices', to: '/admin/billing#prices' },
      { key: 'packages', label: 'Packages', to: '/admin/billing#packages' },
      { key: 'balances', label: 'Balances', to: '/admin/billing#balances' },
      { key: 'invoices', label: 'Invoices', to: '/admin/billing#invoices' },
      { key: 'receipts', label: 'Receipts', to: '/admin/billing#receipts' },
    ],
  },
  // The practice's own books. AdminLayout shows it only to the owner and
  // finance (adminAccess.ts): an admin records a household's money and does not
  // keep the practice's books (docs/SPEC/accounting.md section 3).
  {
    key: 'books',
    label: 'Books',
    to: '/admin/books',
    icon: <BooksIcon />,
    // The same shape as Billing's, in app/admin/accounting/BooksPage.tsx's own
    // order. "Settings" here is the books' own settings, not the practice's.
    children: [
      { key: 'overview', label: 'Overview', to: '/admin/books#overview' },
      { key: 'journal', label: 'Journal', to: '/admin/books#journal' },
      { key: 'accounts', label: 'Accounts', to: '/admin/books#accounts' },
      { key: 'statements', label: 'Statements', to: '/admin/books#statements' },
      { key: 'settings', label: 'Books settings', to: '/admin/books#settings' },
    ],
  },
  // The practice's whole trail, and who has read one record. AdminLayout shows
  // it only to the three oversight roles (adminAccess.ts).
  { key: 'audit', label: 'Audit', to: '/admin/audit', icon: <AuditIcon /> },
  // The practice's own details, and the practitioners' home bases. Two screens
  // with two audiences, so this is the one row whose destination AdminLayout
  // replaces per actor (`settingsHomeFor`, adminAccess.ts): Practice for an
  // owner or an admin, Practitioners for anyone else who may set a base. The
  // `to` here is the office's, and the default when there is no actor.
  {
    key: 'settings',
    label: 'Settings',
    to: '/admin/settings/practice',
    icon: <SettingsIcon />,
    // Three screens with three audiences, so AdminLayout keeps only the ones
    // this person may open — the same rule SettingsNav asks on the page
    // itself, and the same promise the rail has always made: it lists nothing
    // a route would bounce the reader out of. `base` is the family's root,
    // because `to` is whichever screen they may open first.
    base: '/admin/settings',
    children: [
      { key: 'practice', label: 'Practice', to: '/admin/settings/practice' },
      { key: 'practitioners', label: 'Practitioners', to: '/admin/settings/practitioners' },
      { key: 'team', label: 'Team', to: '/admin/settings/team' },
    ],
  },
  // Who can open a household's own record. AdminLayout shows it only to an
  // owner or an admin (adminAccess.ts), the two who may hand access out.
  { key: 'portal', label: 'Portal', to: '/admin/portal', icon: <PortalIcon /> },
  // The practice's instruments. AdminLayout shows it only to somebody who may
  // manage the register (adminAccess.ts): the owner, an admin and the lead
  // practitioner.
  { key: 'kit', label: 'Kit', to: '/admin/kit', icon: <KitIcon /> },
  // The practitioner's side. Listed last because it leaves the console;
  // AdminLayout shows it only to someone who treats (adminAccess.ts).
  { key: 'today', label: 'Today', to: '/today', icon: <TodayIcon /> },
];

/**
 * A covering rail owes the page exactly what a drawer owes it, so it borrows
 * the drawer's hook rather than growing a second copy of the same care:
 * `inert` on everything behind, a focus cycle inside, Escape to close, and
 * focus returned to the control that opened it. When the rail is a column
 * beside the page, none of that applies and the hook is not mounted at all —
 * which is why it lives in a child component rather than behind a condition,
 * since a hook cannot be called conditionally.
 */
function Covering({
  rail,
  first,
  onClose,
}: {
  rail: React.RefObject<HTMLElement | null>;
  first: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useDrawer(rail, first, onClose);
  return null;
}

/**
 * The pages of the section you are on, listed beneath it (the operator's
 * instruction of 2026-09-12). The page's own tabs are untouched and remain the
 * way most people will move between these; this is a second door, opened from
 * wherever you are.
 *
 * **Why `Link` and not `NavLink`.** `NavLink` decides what is current from the
 * path alone, and Billing and Books hold their sections after a hash — every
 * row of those two would be marked at once. `childIsCurrent` reads the hash as
 * well, and falls back to the section the page itself opens on when the
 * address names none, so the rail never claims a view the page is not showing.
 *
 * **Why one of them is a plain anchor.** The day map is served as its own
 * document, carrying the wider content security policy a browser map needs, so
 * a client-side navigation would take this page's stricter policy into it —
 * the same reason the Schedule header links to it with an anchor. It carries no
 * `aria-current`, and needs none: that document renders no rail, so there is
 * never a rail on screen while the map is the page.
 */
function Pages({
  section,
  pathname,
  hash,
  onChoose,
}: {
  section: RailSection;
  pathname: string;
  hash: string;
  onChoose?: () => void;
}) {
  const list = useRef<HTMLUListElement | null>(null);
  // With a section open the rail can be taller than the window — ten sections
  // and five pages do not fit 900px at the console's row height — so the list
  // scrolls, and the pages that just appeared could open below the fold. This
  // brings them back into view. `nearest` moves the least that will do, so a
  // rail with room to spare does not jump.
  //
  // On mount and only on mount: this component is rendered for the one section
  // the reader is in, keyed by that section, so it unmounts and remounts when
  // they move to another. Moving between pages *within* a section therefore
  // does not re-fire it, which is what keeps it from fighting somebody who has
  // deliberately scrolled the rail.
  useEffect(() => {
    // Optional because jsdom does not implement it: the tests render this rail
    // constantly and a hard call throws there, which is a test environment's
    // gap rather than anything a browser lacks.
    list.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const named = hash.replace(/^#/, '');
  const holdsHash = (section.children ?? []).some((child) => child.to.split('#')[1] === named);
  return (
    <ul className="rail__children" aria-label={`${section.label} pages`} ref={list}>
      {(section.children ?? []).map((child, index) => {
        // An address naming a section this page does not hold — `#nonsense`, or
        // one renamed since the link was sent — is read as naming none, because
        // that is what the page does with it: `sectionFrom` falls back to its
        // first section, so the rail marks the row the reader is looking at
        // rather than marking nothing at all.
        const current = childIsCurrent(child, pathname, holdsHash ? hash : '', index === 0);
        const className = current ? 'rail__child rail__child--current' : 'rail__child';
        return (
          <li key={child.key}>
            {child.document ? (
              <a className={className} href={child.to} onClick={onChoose}>
                <span className="rail__label">{child.label}</span>
              </a>
            ) : (
              <Link
                className={className}
                to={child.to}
                onClick={onChoose}
                aria-current={current ? 'page' : undefined}
              >
                <span className="rail__label">{child.label}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Rail({
  sections = ADMIN_SECTIONS,
  person,
  onSignOut,
  open,
  onToggle,
  covering = false,
  pinned = false,
  onTogglePin,
  onChoose,
}: {
  sections?: readonly RailSection[];
  person: { name: string; roles: string };
  onSignOut: () => void;
  /** Whether the labels are shown; closed, the rail is a strip of icons. */
  open: boolean;
  onToggle: () => void;
  /**
   * Whether the rail is floating over the page rather than sitting beside it.
   * Covering, it owes the page what any drawer owes it: focus held inside,
   * the rest of the document inert, Escape to close.
   */
  covering?: boolean;
  /** Whether the rail is held open across navigation. */
  pinned?: boolean;
  /** Absent on a desk, where the rail is a column and pinning means nothing. */
  onTogglePin?: () => void;
  /** Called when a section is chosen, so the layout may put the rail away. */
  onChoose?: () => void;
}) {
  const rail = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  // The list showing is the list of the section you are on, read from the
  // address on every render rather than remembered: there is then no second
  // fact to keep in step with the page, and nothing to migrate or store.
  const { pathname, hash } = useLocation();
  // Stable, because useDrawer holds it in an effect's dependency list and a
  // fresh function every render would tear the focus trap down and rebuild it.
  const close = useCallback(() => onToggle(), [onToggle]);
  return (
    <nav className="rail" aria-label="Sections" ref={rail}>
      {covering ? <Covering rail={rail} first={toggle} onClose={close} /> : null}
      <div className="rail__head">
        {/*
          The alt is empty on purpose: the practice's name is in text beside
          it, and a screen reader that announced both would say it twice. The
          mark is the product's own and bundled (docs/brand-assets.md), not
          the practice's uploaded logo, because it has to render before any
          practice has loaded.
        */}
        <img className="rail__logo" src="/brand/mark.png" alt="" width={384} height={410} />
        <div className="rail__mark rail__label">McWellness</div>
        <button
          type="button"
          className="rail__toggle"
          onClick={onToggle}
          aria-expanded={open}
          title="Sections"
          ref={toggle}
        >
          <RailIcon />
          <span className="visually-hidden">Sections</span>
        </button>
        {onTogglePin && open ? (
          <button
            type="button"
            className="rail__pin"
            onClick={onTogglePin}
            aria-pressed={pinned}
            title="Keep sections open"
          >
            <PinIcon />
            <span className="visually-hidden">Keep sections open</span>
          </button>
        ) : null}
      </div>
      <ul className="rail__list">
        {sections.map((section) => (
          <li key={section.key}>
            <NavLink
              to={section.to}
              title={section.label}
              onClick={onChoose}
              className={({ isActive }) =>
                isActive ? 'rail__item rail__item--active' : 'rail__item'
              }
            >
              {section.icon}
              <span className="rail__label">{section.label}</span>
            </NavLink>
            {section.children !== undefined &&
            section.children.length > 0 &&
            sectionHolds(section.base ?? section.to, pathname) ? (
              <Pages section={section} pathname={pathname} hash={hash} onChoose={onChoose} />
            ) : null}
          </li>
        ))}
      </ul>
      <div className="rail__person">
        <div className="rail__name rail__label">{person.name}</div>
        <div className="micro rail__label">{person.roles}</div>
        <NavLink to="/account/password" className="rail__signout" title="Password">
          <KeyIcon />
          <span className="rail__label">Password</span>
        </NavLink>
        <button type="button" className="rail__signout" onClick={onSignOut} title="Sign out">
          <SignOutIcon />
          <span className="rail__label">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
