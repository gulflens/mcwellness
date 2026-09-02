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

export const AuditIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.75 4 5v4.5c0 3.4 2.5 6.2 6 7.75 3.5-1.55 6-4.35 6-7.75V5z" />
    <path d="M7.5 10l1.75 1.75L12.75 8.5" />
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
