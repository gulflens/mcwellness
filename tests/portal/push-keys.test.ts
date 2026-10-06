import { describe, expect, it } from 'vitest';
import { vapidKeysFromEnv } from '../../app/api/portal/push/webpush';
import { pushKeyLines } from '../../scripts/push-keys.mjs';

/**
 * The operator's one act at deploy time for phone notifications
 * (scripts/push-keys.mjs, `pnpm push:keys`): a key pair the API accepts, as
 * the three variables it reads, different every run.
 */
describe('pnpm push:keys', () => {
  it('prints the three variables, as a pair the API accepts', () => {
    const lines = pushKeyLines('mailto:practice@example.com');
    const env = Object.fromEntries(lines.map((line) => line.split(/=(.*)/s).slice(0, 2)));
    expect(Object.keys(env)).toEqual([
      'PUSH_VAPID_PUBLIC_KEY',
      'PUSH_VAPID_PRIVATE_KEY',
      'PUSH_VAPID_SUBJECT',
    ]);
    expect(vapidKeysFromEnv(env)).not.toBeNull();
  });

  it('makes a new pair every time it is run', () => {
    expect(pushKeyLines()[1]).not.toBe(pushKeyLines()[1]);
  });

  it('leaves the subject as a placeholder the operator must replace', () => {
    expect(pushKeyLines()[2]).toMatch(/^PUSH_VAPID_SUBJECT=mailto:REPLACE/);
  });
});
