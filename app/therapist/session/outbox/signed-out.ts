import { useEffect } from 'react';
import { useAuth } from '../../../shell/auth/AuthContext';
import { createOutboxStore, forgetDevice, type OutboxStore } from './store';

/**
 * A signed-out device keeps nothing of anybody
 * (.claude/rules/compliance.md, docs/SPEC/session-capture.md section 7).
 *
 * The queue holds ratings, observation chips and whatever the practitioner
 * typed in the note beside them; the open-visit note holds a household's
 * given name and a family initial. None of that may outlive the session it
 * was written in, and a practitioner signing out on a shared phone is the
 * case this exists for.
 *
 * The observation lives here rather than in one screen because it must not
 * depend on which screen happens to be mounted when they sign out: any of
 * this module's own faces arms it, and it clears the device whichever of
 * them is on screen. It does not need an `Outbox`, or a visit in progress,
 * or a store anybody is already holding.
 *
 * What it cannot reach is the service worker's cached day sheet, which is
 * the shell's — asked for in docs/CHANGE-REQUESTS/session-capture-02.md
 * section 5. Two caches, two owners, one sentence.
 */
export function useForgetDeviceOnSignOut(
  /** Injected in tests, where IndexedDB does not exist. */
  createStore: () => Promise<OutboxStore> = createOutboxStore,
): void {
  const { session } = useAuth();
  const signedOut = session.status === 'signed-out';
  useEffect(() => {
    if (!signedOut) return;
    void forgetDevice(createStore);
  }, [createStore, signedOut]);
}
