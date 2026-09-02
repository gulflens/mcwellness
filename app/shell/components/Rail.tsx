import { NavLink } from 'react-router';
import type { ReactNode } from 'react';
import {
  AuditIcon,
  BillingIcon,
  ClientsIcon,
  ScheduleIcon,
  SessionsIcon,
  SignOutIcon,
} from './Icons';

/**
 * The admin console's fixed left rail: icon and label, no collapse toggle
 * (docs/DESIGN-BRIEF.md section 6.2). Sections that have not arrived are
 * listed as such, never as dead links.
 */
export type RailSection = { key: string; label: string; to?: string; icon: ReactNode };

export const ADMIN_SECTIONS: readonly RailSection[] = [
  { key: 'clients', label: 'Clients', to: '/admin/clients', icon: <ClientsIcon /> },
  { key: 'schedule', label: 'Schedule', to: '/admin/schedule', icon: <ScheduleIcon /> },
  { key: 'sessions', label: 'Sessions', icon: <SessionsIcon /> },
  { key: 'billing', label: 'Billing', to: '/admin/billing', icon: <BillingIcon /> },
  { key: 'audit', label: 'Audit', icon: <AuditIcon /> },
];

export function Rail({
  sections = ADMIN_SECTIONS,
  person,
  onSignOut,
}: {
  sections?: readonly RailSection[];
  person: { name: string; roles: string };
  onSignOut: () => void;
}) {
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail__mark">McWellness</div>
      <ul className="rail__list">
        {sections.map((section) =>
          section.to ? (
            <li key={section.key}>
              <NavLink
                to={section.to}
                className={({ isActive }) =>
                  isActive ? 'rail__item rail__item--active' : 'rail__item'
                }
              >
                {section.icon}
                <span>{section.label}</span>
              </NavLink>
            </li>
          ) : (
            <li key={section.key}>
              <span className="rail__item rail__item--later" aria-disabled="true">
                {section.icon}
                <span>{section.label}</span>
                <span className="rail__later micro">Arriving</span>
              </span>
            </li>
          ),
        )}
      </ul>
      <div className="rail__person">
        <div className="rail__name">{person.name}</div>
        <div className="micro">{person.roles}</div>
        <button type="button" className="rail__signout" onClick={onSignOut}>
          <SignOutIcon />
          <span>Sign out</span>
        </button>
      </div>
    </nav>
  );
}
