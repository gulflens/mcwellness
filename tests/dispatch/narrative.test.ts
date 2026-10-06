import { describe, expect, it } from 'vitest';
import { narrate, type AuditEvent } from '@domain/shared/audit-narrative';

/**
 * How the trail reads live location (docs/SPEC/dispatch.md section 15): a
 * board read of a shared location says somebody looked, in words, and the
 * consent and the switch name themselves rather than their tables.
 */

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: '1',
    occurredAt: '2026-10-06T06:30:00.000Z',
    actor: { id: '00000002-0000-4000-8000-000000000010', name: 'Hazel Harbour', roles: ['admin'] },
    actorType: 'user',
    action: 'read',
    entityType: 'practitioner_position',
    entityId: '00000008-0000-4000-8000-000000000001',
    changedFields: null,
    oldValues: null,
    newValues: null,
    reason: null,
    ...overrides,
  };
}

describe('live location in the trail', () => {
  it('says somebody looked at a shared location, never where it was', () => {
    const en = narrate(event({}), 'en')?.sentence ?? '';
    expect(en).toContain('shared location');
    expect(en).not.toContain('practitioner_position');
    expect(narrate(event({}), 'ar')?.sentence).toContain('الموقع المُشارَك');
  });

  it('names the consent and the switch in words', () => {
    for (const entityType of ['staff_consent', 'location_sharing']) {
      const en = narrate(event({ entityType, action: 'insert' }), 'en')?.sentence ?? '';
      expect(en, entityType).not.toContain(entityType);
    }
  });

  it('names a helper assignment in words, in both languages', () => {
    const entityType = 'helper_accompaniment';
    const en = narrate(event({ entityType, action: 'insert' }), 'en')?.sentence ?? '';
    expect(en).toContain('helper assignment');
    expect(en).not.toContain(entityType);
    expect(narrate(event({ entityType, action: 'insert' }), 'ar')?.sentence).toContain(
      'تكليف المساعد',
    );
  });
});
