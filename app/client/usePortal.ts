import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';
import { useAuth } from '../shell/auth/AuthContext';

/**
 * One screen's worth of reading (docs/SPEC/client-portal.md section 3): ask the
 * route, parse the answer through its own schema, and be in exactly one of four
 * states while doing it.
 *
 * The parse is not ceremony. Every portal answer is already parsed on the way
 * out of the route, so parsing it again here is the browser refusing to render
 * a shape the API did not promise — which is what keeps a screen from quietly
 * showing nothing at all when a field is renamed on one side only.
 *
 * `refused` is its own state rather than an error, because it means something a
 * person can read: a young person's own login opening the money screen is not a
 * failure, it is a screen that is not theirs.
 *
 * **Nothing sets state synchronously inside the effect.** The first state is
 * already `loading`, so the effect only queues the request and the answer lands
 * in a promise callback; `reload` is called from a button and may say `loading`
 * as it goes. An answer that arrives after the screen has gone is dropped.
 */

export type Loaded<T> =
  { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'refused' } | { kind: 'error' };

export function usePortalRead<T>(
  path: string,
  schema: ZodType<T>,
): Loaded<T> & { reload: () => void } {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<Loaded<T>>({ kind: 'loading' });
  // Dropped the moment the screen goes, so a slow answer never lands in a
  // component that has been unmounted.
  const live = useRef(true);

  const run = useCallback(async () => {
    try {
      const res = await apiFetch(path);
      if (!live.current) return;
      if (res.status === 403) {
        setState({ kind: 'refused' });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'error' });
        return;
      }
      const data = schema.parse(await res.json());
      if (live.current) setState({ kind: 'ready', data });
    } catch {
      if (live.current) setState({ kind: 'error' });
    }
    // The schema is a module constant in every caller, so its identity is
    // stable and naming it here restarts nothing.
  }, [apiFetch, path, schema]);

  useEffect(() => {
    live.current = true;
    // In a microtask rather than in the effect body, the shape
    // app/shell/auth/AuthContext.tsx already uses: the effect itself sets no
    // state, so a first render never cascades into a second.
    queueMicrotask(() => void run());
    return () => {
      live.current = false;
    };
  }, [run]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    void run();
  }, [run]);

  return { ...state, reload };
}
