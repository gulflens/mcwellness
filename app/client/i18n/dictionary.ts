/**
 * Every word the portal says, in both languages
 * (docs/SPEC/client-portal.md sections 3 and 4). A hardcoded sentence anywhere
 * under `app/client/` fails review; this is where they live.
 *
 * **Both editions are written together, on one line each.** That is the point
 * of the shape: an English sentence and its Arabic sit side by side, so a
 * change to one that forgets the other is visible in the diff rather than
 * discovered by a household. `tests/portal/dictionary.test.ts` proves neither
 * half is ever empty.
 *
 * **Tone** (section 4). British English, short sentences, plain words first.
 * The client is a client; the people around them are the people on the record;
 * a session is a session. Never diagnosis, treatment, patient or a condition.
 * No growth language, no nudges, no emoji.
 *
 * The few phrases that carry a number or a name are functions rather than
 * strings, because word order differs between the two languages and a template
 * assembled at the call site would put the Arabic in the English's order.
 */

export type Locale = 'en' | 'ar';
export type Phrase = { en: string; ar: string };

const t = (en: string, ar: string): Phrase => ({ en, ar });

export const WORDS = {
  // The shell around every screen.
  portal: t('Your record', 'سجلك'),
  home: t('Home', 'الرئيسية'),
  visits: t('Visits', 'الزيارات'),
  money: t('Money', 'الحساب'),
  family: t('Family', 'العائلة'),
  agreements: t('Agreements', 'الموافقات'),
  menu: t('Menu', 'القائمة'),
  signOut: t('Sign out', 'تسجيل الخروج'),
  language: t('Language', 'اللغة'),
  english: t('English', 'الإنجليزية'),
  arabic: t('Arabic', 'العربية'),

  // The three states every screen can be in.
  loading: t('Loading.', 'جارٍ التحميل.'),
  loadFailed: t('That could not be loaded. Try again.', 'تعذّر التحميل. حاول مرة أخرى.'),
  saveFailed: t('That could not be saved. Try again.', 'تعذّر الحفظ. حاول مرة أخرى.'),
  saved: t('Saved.', 'تم الحفظ.'),
  notYours: t('This part of the record is not yours to open.', 'هذا الجزء من السجل ليس لك لفتحه.'),

  // Home.
  nextVisit: t('Your next visit', 'زيارتك القادمة'),
  nothingBooked: t('Nothing is booked at the moment.', 'لا توجد زيارة محجوزة حاليًا.'),
  waitingOnYou: t('Waiting on you', 'بانتظارك'),
  askForVisit: t('Asking for a visit', 'طلب زيارة'),
  askForVisitBody: t(
    'The portal does not book visits. Message the practice and it will arrange one with you.',
    'لا تحجز البوابة الزيارات. راسل المركز وسيرتّب لك موعدًا.',
  ),
  messageThePractice: t('Message the practice', 'راسل المركز'),
  noWhatsapp: t(
    'The practice has not recorded a WhatsApp number. Contact it the usual way.',
    'لم يسجّل المركز رقم واتساب. تواصل معه بالطريقة المعتادة.',
  ),
  newerWording: t(
    'A newer version of this wording exists. The practice will ask you to read it.',
    'يوجد إصدار أحدث من هذا النص. سيطلب منك المركز قراءته.',
  ),
  requestOpen: t('The practice has your request.', 'استلم المركز طلبك.'),
  requestHandled: t('The practice has dealt with your request.', 'عالج المركز طلبك.'),

  // Money, in words before figures.
  owed: t('Owed', 'المستحق'),
  inCredit: t('In credit', 'رصيد لك'),
  settled: t('Settled', 'مسدَّد'),
  balance: t('Balance', 'الرصيد'),
  amountsInAed: t('Amounts in AED', 'المبالغ بالدرهم'),
  packages: t('Programmes', 'البرامج'),
  invoices: t('Invoices', 'الفواتير'),
  payments: t('Payments and receipts', 'المدفوعات والإيصالات'),
  reference: t('Reference', 'المرجع'),
  date: t('Date', 'التاريخ'),
  amount: t('Amount', 'المبلغ'),
  method: t('Method', 'طريقة الدفع'),
  receipt: t('Receipt', 'الإيصال'),
  document: t('Document', 'المستند'),
  open: t('Open', 'فتح'),
  expires: t('Expires', 'ينتهي في'),
  noInvoices: t('No invoices yet.', 'لا توجد فواتير بعد.'),
  noPayments: t('No payments yet.', 'لا توجد مدفوعات بعد.'),
  noPackages: t('No programme is running.', 'لا يوجد برنامج جارٍ.'),
  linkFailed: t('That document could not be opened.', 'تعذّر فتح هذا المستند.'),

  // Visits.
  upcoming: t('Upcoming', 'القادمة'),
  past: t('Past', 'السابقة'),
  nothingUpcoming: t('No visits are booked.', 'لا توجد زيارات محجوزة.'),
  nothingPast: t('No visits yet.', 'لا توجد زيارات بعد.'),
  arrivalWindow: t('Arrival window', 'نافذة الوصول'),
  atHome: t('At home', 'في المنزل'),
  atStudio: t('At the studio', 'في الاستوديو'),
  online: t('Online', 'عن بُعد'),

  // Family.
  addressLabel: t('Address', 'العنوان'),
  addressReadOnly: t(
    'The practice changes the address, because it is where the practitioner drives.',
    'المركز هو من يغيّر العنوان، لأنه المكان الذي يقصده الممارس.',
  ),
  noAddress: t('No address is on the record.', 'لا يوجد عنوان في السجل.'),
  peopleOnRecord: t('People on the record', 'الأشخاص في السجل'),
  canConsent: t('can give consent', 'يمكنه إعطاء الموافقة'),
  canReceiveReports: t('receives reports', 'يتلقّى التقارير'),
  canPay: t('pays', 'يدفع'),
  thisIsYou: t('This is you', 'هذا أنت'),
  yourDetails: t('Your details', 'بياناتك'),
  telephone: t('Telephone', 'الهاتف'),
  email: t('Email', 'البريد الإلكتروني'),
  whatsappOptIn: t('Happy to be messaged on WhatsApp', 'أوافق على المراسلة عبر واتساب'),
  save: t('Save', 'حفظ'),
  saving: t('Saving.', 'جارٍ الحفظ.'),
  badPhone: t('A telephone number is +971 50 000 0000.', 'رقم الهاتف بالشكل ‎+971 50 000 0000.'),
  badEmail: t(
    'An email address is somebody@example.com.',
    'البريد الإلكتروني بالشكل somebody@example.com.',
  ),
  notRecorded: t('Not recorded', 'غير مسجّل'),

  // Agreements.
  given: t('Given', 'أُعطيت في'),
  withdrawn: t('Withdrawn', 'سُحبت في'),
  givenBy: t('Given by', 'أعطاها'),
  readTheWording: t('Read the wording', 'اقرأ النص'),
  askToWithdraw: t('Ask to withdraw', 'اطلب السحب'),
  askForErasure: t('Ask for erasure', 'اطلب محو السجل'),
  askNote: t(
    'Tell the practice anything it should know (optional)',
    'أخبر المركز بما ينبغي أن يعرفه (اختياري)',
  ),
  send: t('Send', 'إرسال'),
  cancel: t('Cancel', 'إلغاء'),
  askedAlready: t('The practice has your request.', 'استلم المركز طلبك.'),
  nothingWithdraws: t(
    'Nothing here withdraws or erases anything. The practice will be in touch.',
    'لا شيء هنا يسحب موافقة أو يمحو سجلًا. سيتواصل معك المركز.',
  ),
  noAgreements: t('Nothing has been agreed yet.', 'لم تتم الموافقة على شيء بعد.'),

  // Reports (docs/SPEC/reports-v1.md section 7.3).
  reports: t('Reports', 'التقارير'),
  reportsBody: t(
    'The reports the practice has written for you. Each one opens as a document you can keep.',
    'التقارير التي كتبها المركز لك. يفتح كل تقرير كمستند يمكنك الاحتفاظ به.',
  ),
  noReports: t('No reports have been written yet.', 'لم تُكتب أي تقارير بعد.'),
  sessionReport: t('Session report', 'تقرير الجلسة'),
  progressReport: t('Progress report', 'تقرير التقدّم'),
  reportCovers: t('Covers', 'يغطي'),
  reportIssued: t('Issued', 'صدر في'),
  reportReplaced: t('Replaced by a newer version', 'استُبدل بإصدار أحدث'),

  // The invitation page.
  setUpSignIn: t('Set up your sign-in', 'أنشئ تسجيل الدخول'),
  setUpSignInBody: t(
    'Choose an email address and a password. You will use them to open your record.',
    'اختر بريدًا إلكترونيًا وكلمة مرور. ستستخدمهما لفتح سجلك.',
  ),
  passwordLabel: t('Password', 'كلمة المرور'),
  passwordAgainLabel: t('Password again', 'كلمة المرور مرة أخرى'),
  passwordRule: t('At least twelve characters.', 'اثنا عشر حرفًا على الأقل.'),
  passwordsDiffer: t('The two passwords are not the same.', 'كلمتا المرور غير متطابقتين.'),
  linkDead: t(
    'This link no longer works. Ask the practice for a new one.',
    'لم يعد هذا الرابط يعمل. اطلب من المركز رابطًا جديدًا.',
  ),
  emailTaken: t(
    'That email address already signs in here. Try another.',
    'هذا البريد الإلكتروني مستخدم بالفعل. جرّب بريدًا آخر.',
  ),
  signInsUnavailable: t(
    'Sign-ins cannot be set up just now. Ask the practice.',
    'لا يمكن إنشاء تسجيل الدخول الآن. اسأل المركز.',
  ),
  tryTheLinkAgain: t('Something went wrong. Try the link again.', 'حدث خطأ. جرّب الرابط مرة أخرى.'),
} as const satisfies Record<string, Phrase>;

