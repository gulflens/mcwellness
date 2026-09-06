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
  // The client portal (docs/SPEC/client-portal.md section 9,
  // docs/CHANGE-REQUESTS/client-portal-05.md item 8).
  {
    name: 'inviting a household to the portal',
    event: event({ entityType: 'portal_invite' }),
    en: 'Hazel Harbour invited this household to the portal',
    ar: 'Hazel Harbour دعا هذه الأسرة إلى البوابة',
  },
  {
    name: 'the household spending its invitation',
    event: event({
      entityType: 'portal_invite',
      action: 'update',
      changedFields: ['used_at', 'updated_at'],
    }),
    en: 'The household used its portal invitation',
    ar: 'استخدمت الأسرة دعوة البوابة الخاصة بها',
  },
  {
    name: 'revoking an invitation',
    event: event({
      entityType: 'portal_invite',
      action: 'update',
      changedFields: ['revoked_at'],
    }),
    en: 'Hazel Harbour revoked a portal invitation',
    ar: 'Hazel Harbour ألغى دعوة البوابة',
  },
  {
    name: 'a household asking for a consent to be withdrawn',
    event: event({
      entityType: 'portal_request',
      newValues: { kind: 'consent_withdrawal' },
    }),
    en: 'Hazel Harbour asked the practice, through the portal, to withdraw a consent',
    ar: 'Hazel Harbour طلب من المركز، عبر البوابة، سحب موافقة',
  },
  {
    name: 'a household asking to be forgotten',
    event: event({ entityType: 'portal_request', newValues: { kind: 'erasure' } }),
    en: 'Hazel Harbour asked the practice, through the portal, to erase the record',
    ar: 'Hazel Harbour طلب من المركز، عبر البوابة، محو السجل',
  },
  {
    name: 'the office marking a request handled',
    event: event({
      entityType: 'portal_request',
      action: 'update',
      changedFields: ['status', 'handled_at'],
    }),
    en: 'Hazel Harbour marked a portal request as handled',
    ar: 'Hazel Harbour حدّد طلب البوابة كمُعالج',
  },
  {
    name: 'sending a household its link',
    event: event({ entityType: 'portal_invite', action: 'portal.invite.sent' }),
    en: 'Hazel Harbour sent this household a link to the portal',
    ar: 'Hazel Harbour أرسل لهذه الأسرة رابطًا إلى البوابة',
  },
  {
    name: 'a household coming through the door',
    event: event({ entityType: 'portal_invite', action: 'portal.invite.redeemed' }),
    en: 'The household came through the portal door',
    ar: 'دخلت الأسرة عبر باب البوابة',
  },
  {
    name: "ending a household's access",
    event: event({ entityType: 'app_user', action: 'portal.access.revoked' }),
    en: "Hazel Harbour ended this household's access to the portal",
    ar: 'Hazel Harbour أنهى وصول هذه الأسرة إلى البوابة',
  },
  {
    name: 'a household correcting its own details',
    event: event({ entityType: 'contact', action: 'portal.contact.corrected' }),
    en: 'The household corrected its own contact details',
    ar: 'صحّحت الأسرة بيانات الاتصال الخاصة بها',
  },
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
    // The act, not the request: app/api/clients/erasure.ts writes one row
    // saying what the withheld trigger rows cannot (client-record-04 CR-16).
    name: 'erasing a record',
    event: event({ entityType: 'client', action: 'erase' }),
    en: 'Hazel Harbour erased this record',
    ar: 'Hazel Harbour محا هذا السجل',
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

