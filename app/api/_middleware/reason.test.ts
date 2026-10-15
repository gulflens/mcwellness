import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { decodeReason, requestReason } from './reason';

const ARABIC = 'طلبت العائلة موعداً بعد الظهر';

describe('decodeReason', () => {
  it('reads a header with no encoding marker as the plain text it is', () => {
    expect(decodeReason('The family asked for the afternoon.', undefined)).toBe(
      'The family asked for the afternoon.',
    );
  });

  it('answers nothing for no header at all', () => {
    expect(decodeReason(undefined, undefined)).toBe('');
  });

  it('decodes a percent-encoded reason marked uri, whatever its characters', () => {
    for (const text of [
      'The family’s request',
      'Moved — the family asked',
      'Rebooked 🙂 on request',
      ARABIC,
      'plain ascii, encoded anyway',
    ]) {
      expect(decodeReason(encodeURIComponent(text), 'uri')).toBe(text);
    }
  });

  it('accepts the marker in any case and with stray spaces', () => {
    expect(decodeReason('a%E2%80%99b', ' URI ')).toBe('a’b');
  });

  it('refuses an encoding it does not know', () => {
    expect(decodeReason('abc', 'base64')).toBeNull();
    expect(decodeReason('abc', '')).toBeNull();
  });

  it('refuses a malformed percent-encoding rather than throwing', () => {
    expect(decodeReason('%E2%80', 'uri')).toBeNull();
    expect(decodeReason('%zz', 'uri')).toBeNull();
    expect(decodeReason('100%', 'uri')).toBeNull();
  });

  it('leaves an unmarked header containing a percent sign alone', () => {
    expect(decodeReason('Discount of 100%', undefined)).toBe('Discount of 100%');
  });
});

describe('requestReason', () => {
  const app = new Hono().get('/', (c) => c.json({ reason: requestReason(c) }));

  async function reasonOf(headers: Record<string, string>): Promise<unknown> {
    const res = await app.request('/', { headers });
    return ((await res.json()) as { reason: unknown }).reason;
  }

  it('reads the decoded text off the request', async () => {
    expect(
      await reasonOf({ 'x-reason': encodeURIComponent(ARABIC), 'x-reason-encoding': 'uri' }),
    ).toBe(ARABIC);
  });

  it('reads a plain header as it stands', async () => {
    expect(await reasonOf({ 'x-reason': 'typed it wrong' })).toBe('typed it wrong');
  });

  it('answers empty for an absent or unreadable header', async () => {
    expect(await reasonOf({})).toBe('');
    expect(await reasonOf({ 'x-reason': '%E2', 'x-reason-encoding': 'uri' })).toBe('');
  });
});
