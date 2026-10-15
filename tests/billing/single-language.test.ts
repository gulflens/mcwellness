import { describe, expect, it } from 'vitest';
import { documentFonts } from '../../app/api/billing/fonts';
import {
  layout,
  layoutWithBlocks,
  renderDocument,
  WORDS,
  type InvoiceDocument,
  type MoneyDocument,
  type ReceiptDocument,
  type SupplierSnapshot,
} from '../../domain/billing/document';
import { extractText, PAGE_WIDTH, type Op } from '../../domain/shared/document';

/**
 * An invoice and a receipt in the client's language: English or Arabic,
 * never both (the operator's decision of 15 October 2026;
 * docs/CHANGE-REQUESTS/docfix-03.md).
 *
 * The language is the document's own (`locale`), fixed when it was issued
 * (migration 413). A document issued before then has no language of its own
 * and is drawn in both, exactly as it was filed — the four goldens in
 * `document.test.ts` hold that.
 *
 * Read off the laid-out page, op by op: an English page carries no Arabic
 * letter, and an Arabic page no English word but what a person typed (a name,
 * a reference, a code) and the Latin a figure is written in ("AED", "IBAN").
 */

const fonts = documentFonts();
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /[A-Za-z]/;

const SUPPLIER: SupplierSnapshot = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: 'استوديو العافية التجريبي',
  address: 'Unit 1, Synthetic Tower, Dubai',
  licenceNumber: 'SYN-000000',
  licensingAuthority: 'Synthetic Department of Economy and Tourism',
  corporateTaxNumber: '000000000000000',
  vatRegistered: false,
  vatNumber: null,
  contactPhone: '+971 50 000 0011',
  contactEmail: 'studio@example.com',
  website: 'https://example.com',
};

/** What a person typed in Latin letters, or a code a figure is written in. */
const TYPED_LATIN = [
  'McWellness',
  'Hazel Dune',
  'INV-000099',
  'RCP-000004',
  'MW-000099',
  'SYN-000000',
  'SYN 0001',
  'Unit 1',
  'Synthetic Tower',
  'Dubai',
  'Synthetic Department of Economy and Tourism',
  'studio@example.com',
  'https://example.com',
  'Example Practice L.L.C-FZ',
  'TESTAEXX',
  '1 Example Street, Abu Dhabi',
  'AED',
  'IBAN',
  'SWIFT',
  'BIC',
  'AE36 0000 0000 0000 0000 001',
];

function invoice(locale: 'en' | 'ar'): InvoiceDocument {
  const list = 795_000;
  const discount = 198_750;
  return {
    kind: 'invoice',
    locale,
    supplier: SUPPLIER,
    recipient: { name: 'Hazel Dune', recordNumber: 'MW-000099' },
    reference: 'INV-000099',
    issuedOn: '2026-09-24',
    suppliedOn: null,
    waivedOn: null,
    lines: [
      {
        description: 'Neurofeedback programme',
        descriptionAr: 'برنامج نيوروفيدباك',
        quantity: 1,
        unitNetFils: list,
        discountFils: discount,
        discountBasisPoints: 2_500,
        netFils: list - discount,
        vatRateBasisPoints: 0,
        vatFils: 0,
        grossFils: list - discount,
      },
    ],
    netFils: list - discount,
    vatFils: 0,
    grossFils: list - discount,
    discountFils: discount,
    discountBasisPoints: 2_500,
    bank: {
      accountHolder: 'Example Practice L.L.C-FZ',
      iban: 'AE360000000000000000001',
      bic: 'TESTAEXX',
      bankAddress: '1 Example Street, Abu Dhabi',
    },
  };
}

function receipt(locale: 'en' | 'ar'): ReceiptDocument {
  return {
    kind: 'receipt',
    locale,
    supplier: SUPPLIER,
    recipient: { name: 'Hazel Dune', recordNumber: 'MW-000099' },
    reference: 'RCP-000004',
    receivedOn: '2026-09-02',
    method: 'transfer',
    amountFils: 70_000,
    paymentReference: 'SYN 0001',
    settles: { reference: 'INV-000099', issuedOn: '2026-09-02' },
  };
}

const textsOf = (document_: MoneyDocument): Extract<Op, { kind: 'text' }>[] =>
  layout(document_, fonts).flatMap((page) =>
    page.ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text'),
  );

const withoutTyped = (text: string): string =>
  TYPED_LATIN.reduce((left, typed) => left.split(typed).join(''), text);