describe('the equipment register and the setup photograph', () => {
  it('names an instrument by its kind and its serial when one is added', () => {
    const sentence = narrate(
      event({
        entityType: 'kit',
        action: 'insert',
        newValues: { kind: 'amplifier', serial: '0000000e-0000-4000-8000-000000000001' },
      }),
      'en',
    );
    expect(sentence?.sentence).toContain('added an instrument');
    expect(sentence?.sentence).toContain('amplifier');
  });

  it('says a calibration was recorded rather than listing two column names', () => {
    const sentence = narrate(
      event({
        entityType: 'kit',
        action: 'update',
        changedFields: ['last_calibrated_at', 'calibration_due_at', 'updated_at'],
      }),
      'en',
    );
    expect(sentence?.sentence).toContain('recorded a calibration');
  });

  it('says who carries it, and says standing it down in words', () => {
    expect(
      narrate(
        event({
          entityType: 'kit',
          action: 'update',
          changedFields: ['assigned_practitioner_id'],
        }),
        'en',
      )?.sentence,
    ).toContain('who carries this instrument');
    expect(
      narrate(
        event({
          entityType: 'kit',
          action: 'update',
          changedFields: ['status'],
          newValues: { status: 'inactive' },
        }),
        'en',
      )?.sentence,
    ).toContain('stood this instrument down');
  });

  it('says the setup photo was filed, and never says the document id', () => {
    const sentence = narrate(
      event({
        entityType: 'session',
        action: 'session.photo_filed',
        newValues: { documentId: '00000000-0000-4000-8000-0000000000f9' },
      }),
      'en',
    );
    expect(sentence?.sentence).toContain('filed the setup photo');
    expect(sentence?.sentence).not.toContain('0000000000f9');
  });

  it('writes all four in Arabic too', () => {
    for (const overrides of [
      { entityType: 'kit', action: 'insert', newValues: { kind: 'amplifier' } },
      { entityType: 'kit', action: 'update', changedFields: ['calibration_due_at'] },
      { entityType: 'kit', action: 'update', changedFields: ['assigned_practitioner_id'] },
      { entityType: 'session', action: 'session.photo_filed' },
    ] as Partial<AuditEvent>[]) {
      const sentence = narrate(event(overrides), 'ar')?.sentence ?? '';
      expect(/[\u0600-\u06FF]/.test(sentence), JSON.stringify(overrides)).toBe(true);
    }
  });
});

describe('measurements', () => {
  // docs/SPEC/assessment.md section 8, docs/CHANGE-REQUESTS/assessment-01.md
  // item 6. The trail says a measurement was taken and by whom; the figures
  // themselves are read on the record, never here.
  it('tells a first recording from a correction', () => {
    expect(
      narrate(event({ entityType: 'assessment', action: 'insert' }), 'en')?.sentence,
    ).toContain('recorded a measurement');
    expect(
      narrate(
        event({ entityType: 'assessment', action: 'insert', newValues: { version: 2 } }),
        'en',
      )?.sentence,
    ).toContain('corrected version');
  });

  it('says an erasure cleared the words beside a measurement', () => {
    expect(
      narrate(
        event({
          entityType: 'assessment',
          action: 'update',
          changedFields: ['condition_note', 'supersede_reason'],
        }),
        'en',
      )?.sentence,
    ).toContain('cleared the words');
  });

  it('says a measurement was read, and a refusal was refused', () => {
    expect(narrate(event({ entityType: 'assessment', action: 'read' }), 'en')?.sentence).toContain(
      'read a measurement',
    );
    expect(narrate(event({ entityType: 'assessment', action: 'list' }), 'en')?.sentence).toContain(
      'read a measurement',
    );
    expect(
      narrate(event({ entityType: 'assessment', action: 'refused' }), 'en')?.sentence,
    ).toContain('was refused');
  });

  it('says a file was filed, and never says the document id', () => {
    const sentence = narrate(
      event({
        entityType: 'assessment',
        action: 'assessment.file_filed',
        newValues: { documentId: '00000000-0000-4000-8000-0000000000f9', role: 'raw' },
      }),
      'en',
    )?.sentence;
    expect(sentence).toContain("filed the software's own export");
    expect(sentence).not.toContain('0000000000f9');
  });

  it('says a file was attached and, on an erasure, removed', () => {
    expect(
      narrate(event({ entityType: 'assessment_document', action: 'insert' }), 'en')?.sentence,
    ).toContain('attached a file');
    expect(
      narrate(event({ entityType: 'assessment_document', action: 'delete' }), 'en')?.sentence,
    ).toContain('removed a measurement');
  });

  it('writes every one of them in Arabic too', () => {
    for (const overrides of [
      { entityType: 'assessment', action: 'insert' },
      { entityType: 'assessment', action: 'insert', newValues: { version: 2 } },
      {
        entityType: 'assessment',
        action: 'update',
        changedFields: ['condition_note'],
      },
      { entityType: 'assessment', action: 'read' },
      { entityType: 'assessment', action: 'list' },
      { entityType: 'assessment', action: 'refused' },
      { entityType: 'assessment', action: 'assessment.file_filed' },
      { entityType: 'assessment_document', action: 'insert' },
      { entityType: 'assessment_document', action: 'delete' },
    ] as Partial<AuditEvent>[]) {
      const sentence = narrate(event(overrides), 'ar')?.sentence ?? '';
      expect(/[\u0600-\u06FF]/.test(sentence), JSON.stringify(overrides)).toBe(true);
    }
  });
});

