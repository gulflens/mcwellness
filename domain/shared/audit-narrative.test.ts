import { describe, expect, it } from 'vitest';
import { narrate, type AuditEvent } from './audit-narrative';

// Synthetic throughout: a seeded owner and word-name clients.
const OWNER = {
  id: '00000002-0000-4000-8000-000000000001',
  name: 'Hazel Harbour',
  roles: ['owner'],
};

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: '1',
    occurredAt: '2026-09-02T09:00:00.000Z',
    actor: OWNER,
    actorType: 'user',
    action: 'insert',
    entityType: 'client',
    entityId: '00000008-0000-4000-8000-000000000001',
    changedFields: null,
    oldValues: null,
    newValues: null,
    reason: null,
    ...overrides,
  };
}

const CASES: { name: string; event: AuditEvent; en: string; ar: string }[] = [
  {
    name: 'creating a record',
    event: event({}),
    en: 'Hazel Harbour created the record',
    ar: 'Hazel Harbour أنشأ السجل',
  },
  {
    name: 'viewing a record',
    event: event({ action: 'read' }),
    en: 'Hazel Harbour viewed this record',
    ar: 'Hazel Harbour اطّلع على هذا السجل',
  },
  {
    name: 'seeing a record in a list',
    event: event({ action: 'list' }),
    en: 'Hazel Harbour saw this record in a list',
    ar: 'Hazel Harbour رأى هذا السجل في قائمة',
  },
  {
    name: 'a status change with both values',
    event: event({
      action: 'update',
      changedFields: ['status', 'updated_at'],
      oldValues: { status: 'lead' },
      newValues: { status: 'active' },
    }),
    en: 'Hazel Harbour changed the status from Lead to Active',
    ar: 'Hazel Harbour غيّر الحالة من مهتم إلى نشط',
  },
  {
    name: 'a name change said once however many name columns moved',
    event: event({
      action: 'update',
      changedFields: ['family_name', 'family_name_ar', 'given_name', 'primary_contact_id'],
    }),
    en: 'Hazel Harbour changed the name and set the primary contact',
    ar: 'Hazel Harbour غيّر الاسم وحدّد جهة الاتصال الرئيسية',
  },
  {
    name: 'adding a contact',
    event: event({ entityType: 'contact', newValues: { relationship: 'mother' } }),
    en: 'Hazel Harbour added a contact (mother)',
    ar: 'Hazel Harbour أضاف جهة اتصال (الأم)',
  },
  {
    name: 'a contact phone change never repeats the number',
    event: event({
      entityType: 'contact',
      action: 'update',
      changedFields: ['phone', 'whatsapp_opt_in'],
      oldValues: { phone: '+971500001101', whatsapp_opt_in: false },
      newValues: { phone: '+971500001199', whatsapp_opt_in: true },
    }),
    en: "Hazel Harbour changed the contact's phone number and turned WhatsApp messages on for the contact",
    ar: 'Hazel Harbour غيّر رقم هاتف جهة الاتصال وفعّل رسائل واتساب لجهة الاتصال',
  },
  {
    name: 'recording consent',
    event: event({
      entityType: 'consent',
      newValues: { purpose: 'participation', version: 1, method: 'app_signature' },
    }),
    en: 'Hazel Harbour recorded participation consent, version 1, by signature in the app',
    ar: 'Hazel Harbour سجّل موافقة المشاركة، الإصدار 1، بالتوقيع في التطبيق',
  },
  {
    name: 'withdrawing consent',
    event: event({
      entityType: 'consent',
      action: 'update',
      changedFields: ['status', 'withdrawn_at'],
      newValues: { purpose: 'marketing', status: 'withdrawn' },
      reason: 'Asked by the parent at the door.',
    }),
    en: 'Hazel Harbour withdrew marketing consent',
    ar: 'Hazel Harbour سحب موافقة التسويق',
  },
  {
    name: 'adding a location',
    event: event({ entityType: 'location', newValues: { label: 'home', emirate: 'SHJ' } }),
    en: 'Hazel Harbour added a home location in Sharjah',
    ar: 'Hazel Harbour أضاف موقع المنزل في الشارقة',
  },
  {
    name: 'verifying the entrance pin',
    event: event({ entityType: 'location', action: 'update', changedFields: ['entrance_point'] }),
    en: 'Hazel Harbour verified the entrance pin',
    ar: 'Hazel Harbour تحقق من دبوس المدخل',
  },
  {
    name: 'filing a document',
    event: event({ entityType: 'document', newValues: { kind: 'consent_text' } }),
    en: 'Hazel Harbour filed a document (consent_text)',
    ar: 'Hazel Harbour أودع مستندًا (consent_text)',
  },
  {
    name: 'setting a goal',
    event: event({ entityType: 'goal' }),
    en: 'Hazel Harbour set a goal for this record',
    ar: 'Hazel Harbour حدّد هدفًا لهذا السجل',
  },
  {
    name: 'updating a goal',
    event: event({ entityType: 'goal', action: 'update', changedFields: ['status'] }),
    en: 'Hazel Harbour updated a goal',
    ar: 'Hazel Harbour حدّث هدفًا',
  },
  {
    name: 'requesting erasure of a record',
    event: event({ entityType: 'erasure_request' }),
    en: 'Hazel Harbour requested erasure of this record',
    ar: 'Hazel Harbour طلب محو هذا السجل',
  },
  {
    name: 'being refused access to a record',
    event: event({ action: 'refused' }),
    en: 'Hazel Harbour was refused access to this record',
    ar: 'Hazel Harbour مُنع من الوصول إلى هذا السجل',
  },
  {
    name: 'a system row with no actor',
    event: event({ actor: null, actorType: 'system', entityType: 'tenant' }),
    en: 'The system added a practice',
    ar: 'النظام أضاف المركز',
  },
  {
    name: 'an entity the catalogue has no special wording for',
    event: event({ entityType: 'credential', action: 'update', changedFields: ['valid_to'] }),
    en: 'Hazel Harbour changed the certification (valid to)',
    ar: 'Hazel Harbour غيّر الشهادة (valid to)',
  },
];

