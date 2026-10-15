import type { Context } from 'hono';
import type { ApiEnv } from '../../_middleware/request-context';
import type { PushEvent } from './events';

/**
 * Notify an event once the request's own transaction has committed, and never
 * otherwise (./events.ts). Nothing at all when the practice has no key pair:
 * push stays off, silently, exactly as round 75 left it. Returns at once; the
 * act that called this is neither slowed nor failed by it.
 */
export function queuePushEvent(c: Context<ApiEnv>, event: PushEvent): void {
  const notify = c.get('notifyEvent');
  if (notify === undefined) return;
  c.get('afterCommit')(() => {
    notify(event);
  });
}
