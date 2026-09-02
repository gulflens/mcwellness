/**
 * The audit trail in sentences (docs/SPEC/audit.md section 9). The log stores
 * structured rows; this catalogue, keyed by what happened, turns one row into
 * one plain sentence in English or Arabic. Pure: an event and a locale in,
 * strings out. Never a raw value dump: values appear only where the catalogue
 * names them, and a redacted or long value renders as the field alone.
 */

export type Locale = 'en' | 'ar';

export type AuditActor = { id: string; name: string | null; roles: readonly string[] };

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actor: AuditActor | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  changedFields: readonly string[] | null;
  oldValues: Readonly<Record<string, unknown>> | null;
  newValues: Readonly<Record<string, unknown>> | null;
  reason: string | null;
};

export type NarrationKind = 'create' | 'change' | 'read' | 'system' | 'other';

export type Narration = { sentence: string; reason: string | null; kind: NarrationKind };

type Text = { en: string; ar: string };
const t = (en: string, ar: string): Text => ({ en, ar });
const pick = (text: Text, locale: Locale): string => text[locale];

/** Housekeeping columns a person never needs to read about. */
const NOISE = new Set(['updated_at']);

const ENTITY: Record<string, Text> = {
  client: t('record', 'السجل'),
  contact: t('contact', 'جهة الاتصال'),
  consent: t('consent', 'الموافقة'),
  location: t('location', 'الموقع'),
  document: t('document', 'المستند'),
  credential: t('certification', 'الشهادة'),
  practitioner: t('practitioner', 'الممارس'),
  app_user: t('user', 'المستخدم'),
  user_role: t('role', 'الدور'),
  service_type: t('service', 'الخدمة'),
  tenant: t('practice', 'المركز'),
};

const STATUS: Record<string, Text> = {
  lead: t('Lead', 'مهتم'),
  active: t('Active', 'نشط'),
  paused: t('Paused', 'متوقف مؤقتًا'),
  closed: t('Closed', 'مغلق'),
  erased: t('Erased', 'ممحو'),
};

const PURPOSE: Record<string, Text> = {
  participation: t('participation', 'المشاركة'),
  minor_participation: t("a minor's participation", 'مشاركة القاصر'),
  home_visit: t('home visit', 'الزيارة المنزلية'),
  photo_video: t('photo and video', 'الصور والفيديو'),
  research: t('research', 'البحث'),
  marketing: t('marketing', 'التسويق'),
};

const METHOD: Record<string, Text> = {
  app_signature: t('by signature in the app', 'بالتوقيع في التطبيق'),
  paper_scan: t('from a scanned paper form', 'من نموذج ورقي ممسوح'),
  verbal_witnessed: t('verbally, witnessed', 'شفهيًا بحضور شاهد'),
};

const RELATIONSHIP: Record<string, Text> = {
  self: t('self', 'الشخص نفسه'),
  mother: t('mother', 'الأم'),
  father: t('father', 'الأب'),
  guardian: t('guardian', 'الوصي'),
  spouse: t('spouse', 'الزوج/الزوجة'),
  other: t('other', 'أخرى'),
};

const EMIRATE: Record<string, Text> = {
  DXB: t('Dubai', 'دبي'),
  AUH: t('Abu Dhabi', 'أبوظبي'),
  SHJ: t('Sharjah', 'الشارقة'),
  AJM: t('Ajman', 'عجمان'),
  UAQ: t('Umm Al Quwain', 'أم القيوين'),
  RAK: t('Ras Al Khaimah', 'رأس الخيمة'),
  FUJ: t('Fujairah', 'الفجيرة'),
};

const LOCATION_LABEL: Record<string, Text> = {
  home: t('home', 'المنزل'),
  work: t('work', 'العمل'),
  school: t('school', 'المدرسة'),
  studio: t('studio', 'الاستوديو'),
  base: t('base', 'المقر'),
  other: t('other', 'أخرى'),
};