describe.each([
  ['invoice', invoice],
  ['receipt', receipt],
] as const)('%s in one language', (_kind, make) => {
  it('in English carries no Arabic letter anywhere on the page', () => {
    expect(
      textsOf(make('en'))
        .filter((op) => ARABIC.test(op.text))
        .map((op) => op.text),
    ).toEqual([]);
  });

  it('in Arabic carries no English word but what a person typed', () => {
    expect(
      textsOf(make('ar'))
        .filter((op) => LATIN.test(withoutTyped(op.text)))
        .map((op) => op.text),
    ).toEqual([]);
  });

  it('in Arabic names the practice by its Arabic legal name', () => {
    const texts = textsOf(make('ar')).map((op) => op.text);
    expect(texts).toContain(SUPPLIER.legalNameAr);
    expect(texts.some((text) => text.includes('Synthetic Wellness Studio'))).toBe(false);
  });

  it('in Arabic is the English page mirrored: the title against the left margin', () => {
    // The English title ends at the right margin; turned over, the Arabic one
    // starts at the left.
    const title = textsOf(make('ar')).find((op) => op.style.size === 24);
    expect(title).toMatchObject({ x: PAGE_WIDTH - (PAGE_WIDTH - 48), align: 'start', rtl: true });
  });

  it('in Arabic stands the party card against the right margin', () => {
    const { blocks } = layoutWithBlocks(make('ar'), fonts);
    const party = blocks[0]?.find(
      (block) => block.name === 'billedTo' || block.name === 'receivedFrom',
    );
    expect(party?.right).toBeCloseTo(PAGE_WIDTH - 48, 5);
  });

  it('in Arabic reads back its Arabic, and not the English, off the file', () => {
    const drawn = extractText(renderDocument(make('ar'), fonts)).join('');
    expect(drawn).not.toContain('Licence number');
    expect(drawn).not.toContain('Client record');
  });
});

describe('the Arabic invoice', () => {
  it('names its lines by their Arabic name', () => {
    const texts = textsOf(invoice('ar')).map((op) => op.text);
    expect(texts).toContain('برنامج نيوروفيدباك');
    expect(texts).not.toContain('Neurofeedback programme');
  });

  it('says TOTAL DUE in Arabic only', () => {
    const texts = textsOf(invoice('ar')).map((op) => op.text);
    expect(texts).toContain(WORDS.totalDue.ar);
    expect(texts).not.toContain(WORDS.totalDue.en);
  });

  it('writes its date with an Arabic month name', () => {
    const texts = textsOf(invoice('ar')).map((op) => op.text);
    expect(texts).toContain('24 سبتمبر 2026');
  });
});

describe('a document issued before the decision', () => {
  it('has no language of its own and is drawn in both, as it was filed', () => {
    const legacy = { ...invoice('en'), locale: null };
    const texts = textsOf(legacy).map((op) => op.text);
    expect(texts).toContain(WORDS.totalDue.en);
    expect(texts).toContain(WORDS.totalDue.ar);
  });
});

/**
 * The practice's own words in Arabic (migration 980), and dates in a line the
 * way the page writes dates (the coordinator's review of 15 October 2026).
 */
describe('the Arabic page names the practice in Arabic', () => {
  const ARABIC_SUPPLIER: SupplierSnapshot = {
    ...SUPPLIER,
    addressAr: 'الوحدة 1، البرج التجريبي، دبي',
    licensingAuthorityAr: 'دائرة الاقتصاد والسياحة التجريبية',
  };

  it.each([
    ['invoice', invoice],
    ['receipt', receipt],
  ] as const)(
    'prints the Arabic address and authority on an Arabic %s, and no English for them',
    (_kind, make) => {
      const texts = textsOf({ ...make('ar'), supplier: ARABIC_SUPPLIER }).map((op) => op.text);
      const all = texts.join(' ');
      expect(all).toContain('دائرة الاقتصاد والسياحة التجريبية');
      expect(all).toContain('البرج التجريبي');
      expect(all).not.toContain('Synthetic Tower');
      expect(all).not.toContain('Synthetic Department of Economy and Tourism');
    },
  );

  it('prints the English address on an Arabic invoice while the practice has no Arabic one', () => {
    const all = textsOf(invoice('ar'))
      .map((op) => op.text)
      .join(' ');
    expect(all).toContain('Synthetic Tower');
  });

  it('never prints the Arabic on an English invoice', () => {
    const all = textsOf({ ...invoice('en'), supplier: ARABIC_SUPPLIER })
      .map((op) => op.text)
      .join(' ');
    expect(all).toContain('Synthetic Tower');
    expect(all).not.toContain('البرج التجريبي');
  });
});

describe('a date inside a line', () => {
  const withCallOut = (locale: 'en' | 'ar'): InvoiceDocument => {
    const base = invoice(locale);
    const line = base.lines[0]!;
    return {
      ...base,
      lines: [
        {
          ...line,
          description: 'Call-out fee — visit on 2026-10-14',
          descriptionAr: 'رسوم الاستدعاء — زيارة بتاريخ 2026-10-14',
        },
      ],
    };
  };

  it('is written as the page writes dates, never as ISO, in English', () => {
    const texts = textsOf(withCallOut('en')).map((op) => op.text);
    expect(texts).toContain('Call-out fee — visit on 14 October 2026');
    expect(texts.join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('is written as the page writes dates, never as ISO, in Arabic', () => {
    const texts = textsOf(withCallOut('ar')).map((op) => op.text);
    expect(texts).toContain('رسوم الاستدعاء — زيارة بتاريخ 14 أكتوبر 2026');
    expect(texts.join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('is left alone inside a code somebody typed', () => {
    const base = withCallOut('en');
    const coded = {
      ...base,
      lines: [{ ...base.lines[0]!, description: 'Programme PKG-2026-10-14' }],
    };
    expect(textsOf(coded).map((op) => op.text)).toContain('Programme PKG-2026-10-14');
  });

  it('is left as it was filed on a document in both languages', () => {
    const texts = textsOf({ ...withCallOut('en'), locale: null }).map((op) => op.text);
    expect(texts).toContain('Call-out fee — visit on 2026-10-14');
  });
});