describe('narrate', () => {
  for (const c of CASES) {
    it(`says ${c.name} in both languages`, () => {
      expect(narrate(c.event, 'en')?.sentence).toBe(c.en);
      expect(narrate(c.event, 'ar')?.sentence).toBe(c.ar);
    });
  }

  it('carries the reason on its own, never inside the sentence', () => {
    const withdrawn = CASES.find((c) => c.name === 'withdrawing consent');
    const narration = narrate(withdrawn?.event ?? event({}), 'en');
    expect(narration?.reason).toBe('Asked by the parent at the door.');
    expect(narration?.sentence).not.toContain('Asked');
  });

  it('classifies events as create, change, read or system', () => {
    expect(narrate(event({}), 'en')?.kind).toBe('create');
    expect(narrate(event({ action: 'read' }), 'en')?.kind).toBe('read');
    expect(narrate(event({ action: 'list' }), 'en')?.kind).toBe('read');
    expect(narrate(event({ action: 'update', changedFields: ['status'] }), 'en')?.kind).toBe(
      'change',
    );
    expect(narrate(event({ actor: null }), 'en')?.kind).toBe('system');
  });

  it('drops housekeeping noise: an update that touched only the timestamp', () => {
    expect(narrate(event({ action: 'update', changedFields: ['updated_at'] }), 'en')).toBeNull();
    expect(narrate(event({ action: 'update', changedFields: [] }), 'en')).toBeNull();
  });

  it('never prints a redacted or long value', () => {
    const redacted = event({
      action: 'update',
      changedFields: ['referral_source'],
      newValues: { referral_source: '[redacted: 400 chars]' },
    });
    expect(narrate(redacted, 'en')?.sentence).toBe('Hazel Harbour changed the referral source');
    const long = event({
      action: 'update',
      changedFields: ['referral_source'],
      newValues: { referral_source: 'x'.repeat(200) },
    });
    expect(narrate(long, 'en')?.sentence).toBe('Hazel Harbour changed the referral source');
  });

  it('never leaks structure: no braces or quotation marks from raw data', () => {
    for (const c of CASES) {
      for (const locale of ['en', 'ar'] as const) {
        expect(narrate(c.event, locale)?.sentence).not.toMatch(/[{}"]/);
      }
    }
  });

  it('falls back to the generic wording for an entity or action the catalogue has no sentence for', () => {
    // An entity nothing above names: today's fallback, unchanged by the new sentences.
    expect(narrate(event({ entityType: 'widget' }), 'en')?.sentence).toBe(
      'Hazel Harbour added a widget',
    );
    expect(narrate(event({ entityType: 'widget' }), 'ar')?.sentence).toBe(
      'Hazel Harbour أضاف widget',
    );
    // goal.delete: goal has sentences for insert and update only, so delete still falls back.
    expect(narrate(event({ entityType: 'goal', action: 'delete' }), 'en')?.sentence).toBe(
      'Hazel Harbour removed a goal',
    );
    // An action nothing above names, on an entity that does have other special wording.
    expect(narrate(event({ entityType: 'client', action: 'sign' }), 'en')?.sentence).toBe(
      'Hazel Harbour recorded sign on the record',
    );
  });
});
