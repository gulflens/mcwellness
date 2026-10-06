import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { EnquiryCountResponse } from '../api/enquiries/schema';
import { useAuth } from './auth/AuthContext';

/**
 * How many website, expo and discovery-call enquiries are waiting for somebody
 * to make each one a lead or dismiss it — the rail's badge beside Enquiries.
 *
 * **Asked often, and cheaply.** On every move to another screen, and every
 * couple of minutes on a screen left open, because an enquiry arrives while
 * the office is doing something else and the badge is how they hear of it. It
 * asks `GET /api/enquiries/count`, a bare number, rather than the list: a list
 * read names every waiting person and is logged as a read of each, and a
 * badge refreshing on every click would fill the trail with reads nobody made.
 *
 * **Never for somebody who may not see enquiries.** `enabled` is the layout's
 * `canOpenEnquiries`, the same rule the route answers 403 by, so a finance or
 * practitioner account never sends the request at all.
 *
 * **And the window's title says it too**, "(2) McWellness", so a console left
 * in a background tab still says something is waiting. Restored to the bare
 * title when nothing is, and when the console goes away.
 */
export const ENQUIRY_COUNT_REFRESH_MS = 120_000;

/** "(2) " at the front of a title this hook put there. */
const PREFIX = /^\(\d+\) /;

export function useNewEnquiryCount(enabled: boolean): number | null {
  const { apiFetch } = useAuth();
  const { pathname } = useLocation();
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((n) => n + 1), ENQUIRY_COUNT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void apiFetch('/api/enquiries/count')
      .then(async (res) => {
        if (!live || !res.ok) return;
        const parsed = EnquiryCountResponse.safeParse(await res.json());
        if (live && parsed.success) setCount(parsed.data.new);
      })
      .catch(() => {
        // A badge that could not be refreshed keeps the last figure it had.
        // Nothing to tell anybody: the Enquiries screen itself is one press
        // away and says what it can.
      });
    return () => {
      live = false;
    };
  }, [apiFetch, enabled, pathname, tick]);

  const shown = enabled ? count : null;

  useEffect(() => {
    const bare = document.title.replace(PREFIX, '');
    document.title = shown !== null && shown > 0 ? `(${shown}) ${bare}` : bare;
    return () => {
      document.title = document.title.replace(PREFIX, '');
    };
  }, [shown]);

  return shown;
}
