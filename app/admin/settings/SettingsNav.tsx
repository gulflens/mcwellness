import { NavLink } from 'react-router';
import { useAuth } from '../../shell/auth/AuthContext';
import { canOpenPractitioners, canOpenSettings, canOpenTeam } from '../../shell/adminAccess';

/**
 * The links between the settings screens.
 *
 * The rail keeps one Settings entry, which lands on the first of these screens
 * the person may open (`settingsHomeFor`, app/shell/adminAccess.ts); from
 * 8 September 2026 there are two screens under it, so each carries this small
 * set and one is reachable from the other. Two links is a strip of text, not a
 * second rail: no icons, no counts, nothing that competes with the page beneath
 * it.
 *
 * A link is offered only where the route would let this person in, which is
 * `AdminLayout`'s own rule for the rail — "never shows a link a route would
 * bounce the person straight back out of". A practitioner who is not the
 * office sees Practitioners alone, and so is never handed a Practice screen
 * that would send them home; the owner and an admin see both.
 */
export function SettingsNav() {
  const { session } = useAuth();
  if (session.status !== 'signed-in') {
    return null;
  }
  const now = new Date();
  const links = [
    {
      to: '/admin/settings/practice',
      label: 'Practice',
      open: canOpenSettings(session.actor, now),
    },
    {
      to: '/admin/settings/practitioners',
      label: 'Practitioners',
      open: canOpenPractitioners(session.actor, now),
    },
    {
      to: '/admin/settings/team',
      label: 'Team',
      open: canOpenTeam(session.actor, now),
    },
  ].filter((link) => link.open);

  return (
    <nav className="settings-nav" aria-label="Settings">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            isActive ? 'settings-nav__link settings-nav__link--current' : 'settings-nav__link'
          }
          end
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