describe('reports (docs/SPEC/reports-v1.md section 8)', () => {
  it('says a report was signed and issued, naming its kind and reference', () => {
    const sentence = narrate(
      event({
        entityType: 'report',
        action: 'report.issued',
        newValues: { kind: 'progress', reference: 'RPT-000001', version: '1' },
      }),
      'en',
    );
    expect(sentence?.sentence).toBe('Hazel Harbour signed and issued a progress report RPT-000001');
  });

  it('says a report was replaced, and leaves the reason to the reason column', () => {
    const sentence = narrate(
      event({
        entityType: 'report',
        action: 'report.superseded',
        newValues: { reason: 'The visit date was wrong.', version: '2' },
        reason: 'The visit date was wrong.',
      }),
      'en',
    );
    expect(sentence?.sentence).toBe('Hazel Harbour replaced this report with version 2');
    expect(sentence?.reason).toBe('The visit date was wrong.');
  });

  it('says a report was sent and by which door, and never who to', () => {
    // The contact's id is on the row; a telephone number is nowhere near the
    // trail (docs/SPEC/audit.md section 8).
    const sentence = narrate(
      event({
        entityType: 'report',
        action: 'send',
        newValues: {
          channel: 'whatsapp',
          contactId: '00000001-0000-4000-8000-000000000003',
          delivered: 'false',
        },
      }),
      'en',
    );
    expect(sentence?.sentence).toBe('Hazel Harbour sent this report to the household on WhatsApp');
    expect(sentence?.sentence).not.toContain('000000000003');
    expect(sentence?.sentence).not.toMatch(/\+?971/);
  });

  it('says by email where that was the door', () => {
    const sentence = narrate(
      event({ entityType: 'report', action: 'send', newValues: { channel: 'email' } }),
      'en',
    );
    expect(sentence?.sentence).toContain('by email');
  });

  it('says a report was read, whether one or a list', () => {
    for (const action of ['read', 'list']) {
      expect(narrate(event({ entityType: 'report', action }), 'en')?.sentence).toBe(
        'Hazel Harbour read this report',
      );
    }
  });

  it('says a refused signature was refused', () => {
    expect(
      narrate(
        event({
          entityType: 'report',
          action: 'report.issue_refused',
          newValues: { reason: 'credential_lapsed' },
        }),
        'en',
      )?.sentence,
    ).toBe('Hazel Harbour tried to sign a report and was refused');
  });

  it('falls back to a plain sentence for an ordinary draft moving', () => {
    expect(narrate(event({ entityType: 'report', action: 'insert' }), 'en')?.sentence).toBe(
      'Hazel Harbour added a report',
    );
  });

  it('writes every one of them in Arabic too', () => {
    for (const overrides of [
      { entityType: 'report', action: 'report.issued', newValues: { kind: 'progress' } },
      { entityType: 'report', action: 'report.superseded', newValues: { version: '2' } },
      { entityType: 'report', action: 'send', newValues: { channel: 'whatsapp' } },
      { entityType: 'report', action: 'send', newValues: { channel: 'email' } },
      { entityType: 'report', action: 'read' },
      { entityType: 'report', action: 'report.issue_refused' },
      { entityType: 'report', action: 'report.supersede_refused' },
      { entityType: 'report', action: 'report.deliver_refused' },
      { entityType: 'report', action: 'insert' },
    ] as Partial<AuditEvent>[]) {
      const sentence = narrate(event(overrides), 'ar')?.sentence ?? '';
      expect(/[\u0600-\u06FF]/.test(sentence), JSON.stringify(overrides)).toBe(true);
    }
  });
});
