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
  dateOfSupply: { en: 'Date of supply', ar: 'تاريخ التوريد' },
  dateReceived: { en: 'Date received', ar: 'تاريخ الاستلام' },

  client: { en: 'Client', ar: 'العميل' },
  recordNumber: { en: 'Record number', ar: 'رقم السجل' },

  licenceNumber: { en: 'Licence number', ar: 'رقم الرخصة' },
  licensingAuthority: { en: 'Licensing authority', ar: 'جهة الترخيص' },
  taxRegistrationNumber: { en: 'Tax registration number', ar: 'رقم التسجيل الضريبي' },
  vatRegistrationNumber: {
    en: 'VAT registration number',
    ar: 'رقم التسجيل في ضريبة القيمة المضافة',
  },

  description: { en: 'Description', ar: 'الوصف' },
  quantity: { en: 'Quantity', ar: 'الكمية' },
  unitPrice: { en: 'Unit price (AED)', ar: 'سعر الوحدة' },
  vatRate: { en: 'VAT rate', ar: 'نسبة الضريبة' },
  vatAmount: { en: 'VAT (AED)', ar: 'ضريبة القيمة المضافة' },
  /**
   * The same column, named short. "ضريبة القيمة المضافة" is the term, and it is
   * what the totals row says; as a column heading beside "نسبة الضريبة" it is
   * wider than the column and runs into its neighbour. A table heading may be
   * the short form where the row beneath it is unambiguous — the figures are in
   * dirhams under a heading that says so in English on the same line.
   */
  vatColumn: { en: 'VAT (AED)', ar: 'الضريبة' },
  amount: { en: 'Amount (AED)', ar: 'المبلغ' },

  net: { en: 'Net (AED)', ar: 'المبلغ الصافي' },
  total: { en: 'Total (AED)', ar: 'الإجمالي' },
  amountReceived: { en: 'Amount received (AED)', ar: 'المبلغ المستلم' },

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

/** "500" basis points as "5%". Whole percentages only; the UAE rate is one. */
export function formatRate(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