export type WordKey = keyof typeof WORDS;

/**
 * The plain words for a consent purpose (section 3.6). Never the enum value:
 * `minor_participation` is a column name, not something a parent reads.
 */
export const PURPOSES: Record<string, Phrase> = {
  participation: t('taking part in the programme', 'المشاركة في البرنامج'),
  minor_participation: t('taking part as a minor', 'مشاركة قاصر'),
  home_visit: t('sessions at home', 'الجلسات في المنزل'),
  photo_video: t('photos and video', 'الصور والفيديو'),
  research: t('research', 'البحث'),
  marketing: t('marketing', 'التسويق'),
};

/** How somebody is related to the client (section 3.6). */
export const RELATIONSHIPS: Record<string, Phrase> = {
  self: t('the client', 'الشخص نفسه'),
  mother: t('mother', 'الأم'),
  father: t('father', 'الأب'),
  guardian: t('guardian', 'الوصي'),
  spouse: t('spouse', 'الزوج/الزوجة'),
  other: t('other', 'أخرى'),
};

/** Where a session happens (section 3.6). */
export const DELIVERY: Record<string, Phrase> = {
  home: WORDS.atHome,
  studio: WORDS.atStudio,
  remote: WORDS.online,
};

/** What a consent's own status is called. */
export const CONSENT_STATUS: Record<string, Phrase> = {
  active: t('Active', 'سارية'),
  withdrawn: t('Withdrawn', 'مسحوبة'),
  expired: t('Expired', 'منتهية'),
  superseded: t('Replaced', 'مستبدَلة'),
};