const LOCALE_NAME: Record<string, Text> = {
  en: t('English', 'الإنجليزية'),
  ar: t('Arabic', 'العربية'),
};

const FIELD: Record<string, Text> = {
  status: t('status', 'الحالة'),
  given_name: t('name', 'الاسم'),
  family_name: t('name', 'الاسم'),
  given_name_ar: t('name', 'الاسم'),
  family_name_ar: t('name', 'الاسم'),
  date_of_birth: t('date of birth', 'تاريخ الميلاد'),
  sex_at_birth: t('sex at birth', 'الجنس عند الولادة'),
  preferred_locale: t('preferred language', 'اللغة المفضلة'),
  primary_contact_id: t('primary contact', 'جهة الاتصال الرئيسية'),
  primary_location_id: t('primary location', 'الموقع الرئيسي'),
  referral_source: t('referral source', 'مصدر الإحالة'),
  mrn: t('record number', 'رقم السجل'),
  relationship: t('relationship', 'صلة القرابة'),
  phone: t('phone number', 'رقم الهاتف'),
  email: t('email address', 'البريد الإلكتروني'),
  whatsapp_opt_in: t('WhatsApp messages', 'رسائل واتساب'),
  access_notes: t('access notes', 'ملاحظات الوصول'),
  display_address: t('address', 'العنوان'),
  makani_number: t('Makani number', 'رقم مكاني'),
};

function label(map: Record<string, Text>, key: unknown, locale: Locale): string | null {
  if (typeof key !== 'string') return null;
  const found = map[key];
  return found ? pick(found, locale) : null;
}

function fieldLabel(field: string, locale: Locale): string {
  return label(FIELD, field, locale) ?? field.replace(/_/g, ' ');
}

