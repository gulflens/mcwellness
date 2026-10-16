import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { TestimonialCountResponse } from '../api/testimonials/schema';
import { useAuth } from './auth/AuthContext';
import { ENQUIRY_COUNT_REFRESH_MS } from './useNewEnquiryCount';

/**
 * How many website reviews are waiting for somebody to approve or decline
 * them — the rail's badge beside Reviews (docs/SPEC/testimonials.md section 5).
 *
 * The enquiries' badge pattern (useNewEnquiryCount.ts), asked as often and as
 * cheaply: on every move to another screen and every couple of minutes, from
 * `GET /api/testimonials/count`, a bare number that logs no read. `enabled` is
 * the layout's `canOpenReviews`, the route's own rule, so the request is never
 * sent for somebody who would be refused.
 *
 * Unlike the enquiries' it leaves the window's title alone. A review can wait
 * a day without anyone losing anything; an enquiry is a person waiting for a
 * call, and the title is kept as that one signal.
 */
export function usePendingReviewCount(enabled: boolean): number | null {
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
    void apiFetch('/api/testimonials/count')
      .then(async (res) => {
        if (!live || !res.ok) return;
        const parsed = TestimonialCountResponse.safeParse(await res.json());
        if (live && parsed.success) setCount(parsed.data.pending);
      })
      .catch(() => {
        // The badge keeps the last figure it had; the screen is one press away.
      });
    return () => {
      live = false;
    };
  }, [apiFetch, enabled, pathname, tick]);

  return enabled ? count : null;
}
