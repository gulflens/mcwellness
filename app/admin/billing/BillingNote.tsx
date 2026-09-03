import type { ReactNode } from 'react';
import { Note } from '../../shell/components/Controls';

/**
 * A note with the third tone.
 *
 * `Note` in the shell takes `muted` and `critical`. An expiry warning is
 * neither: "these sessions run out in three weeks" is not a state that asks
 * nothing of the reader, and it is not wrong yet — rendered muted it read
 * exactly like "Loading the balance", which is the one thing it must not do.
 *
 * The trunk's pull request 44 (`shared-zone-round-16`) adds `attention` to
 * `Note`, announced politely with `role="status"`. **This file is the local
 * stand-in until that merges**, and it renders precisely what the trunk's own
 * Note will: the same class, on the same token, with the same role. When 44
 * lands, this file goes and every caller passes `tone` to `Note` directly —
 * the tests assert the class and the role, so they pass either way and will
 * hold that swap honest.
 */
export function BillingNote({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'attention' | 'critical';
  children: ReactNode;
}) {
  if (tone === 'attention') {
    return (
      <p className="note note--attention" role="status">
        {children}
      </p>
    );
  }
  return <Note tone={tone}>{children}</Note>;
}
