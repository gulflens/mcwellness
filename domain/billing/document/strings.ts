import { formatFils } from '../../shared/fils';

/**
 * Every word on a rendered money document, in both languages.
 *
 * Arabic is a first-class layout here, not a translation dropped underneath the
 * English: each label is set beside its English on the same line, right-aligned
 * against the right margin, which is how a bilingual invoice is read in the
 * Gulf. British English throughout (CLAUDE.md), and no word on these documents
 * belongs to the trade that built them — a family reads "Invoice", never
 * "document id" or "record".
 *
 * The headings are the part that carries legal weight. "Tax Invoice" is a claim
 * about a VAT registration; a practice that does not hold one issues an
 * "Invoice", and the Arabic follows the same distinction — فاتورة ضريبية against
 * فاتورة.
 */

export type Phrase = { en: string; ar: string };

export const WORDS = {
  taxInvoice: { en: 'Tax Invoice', ar: 'فاتورة ضريبية' },
  invoice: { en: 'Invoice', ar: 'فاتورة' },
  receipt: { en: 'Receipt', ar: 'إيصال استلام' },

  invoiceNumber: { en: 'Invoice number', ar: 'رقم الفاتورة' },
  receiptNumber: { en: 'Receipt number', ar: 'رقم الإيصال' },
  dateOfIssue: { en: 'Date of issue', ar: 'تاريخ الإصدار' },
  /** The short form the design sets beneath the reference: "Issued 8 September 2026". */
  issued: { en: 'Issued', ar: 'صدرت في' },
  dateOfSupply: { en: 'Date of supply', ar: 'تاريخ التوريد' },
  dateReceived: { en: 'Date received', ar: 'تاريخ الاستلام' },

  client: { en: 'Client', ar: 'العميل' },
  recordNumber: { en: 'Record number', ar: 'رقم السجل' },

  licenceNumber: { en: 'Licence number', ar: 'رقم الرخصة' },
  licensingAuthority: { en: 'Licensing authority', ar: 'جهة الترخيص' },
  /**
   * The **corporate-tax** registration, named at length so it cannot be read as
   * the other one. "Tax registration number" / "رقم التسجيل الضريبي" is the exact
   * phrase the Federal Tax Authority uses for a VAT TRN, so printing the
   * corporate-tax number under it says the practice holds a registration it does
   * not — the misstatement `tenant.trn` and `invoice.supplier_trn` carry column
   * comments to prevent, undone by the label.
   */
  corporateTaxNumber: {
    en: 'Corporate tax registration number',
    ar: 'رقم التسجيل في ضريبة الشركات',
  },
  vatRegistrationNumber: {
    en: 'VAT registration number',
    ar: 'رقم التسجيل في ضريبة القيمة المضافة',
  },

  /**
   * Who the document is for, above the household's name. A receipt says the
   * other one: money came from a family rather than a charge going to it.
   */
  billedTo: { en: 'Billed to', ar: 'إلى' },
  receivedFrom: { en: 'Received from', ar: 'من' },

  description: { en: 'Description', ar: 'الوصف' },
  quantity: { en: 'Quantity', ar: 'الكمية' },
  /**
   * **The headings carry no `(AED)` any more**, and every figure beneath them
   * carries its own currency instead (`money` below). That is the operator's
   * design of 8 September 2026 and `docs/SPEC/billing.md` section 5.6 records
   * why it differs from the console's rule: naming the currency once per table
   * is a rule for a screen whose reader is inside the practice, and a document
   * a family may take to a bank, an insurer or an accountant says what its
   * figures are in, in every cell, on its own.
   */
  unitPrice: { en: 'Unit price', ar: 'سعر الوحدة' },
  vatRate: { en: 'VAT rate', ar: 'نسبة الضريبة' },
  vatAmount: { en: 'VAT', ar: 'ضريبة القيمة المضافة' },
  /**
   * The same column, named short. "ضريبة القيمة المضافة" is the term, and it is
   * what the totals row says; as a column heading beside "نسبة الضريبة" it is
   * wider than the column and runs into its neighbour. A table heading may be
   * the short form where the row beneath it is unambiguous — the figures are in
   * dirhams under a heading that says so in English on the same line.
   */
  vatColumn: { en: 'VAT', ar: 'الضريبة' },
  amount: { en: 'Amount', ar: 'المبلغ' },

  beforeDiscount: { en: 'Before discount', ar: 'قبل الخصم' },
  discount: { en: 'Discount', ar: 'الخصم' },
  net: { en: 'Net', ar: 'المبلغ الصافي' },
  total: { en: 'Total', ar: 'الإجمالي' },
  amountReceived: { en: 'Received', ar: 'المبلغ المستلم' },

  paymentMethod: { en: 'Payment method', ar: 'طريقة الدفع' },
  paymentReference: { en: 'Payment reference', ar: 'مرجع الدفع' },
  settlesInvoice: { en: 'Settles invoice', ar: 'سداد الفاتورة' },

  cash: { en: 'Cash', ar: 'نقداً' },
  transfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  link: { en: 'Payment link', ar: 'رابط دفع' },
} as const satisfies Record<string, Phrase>;

