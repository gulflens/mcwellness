import { useCallback } from 'react';
import { isOffered } from '../../../../domain/reports/qeeg/offered';
import type { Offered } from '../../../../domain/reports/qeeg/prefill';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import type { QeegFollowUp } from '../../../../domain/reports/qeeg/types';
import { QeegPrefillResponse } from '../../../api/reports/schema';
import { useAuth, type ApiFetch } from '../../../shell/auth/AuthContext';
import { CANNOT_COMPARE } from './refusals';

/**
 * A follow-up begun from an earlier report, as the form asks for it
 * (`GET /api/reports/qeeg/prefill`, brief S).
 *
 * **What comes back is held to the domain's shapes before it is used**: the
 * content to `validateQeegContent`, what is offered to the prefill's own
 * lists (`isOffered`). An answer that is neither is no answer, and she is
 * told the earlier report could not be read, never shown half of it.
 *
 * **Every refusal has a sentence**, the same the draft route's refusals of a
 * comparison have (`CANNOT_COMPARE`), because the two are the one rule
 * (`prefillFollowUp`) asked at two moments.
 */

export type Prefilled = {
  readonly content: QeegFollowUp;
  readonly offered: Offered;
  /** The count of sessions, and the days it ran between (`after`, `before` left out). */
  readonly sessions: QeegPrefillResponse['sessions'];
};

export type PrefillAnswer = { ok: true; prefilled: Prefilled } | { ok: false; sentence: string };

export type PrefillQuery = {
  readonly from: string;
  readonly recordedOn?: string | null;
  readonly stage?: 'follow_up' | 'final';
  readonly draftId?: string | null;
};

export type LoadPrefill = (query: PrefillQuery) => Promise<PrefillAnswer>;

const FORBIDDEN = 'You are not allowed to write reports for this client.';
const NOT_FOUND =
  'This client could not be found. It may have been removed, or you may no longer have access to it.';
const NOT_ACCEPTED =
  'The form asked for something the server does not accept. Reload the page and try again.';
const UNREADABLE = 'The earlier report could not be read. Check the connection and try again.';

/** A sentence for every way the prefill can refuse. */
export function prefillRefusalSentence(status: number, body: unknown): string {
  const code =
    typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && Object.hasOwn(CANNOT_COMPARE, code)) {
    return CANNOT_COMPARE[code] ?? UNREADABLE;
  }
  if (status === 403) return FORBIDDEN;
  if (status === 404) return NOT_FOUND;
  if (status === 400) return NOT_ACCEPTED;
  return UNREADABLE;
}

/** The query string: only what was given, as the route's strict query expects. */
function pathFor(clientId: string, query: PrefillQuery): string {
  const params = new URLSearchParams({ clientId, from: query.from });
  if (query.recordedOn) params.set('recordedOn', query.recordedOn);
  if (query.stage) params.set('stage', query.stage);
  if (query.draftId) params.set('draftId', query.draftId);
  return `/api/reports/qeeg/prefill?${params.toString()}`;
}

export async function fetchPrefill(
  apiFetch: ApiFetch,
  clientId: string,
  query: PrefillQuery,
): Promise<PrefillAnswer> {
  try {
    const res = await apiFetch(pathFor(clientId, query));
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, sentence: prefillRefusalSentence(res.status, body) };
    const parsed = QeegPrefillResponse.parse(body);
    const checked = validateQeegContent(parsed.content);
    if (!checked.ok || checked.content.edition !== 'follow-up' || !isOffered(parsed.offered)) {
      return { ok: false, sentence: UNREADABLE };
    }
    return {
      ok: true,
      prefilled: { content: checked.content, offered: parsed.offered, sessions: parsed.sessions },
    };
  } catch {
    return { ok: false, sentence: UNREADABLE };
  }
}

/** The prefill for one client, as a screen asks for it. */
export function usePrefill(clientId: string): LoadPrefill {
  const { apiFetch } = useAuth();
  return useCallback((query) => fetchPrefill(apiFetch, clientId, query), [apiFetch, clientId]);
}