/** How a household pays. */
export const PAYMENT_METHOD: Record<string, Phrase> = {
  cash: t('Cash', 'نقدًا'),
  card: t('Card', 'بطاقة'),
  transfer: t('Bank transfer', 'حوالة بنكية'),
  cheque: t('Cheque', 'شيك'),
  link: t('Payment link', 'رابط دفع'),
};

/**
 * The phrases that carry a value. Functions, not templates, because Arabic
 * puts the pieces in a different order and a sentence assembled at the call
 * site would put the Arabic in the English's.
 */
export const PHRASES = {
  sessionOf: (used: number, total: number): Phrase =>
    t(`Session ${used} of ${total}`, `الجلسة ${used} من ${total}`),
  windowFromTo: (from: string, to: string): Phrase => t(`${from} to ${to}`, `من ${from} إلى ${to}`),
  coversFromTo: (from: string, to: string): Phrase => t(`${from} to ${to}`, `من ${from} إلى ${to}`),
  greeting: (name: string): Phrase => t(`Hello, ${name}`, `مرحبًا، ${name}`),
  /**
   * A charge the practice forgave, with the day it did. The Arabic verb and its
   * connective are `waivedNotice`'s in `domain/billing/document/strings.ts`, so
   * the household's screen and the rendered invoice say the same word.
   */
  waivedOn: (day: string): Phrase => t(`Waived ${day}`, `أُعفي بتاريخ ${day}`),
  practiceIs: (name: string): Phrase => t(name, name),
};

/** One word, in one language. */
export function say(phrase: Phrase, locale: Locale): string {
  return phrase[locale];
}

/** A word from a table that may not have the key: the key itself is the fallback. */
export function sayFrom(table: Record<string, Phrase>, key: string, locale: Locale): string {
  const phrase = table[key];
  return phrase ? phrase[locale] : key.replace(/_/g, ' ');
}
