import { useCallback, useRef } from 'react';
import { NavLink } from 'react-router';
import type { ReactNode } from 'react';
import { useDrawer } from './useDrawer';
import {
  AuditIcon,
  BillingIcon,
  BooksIcon,
  ClientsIcon,
  KitIcon,
  PinIcon,
  PortalIcon,
  RailIcon,
  ScheduleIcon,
  SessionsIcon,
  SettingsIcon,
  SignOutIcon,
  TodayIcon,
} from './Icons';

/**
 * The admin console's left rail: icon and label, and a control that closes it
 * to a strip of icons (docs/DESIGN-BRIEF.md section 6.2, reversed on the
 * operator's instruction of 7 September 2026; docs/SPEC/responsive-console.md
 * section 6). Sections that have not arrived are listed as such, never as dead
 * links.
 */
export type RailSection = { key: string; label: string; to?: string; icon: ReactNode };

export const ADMIN_SECTIONS: readonly RailSection[] = [
  { key: 'clients', label: 'Clients', to: '/admin/clients', icon: <ClientsIcon /> },
  { key: 'schedule', label: 'Schedule', to: '/admin/schedule', icon: <ScheduleIcon /> },
  { key: 'sessions', label: 'Sessions', icon: <SessionsIcon /> },
  { key: 'billing', label: 'Billing', to: '/admin/billing', icon: <BillingIcon /> },
  // The practice's own books. AdminLayout shows it only to the owner and
  // finance (adminAccess.ts): an admin records a household's money and does not
  // keep the practice's books (docs/SPEC/accounting.md section 3).
  { key: 'books', label: 'Books', to: '/admin/books', icon: <BooksIcon /> },
  // The practice's whole trail, and who has read one record. AdminLayout shows
  // it only to the three oversight roles (adminAccess.ts).
  { key: 'audit', label: 'Audit', to: '/admin/audit', icon: <AuditIcon /> },
  // The practice's own details, and the practitioners' home bases. Two screens
  // with two audiences, so this is the one row whose destination AdminLayout
  // replaces per actor (`settingsHomeFor`, adminAccess.ts): Practice for an
  // owner or an admin, Practitioners for anyone else who may set a base. The
  // `to` here is the office's, and the default when there is no actor.
  { key: 'settings', label: 'Settings', to: '/admin/settings/practice', icon: <SettingsIcon /> },
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
        {sections.map((section) =>
          section.to ? (
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
            </li>
          ) : (
            <li key={section.key}>
              <span
                className="rail__item rail__item--later"
                aria-disabled="true"
                title={section.label}
              >
                {section.icon}
                <span className="rail__label">{section.label}</span>
                <span className="rail__later micro">Arriving</span>
              </span>
            </li>
          ),
        )}
      </ul>
      <div className="rail__person">
        <div className="rail__name rail__label">{person.name}</div>
        <div className="micro rail__label">{person.roles}</div>
        <button type="button" className="rail__signout" onClick={onSignOut} title="Sign out">
          <SignOutIcon />
          <span className="rail__label">Sign out</span>
        </button>
      </div>
    </nav>
  );
}
