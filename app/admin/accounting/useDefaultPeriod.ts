import { useEffect, useState } from 'react';
import { defaultStatementPeriod } from '@domain/accounting';
import { isoDateIn } from '@domain/shared';
import { SettingsResponse } from '../../api/accounting/schema';
import { useAuth } from '../../shell/auth/AuthContext';

/**
 * The period the statements and an account's ledger open on, from the
 * practice's own year end (domain/accounting/dates.ts). Null until the
 * settings arrive, so a screen never shows one period and then jumps to
 * another. If they cannot be read, a 31 December year end is assumed — the
 * default every practice starts with — rather than leaving the screen blank.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

export type Period = { from: string; to: string };

export function useDefaultPeriod(): Period | null {
  const { apiFetch } = useAuth();
  const [period, setPeriod] = useState<Period | null>(null);

  useEffect(() => {
    let live = true;
    const today = isoDateIn(new Date(), PRACTICE_TIME_ZONE);
    const settle = (yearEndMonth: number, yearEndDay: number) => {
      if (live) setPeriod(defaultStatementPeriod(today, yearEndMonth, yearEndDay));
    };
    void apiFetch('/api/accounting/settings')
      .then(async (res) => {
        if (!res.ok) return settle(12, 31);
        const setting = SettingsResponse.parse(await res.json());
        settle(setting.yearEndMonth, setting.yearEndDay);
      })
      .catch(() => settle(12, 31));
    return () => {
      live = false;
    };
  }, [apiFetch]);

  return period;
}