/**
 * The footer that says what kind of document this is under UAE VAT.
 *
 * A registered business supplying a private individual — which every household
 * the practice bills is — issues a **simplified** tax invoice, which need not
 * carry the recipient's address. Saying so on the document is the point: it is
 * the basis on which the recipient block is as short as it is, and a reader
 * checking the invoice should not have to infer it (round 20's second note;
 * docs/CHANGE-REQUESTS/billing-04.md asks for the same sentence in
 * docs/SPEC/billing.md, which this worktree does not own).
 */
export const SIMPLIFIED_BASIS: Phrase = {
  en: 'A simplified tax invoice, issued to a person who is not registered for VAT.',
  ar: 'فاتورة ضريبية مبسطة صادرة إلى شخص غير مسجل في ضريبة القيمة المضافة.',
};

/**
 * And the footer for the practice as it stands today. Saying it plainly is
 * better than a document that is simply silent about tax: a family comparing
 * quotes, or an accountant reading it later, should be able to tell "no VAT was
 * charged" from "somebody forgot the VAT line".
 */
export const NOT_REGISTERED_BASIS: Phrase = {
  en: 'The practice is not registered for VAT, so no VAT is charged on this document.',
  ar: 'المنشأة غير مسجلة في ضريبة القيمة المضافة، ولذلك لا تُحتسب أي ضريبة على هذا المستند.',
};

/**
 * What a receipt says at the foot of the page.
 *
 * **A receipt makes no tax statement, in either direction.** It carried
 * `SIMPLIFIED_BASIS` until the compliance review caught it, which meant a
 * registered practice's receipt described itself as a simplified *tax invoice* —
 * a document it is not, under a heading that says so two hundred points above.
 * The opposite footer would be no better: a receipt acknowledges money that
 * arrived, and what tax was charged is a fact about the invoice it settles, not
 * about the act of paying.
 *
 * So the footer says what the document is and what the money was: the method,
 * the day, and the invoice it settles or that it was taken on account. The
 * amounts and the dates are already on the page; saying them again in a sentence
 * is what makes the page readable to somebody who is not reading a table.
 */
export function receiptBasis(input: {
  method: 'cash' | 'transfer' | 'link';
  receivedOn: string;
  /** The same day, with an Arabic month name (`arabicDocumentDate`). */
  receivedOnAr: string;
  settlesReference: string | null;
}): Phrase {
  const against = input.settlesReference;
  return {
    en:
      `Received by ${WORDS[input.method].en.toLowerCase()} on ` +
      `${formatDocumentDate(input.receivedOn)}, ` +
      `${against ? `against invoice ${against}` : 'on account'}. ` +
      'This is a receipt for money received, not a tax invoice.',
    ar:
      `استُلم بواسطة ${WORDS[input.method].ar} بتاريخ ${input.receivedOnAr}، ` +
      `${against ? `سداداً للفاتورة ${against}` : 'على الحساب'}. ` +
      'هذا إيصال باستلام مبلغ وليس فاتورة ضريبية.',
  };
}

/**
 * What the call-out fee reads as on an invoice line, in both languages
 * (the founder's decision of 2026-09-04, migration 408).
 *
 * **Written here and in SQL, and tied together by a test.** The line is
 * inserted by `app.billing_on_appointment_charged`, a trigger with no
 * application above it — the practice's own database is the only writer, so
 * the words have to exist as SQL literals. They exist here too because this is
 * where every word on a money document lives, and
 * `tests/billing/db/call_out_fee.test.ts` asserts the row the trigger wrote is
 * exactly what this returns. Change one without the other and that test says so.
 *
 * **The date is the visit's, in ISO, and not the long form the rest of the page
 * uses.** A trigger has no month names, and inventing a second month table in
 * plpgsql to match `formatDocumentDate` would be a second implementation of a
 * rule that already has one. An ISO date on a line beside a figure is
 * unambiguous in either language, which is the property that matters on a
 * document a family may take to somebody else.
 */
