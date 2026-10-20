import { describe, expect, it } from 'vitest';
import {
  containsPattern,
  decodeReceiptCursor,
  encodeReceiptCursor,
  escapeLike,
} from '../../app/api/billing/search';
import { InvoiceSearchInput } from '../../app/api/billing/ledger-schema';
import { PaymentSearchInput } from '../../app/api/billing/document-schema';

/**
 * The pure half of searching the invoice and receipt books: the text a person
 * types becomes a literal substring pattern, and a page of receipts hands back
 * a cursor the next request can trust no further than its shape.
 */

const PAYMENT_ID = '00000000-0000-4000-8000-0000000000a1';
const RECEIVED_AT = '2026-09-02T08:15:30.123456Z';

describe('escapeLike', () => {
  it('treats a percent sign, an underscore and a backslash as the characters they are', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('INV-000012')).toBe('INV-000012');
  });
});

describe('containsPattern', () => {
  it('matches the escaped text anywhere in a value', () => {
    expect(containsPattern('MW-0_1')).toBe('%MW-0\\_1%');
  });
});

describe('the receipt cursor', () => {
  it('reads back exactly what it was made from', () => {
    const cursor = encodeReceiptCursor({ receivedAt: RECEIVED_AT, id: PAYMENT_ID });
    expect(decodeReceiptCursor(cursor)).toEqual({ receivedAt: RECEIVED_AT, id: PAYMENT_ID });
  });

  it('is opaque and safe in a URL, though it never travels in one', () => {
    const cursor = encodeReceiptCursor({ receivedAt: RECEIVED_AT, id: PAYMENT_ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(PAYMENT_ID);
  });

  it('refuses text that is not base64url', () => {
    expect(decodeReceiptCursor('not a cursor!')).toBeNull();
    expect(decodeReceiptCursor('')).toBeNull();
  });

  it('refuses a cursor with a missing or extra part', () => {
    expect(decodeReceiptCursor(base64url(RECEIVED_AT))).toBeNull();
    expect(decodeReceiptCursor(base64url(`${RECEIVED_AT}|${PAYMENT_ID}|x`))).toBeNull();
  });

  it('refuses a cursor whose id is not a uuid', () => {
    expect(decodeReceiptCursor(base64url(`${RECEIVED_AT}|INV-000001`))).toBeNull();
  });

  it('refuses a cursor whose moment is not a full UTC timestamp', () => {
    expect(decodeReceiptCursor(base64url(`2026-09-02|${PAYMENT_ID}`))).toBeNull();
    expect(decodeReceiptCursor(base64url(`2026-13-45T99:00:00.000000Z|${PAYMENT_ID}`))).toBeNull();
    expect(decodeReceiptCursor(base64url(`'; drop table payment; --|${PAYMENT_ID}`))).toBeNull();
  });

  it('refuses a moment before 1970, which the database could not hold and no payment has', () => {
    // The year 0000 is a well-formed timestamp to JavaScript and to the
    // pattern alike, and would otherwise reach the query as a server error.
    expect(decodeReceiptCursor(base64url(`0000-01-01T00:00:00.000000Z|${PAYMENT_ID}`))).toBeNull();
    expect(decodeReceiptCursor(base64url(`1969-12-31T23:59:59.000000Z|${PAYMENT_ID}`))).toBeNull();
    expect(
      decodeReceiptCursor(base64url(`1970-01-01T00:00:00.000000Z|${PAYMENT_ID}`)),
    ).not.toBeNull();
  });
});

describe('InvoiceSearchInput', () => {
  it('accepts an empty body as the first page of everything', () => {
    expect(InvoiceSearchInput.parse({})).toEqual({});
  });

  it('trims the search, and treats an empty one as no search at all', () => {
    expect(InvoiceSearchInput.parse({ search: '  INV-0001  ' }).search).toBe('INV-0001');
    expect(InvoiceSearchInput.parse({ search: '   ' }).search).toBeUndefined();
  });

  it('refuses a search longer than a hundred characters', () => {
    expect(InvoiceSearchInput.safeParse({ search: 'a'.repeat(101) }).success).toBe(false);
    expect(InvoiceSearchInput.safeParse({ search: 'a'.repeat(100) }).success).toBe(true);
  });

  it('takes one to five distinct kinds, and no kind it does not know', () => {
    expect(InvoiceSearchInput.safeParse({ kinds: ['session', 'package'] }).success).toBe(true);
    expect(InvoiceSearchInput.safeParse({ kinds: [] }).success).toBe(false);
    expect(InvoiceSearchInput.safeParse({ kinds: ['session', 'session'] }).success).toBe(false);
    expect(InvoiceSearchInput.safeParse({ kinds: ['refund'] }).success).toBe(false);
  });

  it('takes a positive whole invoice number as the cursor', () => {
    expect(InvoiceSearchInput.parse({ before: 51 }).before).toBe(51);
    expect(InvoiceSearchInput.safeParse({ before: 0 }).success).toBe(false);
    expect(InvoiceSearchInput.safeParse({ before: 1.5 }).success).toBe(false);
    expect(InvoiceSearchInput.safeParse({ before: '51' }).success).toBe(false);
  });

  it('refuses a field it does not know', () => {
    expect(InvoiceSearchInput.safeParse({ clientName: 'anyone' }).success).toBe(false);
  });
});

describe('PaymentSearchInput', () => {
  it('takes one to three distinct methods', () => {
    expect(PaymentSearchInput.safeParse({ methods: ['cash', 'link'] }).success).toBe(true);
    expect(PaymentSearchInput.safeParse({ methods: [] }).success).toBe(false);
    expect(PaymentSearchInput.safeParse({ methods: ['cash', 'cash'] }).success).toBe(false);
    expect(PaymentSearchInput.safeParse({ methods: ['card'] }).success).toBe(false);
  });

  it('takes a cursor it made, and refuses one it did not', () => {
    const before = encodeReceiptCursor({ receivedAt: RECEIVED_AT, id: PAYMENT_ID });
    expect(PaymentSearchInput.parse({ before }).before).toBe(before);
    expect(PaymentSearchInput.safeParse({ before: 'nonsense' }).success).toBe(false);
  });

  it('trims the search like the invoice book does, and refuses an unknown field', () => {
    expect(PaymentSearchInput.parse({ search: ' RCP-000004 ' }).search).toBe('RCP-000004');
    expect(PaymentSearchInput.parse({ search: '' }).search).toBeUndefined();
    expect(PaymentSearchInput.safeParse({ since: '2026-09-01' }).success).toBe(false);
  });
});

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}
