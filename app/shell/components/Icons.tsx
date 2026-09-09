import type { SVGProps } from 'react';

/** A small set drawn on a 20px grid, one stroke weight, in the current text colour. */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ClientsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="6.5" r="2.75" />
    <path d="M2.5 16.5c0-2.9 2.2-4.8 5-4.8s5 1.9 5 4.8" />
    <circle cx="14" cy="7.5" r="2.25" />
    <path d="M13.5 11.6c2.4.2 4 2 4 4.4" />
  </Icon>
);

export const ScheduleIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" />
    <path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" />
  </Icon>
);

export const TodayIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 5.75V10l2.75 1.75" />
  </Icon>
);

export const SessionsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 10h3l2-5 3 10 2.5-7 1.5 2h3" />
  </Icon>
);

export const BillingIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 2.75h10v14.5l-2-1.25-2 1.25-2-1.25-2 1.25-2-1.25-2 1.25z" />
    <path d="M7.5 7h5M7.5 10h5" />
  </Icon>
);

/** The books: a ledger stood on its spine, two columns and three rules. */
export const BooksIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.25 3.75h13.5v12.5H3.25z" />
    <path d="M10 3.75v12.5M6.25 7h1.5M6.25 10h1.5M6.25 13h1.5M12.25 7h1.5M12.25 10h1.5M12.25 13h1.5" />
  </Icon>
);

/** An enquiry: a speech bubble with two lines of what was said. */
export const EnquiriesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.25 4.25h13.5v8.5H8.75L5.5 15.75v-3H3.25z" />
    <path d="M6.5 7.25h7M6.5 9.75h4.5" />
  </Icon>
);

export const AuditIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.75 4 5v4.5c0 3.4 2.5 6.2 6 7.75 3.5-1.55 6-4.35 6-7.75V5z" />
    <path d="M7.5 10l1.75 1.75L12.75 8.5" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.25 6h13.5M3.25 10h13.5M3.25 14h13.5" />
    <circle cx="7" cy="6" r="1.75" />
    <circle cx="13" cy="10" r="1.75" />
    <circle cx="8.5" cy="14" r="1.75" />
  </Icon>
);

/** A door with a way through it: the household's own way into its record. */
export const PortalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.5 3.25h3.25a1 1 0 0 1 1 1v11.5a1 1 0 0 1-1 1H11.5" />
    <path d="M8 6.5 4.5 10 8 13.5M4.5 10h8" />
  </Icon>
);

/** The equipment register: a case with a handle (docs/SPEC/practitioner-phone.md section 6.4). */
export const KitIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="6.5" width="14.5" height="10.75" rx="1.5" />
    <path d="M7.5 6.5V4.25a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6.5" />
    <path d="M2.75 11h14.5" />
  </Icon>
);

export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.25H4.5a1 1 0 0 0-1 1v11.5a1 1 0 0 0 1 1H8" />
    <path d="M12 6.5 15.5 10 12 13.5M15.5 10H7.5" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 8l4 4 4-4" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);

/** An open eye: the password is hidden, and this shows it. */
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.75 10S4.75 4.75 10 4.75 18.25 10 18.25 10 15.25 15.25 10 15.25 1.75 10 1.75 10Z" />
    <circle cx="10" cy="10" r="2.25" />
  </Icon>
);

/** The same eye, crossed: the password is showing, and this hides it again. */
export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.1 5.05A7.7 7.7 0 0 1 10 4.75c5.25 0 8.25 5.25 8.25 5.25a14.5 14.5 0 0 1-2.6 3.2" />
    <path d="M13.35 13.75A7.8 7.8 0 0 1 10 15.25C4.75 15.25 1.75 10 1.75 10a14.4 14.4 0 0 1 3.9-4.3" />
    <path d="M8.4 8.4a2.25 2.25 0 0 0 3.2 3.2" />
    <path d="M3.5 3.5l13 13" />
  </Icon>
);

/**
 * A panel with its inline-start column marked: the rail itself. One icon for
 * both states, because the control is the rail and not a direction; whether it
 * is open is said by `aria-expanded`, not by a rotating chevron.
 */
export const RailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5" />
    <path d="M7.75 3.75v12.5" />
  </Icon>
);

/** Three rules: the control that asks for the portal's sidebar on a phone. */
export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Icon>
);

/** A drawing pin, for the control that keeps the sections open over the page. */
export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 2.75h5l-.75 4.5 2.5 2.5v1.5h-9v-1.5l2.5-2.5-.75-4.5Z" />
    <path d="M10 11.25v6" />
  </Icon>
);
