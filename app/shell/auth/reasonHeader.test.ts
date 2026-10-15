import { describe, expect, it } from 'vitest';
import { withSendableReason } from './reasonHeader';

const ARABIC = 'طلبت العائلة موعداً بعد الظهر';

describe('withSendableReason', () => {
  it('percent-encodes and marks a reason a browser would refuse to send', () => {
    for (const typed of ['The family’s request', 'Moved — on request', 'Rebooked 🙂', ARABIC]) {
      const headers = withSendableReason({ 'content-type': 'application/json', 'x-reason': typed });
      expect(headers.get('x-reason')).toBe(encodeURIComponent(typed));
      expect(headers.get('x-reason-encoding')).toBe('uri');
      expect(headers.get('content-type')).toBe('application/json');
      expect(decodeURIComponent(headers.get('x-reason') ?? '')).toBe(typed);
    }
  });

  it('leaves a plain ASCII reason exactly as typed and unmarked', () => {
    const headers = withSendableReason({ 'x-reason': 'Opening the books at 100%' });
    expect(headers.get('x-reason')).toBe('Opening the books at 100%');
    expect(headers.has('x-reason-encoding')).toBe(false);
  });

  it('encodes a line break, which no header may carry either', () => {
    const headers = withSendableReason({ 'x-reason': 'first line\nsecond line' });
    expect(headers.get('x-reason')).toBe('first%20line%0Asecond%20line');
    expect(headers.get('x-reason-encoding')).toBe('uri');
  });

  it('finds the reason whatever the case of its name and whatever shape the headers take', () => {
    expect(withSendableReason({ 'X-Reason': 'é' }).get('x-reason')).toBe('%C3%A9');
    expect(withSendableReason([['x-reason', '’']]).get('x-reason')).toBe('%E2%80%99');
    const already = new Headers({ 'x-reason': 'plain' });
    expect(withSendableReason(already).get('x-reason')).toBe('plain');
  });

  it('answers empty headers for none, and never invents a reason', () => {
    const headers = withSendableReason(undefined);
    expect([...headers.keys()]).toEqual([]);
    expect(withSendableReason({ accept: 'application/json' }).has('x-reason')).toBe(false);
  });
});