export function callOutFeeDescription(visitDate: string): Phrase {
  return {
    en: `Call-out fee — visit on ${visitDate}`,
    ar: `رسوم الاستدعاء — زيارة بتاريخ ${visitDate}`,
  };
}

/**
 * What a forgiven call-out fee says on its own document (migration 408).
 *
 * The invoice is append-only: a waived fee keeps its number, its line and its
 * figures, and `app.billing_ledger` simply stops counting it. So the page has
 * to say what the ledger knows, or it goes on presenting a live charge for
 * money the family does not owe (compliance review of this pull request).
 *
 * Two short sentences, in both languages: when it was forgiven, and that
 * nothing is owed. The date is written out the way every other date on these
 * documents is, with the Arabic month name on the Arabic side.
 */
export function waivedNotice(waivedOn: string): Phrase {
  return {
    en: `Waived on ${formatDocumentDate(waivedOn)}. Nothing is owed.`,
    ar: `أُعفي هذا المبلغ بتاريخ ${arabicDocumentDate(waivedOn)}. لا يوجد مبلغ مستحق.`,
  };
}

/**
 * What a discounted line says beneath its description, in both languages:
 * the design's own phrasing, `List AED 12,150.00 · less AED 2,325.00`.
 *
 * **Both figures, and no percentage.** The operator's design states the list
 * price and what came off it, which is the pair a family actually wants: the
 * number they were quoted and the number they are paying. A share can always
 * be worked out from the two, while two discounts added together carry no
 * single percentage at all (`domain/billing/discount.ts`, `combineDiscounts`)
 * — so a line that named one would have to invent it.
 *
 * The Federal Tax Authority asks a full tax invoice to state the amount of any
 * discount offered. A simplified one need not, and this document does anyway:
 * a family looking at a figure below the price they were quoted should be able
 * to see, on the page, why.
 *
 * The middle dot is the design's, and it is a document rather than a screen.
 * `CLAUDE.md`'s rule against middle-dot-joined metadata is a rule about the
 * console's own chrome (`.claude/rules/ui.md` scopes it to `app/**`); here it
 * joins two halves of one sentence a person reads once.
 */
export function discountLine(listFils: number, discountFils: number): Phrase {
  return {
    en: `List ${money(listFils)} · less ${money(discountFils)}`,
    ar: `السعر قبل الخصم ${formatFils(listFils)} درهم · ناقص ${formatFils(discountFils)} درهم`,
  };
}

/**
 * A figure as it is written on a money document: `AED 1,650.00`.
 *
 * The currency in the cell, following the operator's design, and the reason is
 * in section 5.6 of the specification: a client-facing document is read
 * outside the practice, and a column heading two hundred points above a figure
 * is not where a bank or an insurer looks for the currency. `formatFils` is
 * still the one piece of arithmetic that turns fils into a figure; this is a
 * prefix on it and nothing more.
 */
export function money(fils: number): string {
  return `AED ${formatFils(fils)}`;
}

/** The wordmark at the top of the page. */
export const WORDMARK = 'McWellness';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * "2026-09-02" as "2 September 2026".
 *
 * Written out rather than left to `Intl`, and not because `Intl` is wrong: a
 * rendered document has to be byte-identical every time it is produced from the
 * same row, and a formatter whose output depends on the ICU build the server
 * happens to carry is not that. The month names are English; the date sits in
 * the value column of a bilingual row, where the label either side of it says
 * what it is.
 */
export function formatDocumentDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const index = Number(month) - 1;
  const name = MONTHS[index];
  if (!year || !day || name === undefined) {
    // Never guess at a date on a financial document: show exactly what the row
    // holds and let a person see that it is wrong.
    return isoDate;
  }
  return `${Number(day)} ${name} ${year}`;
}

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/**
 * The same day, for the Arabic side of the page: "2 سبتمبر 2026".
 *
 * An English month name inside an Arabic sentence is not a bilingual document,
 * it is an English one with Arabic around it — the design review's finding on
 * the receipt's footer.
 *
 * **The digits stay Western**, and that is a choice rather than an oversight.
 * Every figure on these documents — the amounts, the invoice number, the
 * record number — is set in Western digits, on both sides of the page, because
 * they are the same figures read by both readers. Arabic-Indic digits in one
 * sentence and Western ones in the table above it would be the inconsistency,
 * not the fix. This is also how bilingual invoices are set across the Gulf.
 */
export function arabicDocumentDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const name = MONTHS_AR[Number(month) - 1];
  if (!year || !day || name === undefined) {
    return isoDate;
  }
  return `${Number(day)} ${name} ${year}`;
}

/** "500" basis points as "5%". Whole percentages only; the UAE rate is one. */
export function formatRate(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