/** A value fit to print: short scalars only; redacted or long text stays unsaid. */
function scalar(values: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = values?.[key];
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string' || value.startsWith('[redacted') || value.startsWith('[withheld')) {
    return null;
  }
  return value.length > 80 ? null : value;
}

function bool(values: Readonly<Record<string, unknown>> | null, key: string): boolean | null {
  const value = values?.[key];
  return typeof value === 'boolean' ? value : null;
}

function joinClauses(clauses: string[], locale: Locale): string {
  if (clauses.length <= 1) return clauses.join('');
  const and = locale === 'ar' ? ' و' : ' and ';
  const comma = locale === 'ar' ? '، ' : ', ';
  return clauses.slice(0, -1).join(comma) + and + clauses[clauses.length - 1];
}

function actorPhrase(event: AuditEvent, locale: Locale): string {
  if (event.actor?.name) return event.actor.name;
  return locale === 'ar' ? 'النظام' : 'The system';
}

function kindOf(event: AuditEvent): NarrationKind {
  if (event.action === 'read' || event.action === 'list') return 'read';
  if (event.action === 'insert') return event.actor ? 'create' : 'system';
  if (event.action === 'update') return 'change';
  return 'other';
}

function clientClauses(event: AuditEvent, fields: string[], locale: Locale): string[] {
  const clauses: string[] = [];
  let nameSaid = false;
  for (const field of fields) {
    switch (field) {
      case 'status': {
        const from = label(STATUS, event.oldValues?.status, locale);
        const to = label(STATUS, event.newValues?.status, locale);
        clauses.push(
          from && to
            ? pick(
                t(`changed the status from ${from} to ${to}`, `غيّر الحالة من ${from} إلى ${to}`),
                locale,
              )
            : pick(t('changed the status', 'غيّر الحالة'), locale),
        );
        break;
      }
      case 'given_name':
      case 'family_name':
      case 'given_name_ar':
      case 'family_name_ar':
        if (!nameSaid) {
          clauses.push(pick(t('changed the name', 'غيّر الاسم'), locale));
          nameSaid = true;
        }
        break;
      case 'date_of_birth': {
        const to = scalar(event.newValues, 'date_of_birth');
        clauses.push(
          to
            ? pick(t(`set the date of birth to ${to}`, `حدّد تاريخ الميلاد إلى ${to}`), locale)
            : pick(t('changed the date of birth', 'غيّر تاريخ الميلاد'), locale),
        );
        break;
      }
      case 'preferred_locale': {
        const to = label(LOCALE_NAME, event.newValues?.preferred_locale, locale);
        clauses.push(
          to
            ? pick(t(`set the preferred language to ${to}`, `حدّد اللغة المفضلة إلى ${to}`), locale)
            : pick(t('changed the preferred language', 'غيّر اللغة المفضلة'), locale),
        );
        break;
      }
      case 'primary_contact_id':
        clauses.push(pick(t('set the primary contact', 'حدّد جهة الاتصال الرئيسية'), locale));
        break;
      case 'primary_location_id':
        clauses.push(pick(t('set the primary location', 'حدّد الموقع الرئيسي'), locale));
        break;
      case 'referral_source': {
        const to = scalar(event.newValues, 'referral_source');
        clauses.push(
          to
            ? pick(t(`changed the referral source to ${to}`, `غيّر مصدر الإحالة إلى ${to}`), locale)
            : pick(t('changed the referral source', 'غيّر مصدر الإحالة'), locale),
        );
        break;
      }
      case 'mrn': {
        const to = scalar(event.newValues, 'mrn');
        clauses.push(
          to
            ? pick(t(`changed the record number to ${to}`, `غيّر رقم السجل إلى ${to}`), locale)
            : pick(t('changed the record number', 'غيّر رقم السجل'), locale),
        );
        break;
      }
      default:
        clauses.push(
          pick(
            t(`updated the ${fieldLabel(field, locale)}`, `حدّث ${fieldLabel(field, locale)}`),
            locale,
          ),
        );
    }
  }
  return clauses;
}

function contactClauses(event: AuditEvent, fields: string[], locale: Locale): string[] {
  const clauses: string[] = [];
  const onOff = (field: string, on: Text, off: Text): void => {
    const value = bool(event.newValues, field);
    clauses.push(pick(value === false ? off : on, locale));
  };
  for (const field of fields) {
    switch (field) {
      case 'relationship': {
        const to = label(RELATIONSHIP, event.newValues?.relationship, locale);
        clauses.push(
          to
            ? pick(
                t(`changed the contact's relationship to ${to}`, `غيّر صلة جهة الاتصال إلى ${to}`),
                locale,
              )
            : pick(t("changed the contact's relationship", 'غيّر صلة جهة الاتصال'), locale),
        );
        break;
      }
      case 'is_legal_guardian':
        onOff(
          field,
          t('marked the contact as legal guardian', 'حدّد جهة الاتصال وصيًا قانونيًا'),
          t(
            'removed the legal-guardian mark from the contact',
            'أزال صفة الوصي القانوني عن جهة الاتصال',
          ),
        );
        break;
      case 'can_consent':
        onOff(
          field,
          t('allowed the contact to give consent', 'سمح لجهة الاتصال بإعطاء الموافقة'),
          t("withdrew the contact's right to give consent", 'سحب حق جهة الاتصال في إعطاء الموافقة'),
        );
        break;
      case 'can_receive_reports':
        onOff(
          field,
          t('allowed the contact to receive reports', 'سمح لجهة الاتصال بتلقي التقارير'),
          t('stopped reports to the contact', 'أوقف إرسال التقارير إلى جهة الاتصال'),
        );
        break;
      case 'can_pay':
        onOff(
          field,
          t('marked the contact as a payer', 'حدّد جهة الاتصال دافعًا'),
          t('removed the payer mark from the contact', 'أزال صفة الدافع عن جهة الاتصال'),
        );
        break;
      case 'whatsapp_opt_in':
        onOff(
          field,
          t('turned WhatsApp messages on for the contact', 'فعّل رسائل واتساب لجهة الاتصال'),
          t('turned WhatsApp messages off for the contact', 'أوقف رسائل واتساب لجهة الاتصال'),
        );
        break;
      case 'phone':
        clauses.push(
          pick(t("changed the contact's phone number", 'غيّر رقم هاتف جهة الاتصال'), locale),
        );
        break;
      case 'email':
        clauses.push(
          pick(
            t("changed the contact's email address", 'غيّر البريد الإلكتروني لجهة الاتصال'),
            locale,
          ),
        );
        break;
      case 'user_id':
        clauses.push(
          pick(t("changed the contact's login link", 'غيّر ربط تسجيل دخول جهة الاتصال'), locale),
        );
        break;
      case 'emirates_id_encrypted':
      case 'emirates_id_hash':
        if (
          !clauses.includes(
            pick(t("updated the contact's identity record", 'حدّث سجل هوية جهة الاتصال'), locale),
          )
        ) {
          clauses.push(
            pick(t("updated the contact's identity record", 'حدّث سجل هوية جهة الاتصال'), locale),
          );
        }
        break;
      default:
        clauses.push(
          pick(
            t(
              `updated the contact's ${fieldLabel(field, locale)}`,
              `حدّث ${fieldLabel(field, locale)} لجهة الاتصال`,
            ),
            locale,
          ),
        );
    }
  }
  return clauses;
}

function locationClauses(fields: string[], locale: Locale): string[] {
  return fields.map((field) => {
    switch (field) {
      case 'entrance_point':
        return pick(t('verified the entrance pin', 'تحقق من دبوس المدخل'), locale);
      case 'parking_point':
        return pick(t('set the parking pin', 'حدّد دبوس موقف السيارات'), locale);
      case 'community_gate':
        return pick(t('set the community gate pin', 'حدّد دبوس بوابة المجمع'), locale);
      case 'makani_number':
        return pick(t('set the Makani number', 'حدّد رقم مكاني'), locale);
      case 'display_address':
        return pick(t('changed the address', 'غيّر العنوان'), locale);
      case 'access_notes':
        return pick(t('updated the access notes', 'حدّث ملاحظات الوصول'), locale);
      case 'is_primary':
        return pick(t('changed which location is primary', 'غيّر الموقع الرئيسي'), locale);
      default:
        return pick(
          t(
            `changed the location's ${fieldLabel(field, locale)}`,
            `غيّر ${fieldLabel(field, locale)} للموقع`,
          ),
          locale,
        );
    }
  });
}

function sentenceFor(event: AuditEvent, locale: Locale): string | null {
  const actor = actorPhrase(event, locale);
  const key = `${event.entityType}.${event.action}`;
  const fields = (event.changedFields ?? []).filter((f) => !NOISE.has(f));
  if (event.action === 'update' && fields.length === 0) return null;

  switch (key) {
    case 'client.insert':
      return pick(t(`${actor} created the record`, `${actor} أنشأ السجل`), locale);
    case 'client.read':
      return pick(t(`${actor} viewed this record`, `${actor} اطّلع على هذا السجل`), locale);
    case 'client.list':
      return pick(
        t(`${actor} saw this record in a list`, `${actor} رأى هذا السجل في قائمة`),
        locale,
      );
    case 'client.update':
      return `${actor} ${joinClauses(clientClauses(event, fields, locale), locale)}`;
    case 'contact.insert': {
      const rel = label(RELATIONSHIP, event.newValues?.relationship, locale);
      return rel
        ? pick(t(`${actor} added a contact (${rel})`, `${actor} أضاف جهة اتصال (${rel})`), locale)
        : pick(t(`${actor} added a contact`, `${actor} أضاف جهة اتصال`), locale);
    }
    case 'contact.update':
      return `${actor} ${joinClauses(contactClauses(event, fields, locale), locale)}`;
    case 'consent.insert': {
      const purpose = label(PURPOSE, event.newValues?.purpose, locale) ?? pick(t('a', ''), locale);
      const version = scalar(event.newValues, 'version');
      const method = label(METHOD, event.newValues?.method, locale);
      const parts = [
        pick(t(`${actor} recorded ${purpose} consent`, `${actor} سجّل موافقة ${purpose}`), locale),
        version ? pick(t(`version ${version}`, `الإصدار ${version}`), locale) : null,
        method,
      ].filter((p): p is string => p !== null);
      return parts.join(locale === 'ar' ? '، ' : ', ');
    }
    case 'consent.update': {
      const purpose = label(PURPOSE, event.newValues?.purpose, locale) ?? '';
      const status = event.newValues?.status;
      if (fields.includes('status') && status === 'withdrawn') {
        return pick(
          t(`${actor} withdrew ${purpose} consent`, `${actor} سحب موافقة ${purpose}`),
          locale,
        );
      }
      if (fields.includes('status') && status === 'expired') {
        return pick(
          t(
            `${actor} marked ${purpose} consent as expired`,
            `${actor} حدّد موافقة ${purpose} منتهية`,
          ),
          locale,
        );
      }
      if (fields.includes('status') && status === 'superseded') {
        return pick(
          t(
            `${actor} superseded ${purpose} consent with a newer version`,
            `${actor} استبدل موافقة ${purpose} بإصدار أحدث`,
          ),
          locale,
        );
      }
      return pick(
        t(`${actor} updated ${purpose} consent`, `${actor} حدّث موافقة ${purpose}`),
        locale,
      );
    }
    case 'location.insert': {
      const kind = label(LOCATION_LABEL, event.newValues?.label, locale);
      const emirate = label(EMIRATE, event.newValues?.emirate, locale);
      if (kind && emirate) {
        return pick(
          t(
            `${actor} added a ${kind} location in ${emirate}`,
            `${actor} أضاف موقع ${kind} في ${emirate}`,
          ),
          locale,
        );
      }
      return pick(t(`${actor} added a location`, `${actor} أضاف موقعًا`), locale);
    }
    case 'location.update':
      return `${actor} ${joinClauses(locationClauses(fields, locale), locale)}`;
    case 'document.insert': {
      const kind = scalar(event.newValues, 'kind');
      return kind
        ? pick(t(`${actor} filed a document (${kind})`, `${actor} أودع مستندًا (${kind})`), locale)
        : pick(t(`${actor} filed a document`, `${actor} أودع مستندًا`), locale);
    }
    default: {
      const entity = label(ENTITY, event.entityType, locale) ?? event.entityType.replace(/_/g, ' ');
      switch (event.action) {
        case 'insert':
          return pick(t(`${actor} added a ${entity}`, `${actor} أضاف ${entity}`), locale);
        case 'update': {
          const what = fields.map((f) => fieldLabel(f, locale)).join(locale === 'ar' ? '، ' : ', ');
          return pick(
            t(`${actor} changed the ${entity} (${what})`, `${actor} غيّر ${entity} (${what})`),
            locale,
          );
        }
        case 'delete':
          return pick(t(`${actor} removed a ${entity}`, `${actor} أزال ${entity}`), locale);
        case 'read':
          return pick(t(`${actor} viewed the ${entity}`, `${actor} اطّلع على ${entity}`), locale);
        default:
          return pick(
            t(
              `${actor} recorded ${event.action} on the ${entity}`,
              `${actor} سجّل ${event.action} على ${entity}`,
            ),
            locale,
          );
      }
    }
  }
}

/** One sentence for one event, or null when the event is housekeeping noise. */
export function narrate(event: AuditEvent, locale: Locale): Narration | null {
  const sentence = sentenceFor(event, locale);
  if (sentence === null) return null;
  const reason = event.reason?.trim() || null;
  return { sentence, reason, kind: kindOf(event) };
}
