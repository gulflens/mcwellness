import { describe, expect, it } from 'vitest';
import { canTransition } from './canTransition';
import { CLIENT_STATUSES, type ClientStatus } from './types';

const ALLOWED = new Set<`${ClientStatus}->${ClientStatus}`>([
  'lead->active',
  'lead->erased',
  'active->paused',
  'active->closed',
  'active->erased',
  'paused->active',
  'paused->erased',
  'closed->active',
  'closed->erased',
]);

describe('canTransition', () => {
  it('matches the lifecycle diagram exactly, for every pair of statuses', () => {
    for (const from of CLIENT_STATUSES) {
      for (const to of CLIENT_STATUSES) {
        const key: `${ClientStatus}->${ClientStatus}` = `${from}->${to}`;
        expect(canTransition(from, to)).toBe(ALLOWED.has(key));
      }
    }
  });

  it('lets lead become active or erased, and nothing else', () => {
    expect(canTransition('lead', 'active')).toBe(true);
    expect(canTransition('lead', 'erased')).toBe(true);
    expect(canTransition('lead', 'paused')).toBe(false);
    expect(canTransition('lead', 'closed')).toBe(false);
  });

  it('lets active and paused move back and forth', () => {
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
  });

  it('lets active close and closed reactivate', () => {
    expect(canTransition('active', 'closed')).toBe(true);
    expect(canTransition('closed', 'active')).toBe(true);
  });

  it('never lets paused go straight to closed, or closed straight to paused', () => {
    expect(canTransition('paused', 'closed')).toBe(false);
    expect(canTransition('closed', 'paused')).toBe(false);
  });

  it('treats erased as terminal', () => {
    for (const to of CLIENT_STATUSES) {
      expect(canTransition('erased', to)).toBe(false);
    }
  });

  it('is not reflexive: staying on the same status is not a transition', () => {
    for (const status of CLIENT_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('permits nothing from a status it does not recognise, rather than throwing', () => {
    const unknownStatus = 'not_a_real_status' as unknown as ClientStatus;
    expect(() => canTransition(unknownStatus, 'active')).not.toThrow();
    expect(canTransition(unknownStatus, 'active')).toBe(false);
    for (const to of CLIENT_STATUSES) {
      expect(canTransition(unknownStatus, to)).toBe(false);
    }
  });
});
