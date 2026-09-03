import type {
  InvoiceDocument,
  ReceiptDocument,
  SupplierSnapshot,
} from '../../../domain/billing/document';
import type { Db } from '../_middleware/request-context';

/**
 * Reading a money document out of the rows it was written from.
 *
 * **Every supplier fact comes off the invoice's own `supplier_*` columns**, and
 * the queries below name no `tenant` at all. That is the point of the snapshot
 * (402 and 905, and docs/CHANGE-REQUESTS/trunk-notes.md round 20 request 1c):
 * reading the practice at render time would make an invoice issued last year
 * re-render with this year's registration, this year's legal name and this
 * year's address. A document must keep saying what it said.
 *
 * A **receipt** has no supplier columns of its own — a payment is not an
 * invoice and does not carry a snapshot — so it takes the practice from **the
 * invoice it settles**. That is not interchangeable with "the household's most
 * recent invoice", which is what this read until the compliance review caught
 * it: a receipt for money taken before the practice registered for VAT would
 * re-render under a later invoice's snapshot and print a VAT registration
 * number the practice did not hold on the day. The settled invoice is the one
 * document that says who the practice was at that moment.
 *
 * A payment made against no invoice at all — a family paying something off
 * account — has nothing of its own to read, so it falls back to the latest
 * invoice issued **at or before the day the money arrived**, which is the
 * nearest thing to a snapshot of that moment. When there is none, the receipt
 * is refused rather than rendered under a guess.
 */

const INVOICE_SQL =
  'select i.id, i.reference, i.issued_on, i.supplied_on, i.net_fils, i.vat_fils, i.gross_fils, ' +
  'i.client_id, i.supplier_legal_name, i.supplier_legal_name_ar, i.supplier_address, ' +
  'i.supplier_licence_number, i.supplier_licensing_authority, i.supplier_trn, ' +
  'i.supplier_vat_registered, i.supplier_vat_trn, ' +
  "c.mrn as client_mrn, c.given_name || ' ' || c.family_name as client_name " +
  'from invoice i join client c on c.id = i.client_id ' +
  'where i.tenant_id = app.current_tenant_id() and i.id = $1';

const LINES_SQL =
  'select description, description_ar, quantity, unit_net_fils, net_fils, ' +
  'vat_rate_basis_points, vat_fils, gross_fils from invoice_line ' +
  'where tenant_id = app.current_tenant_id() and invoice_id = $1 order by line_no';

const PAYMENT_SQL =
  'select p.id, p.client_id, p.receipt_reference, p.method, p.amount_fils, p.reference, ' +
  "to_char(p.received_at at time zone 'Asia/Dubai', 'YYYY-MM-DD') as received_on, " +
  'p.invoice_id, i.reference as invoice_reference, i.issued_on as invoice_issued_on, ' +
  "c.mrn as client_mrn, c.given_name || ' ' || c.family_name as client_name " +
  'from payment p join client c on c.id = p.client_id ' +
  'left join invoice i on i.id = p.invoice_id ' +
  'where p.tenant_id = app.current_tenant_id() and p.id = $1';

const SUPPLIER_COLUMNS =
  'supplier_legal_name, supplier_legal_name_ar, supplier_address, ' +
  'supplier_licence_number, supplier_licensing_authority, supplier_trn, ' +
  'supplier_vat_registered, supplier_vat_trn';

/** The snapshot on the invoice this payment settles. The first thing asked for. */
const SETTLED_SUPPLIER_SQL =
  `select ${SUPPLIER_COLUMNS} from invoice ` +
  'where tenant_id = app.current_tenant_id() and id = $1';

/**
 * For a payment that settles nothing: the latest invoice issued at or before
 * the day the money arrived. Never simply the latest — an invoice issued after
 * the payment can say the practice was registered when it was not.
 */
const NEAREST_SUPPLIER_SQL =
  `select ${SUPPLIER_COLUMNS} from invoice ` +
  'where tenant_id = app.current_tenant_id() and client_id = $1 and issued_on <= $2::date ' +
  'order by issued_on desc, number desc limit 1';

type SupplierColumns = {
  supplier_legal_name: string;
  supplier_legal_name_ar: string | null;
  supplier_address: string | null;
  supplier_licence_number: string | null;
  supplier_licensing_authority: string | null;
  supplier_trn: string | null;
  supplier_vat_registered: boolean | null;
  supplier_vat_trn: string | null;
};

function supplierOf(row: SupplierColumns): SupplierSnapshot {
  return {
    legalName: row.supplier_legal_name,
    legalNameAr: row.supplier_legal_name_ar,
    address: row.supplier_address,
    licenceNumber: row.supplier_licence_number,
    licensingAuthority: row.supplier_licensing_authority,
    // Named for what it is. `supplier_trn` is the corporate-tax registration
    // and the renderer never prints it as a VAT number.
    corporateTaxNumber: row.supplier_trn,
    vatRegistered: row.supplier_vat_registered,
    vatNumber: row.supplier_vat_trn,
  };
}

type InvoiceRow = SupplierColumns & {
  id: string;
  reference: string;
  issued_on: string;
  supplied_on: string | null;
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  client_id: string;
  client_mrn: string;
  client_name: string;
};

type LineRow = {
  description: string;
  description_ar: string | null;
  quantity: number;
  unit_net_fils: number;
  net_fils: number;
  vat_rate_basis_points: number;
  vat_fils: number;
  gross_fils: number;
};

/** The invoice as a document, or null when this practice has no such invoice. */
export async function invoiceDocument(
  db: Db,
  invoiceId: string,
): Promise<{ document: InvoiceDocument; clientId: string } | null> {
  const found = await db.query<InvoiceRow>(INVOICE_SQL, [invoiceId]);
  const row = found.rows[0];
  if (!row) return null;
  const lines = await db.query<LineRow>(LINES_SQL, [invoiceId]);

  return {
    clientId: row.client_id,
    document: {
      kind: 'invoice',
      supplier: supplierOf(row),
      recipient: { name: row.client_name, recordNumber: row.client_mrn },
      reference: row.reference,
      issuedOn: row.issued_on,
      suppliedOn: row.supplied_on,
      lines: lines.rows.map((line) => ({
        description: line.description,
        descriptionAr: line.description_ar,
        quantity: line.quantity,
        unitNetFils: line.unit_net_fils,
        netFils: line.net_fils,
        vatRateBasisPoints: line.vat_rate_basis_points,
        vatFils: line.vat_fils,
        grossFils: line.gross_fils,
      })),
      netFils: row.net_fils,
      vatFils: row.vat_fils,
      grossFils: row.gross_fils,
    },
  };
}

type PaymentRow = {
  id: string;
  client_id: string;
  receipt_reference: string | null;
  method: 'cash' | 'transfer' | 'link';
  amount_fils: number;
  reference: string | null;
  received_on: string;
  invoice_id: string | null;
  invoice_reference: string | null;
  invoice_issued_on: string | null;
  client_mrn: string;
  client_name: string;
};

/**
 * The payment as a receipt, or null when this practice has no such payment —
 * and also null when it has one that predates the receipt book (405), which has
 * no number to put on a document.
 */
export async function receiptDocument(
  db: Db,
  paymentId: string,
): Promise<{ document: ReceiptDocument; clientId: string } | null> {
  const found = await db.query<PaymentRow>(PAYMENT_SQL, [paymentId]);
  const row = found.rows[0];
  if (!row || row.receipt_reference === null) return null;

  // The invoice it settles, or — settling none — the nearest one issued on or
  // before the day the money arrived.
  const supplierRow = row.invoice_id
    ? await db.query<SupplierColumns>(SETTLED_SUPPLIER_SQL, [row.invoice_id])
    : await db.query<SupplierColumns>(NEAREST_SUPPLIER_SQL, [row.client_id, row.received_on]);
  const supplier = supplierRow.rows[0];
  // Nothing to say who issued it. Better no receipt than one that names the
  // practice from a row that was never snapshotted.
  if (!supplier) return null;

  return {
    clientId: row.client_id,
    document: {
      kind: 'receipt',
      supplier: supplierOf(supplier),
      recipient: { name: row.client_name, recordNumber: row.client_mrn },
      reference: row.receipt_reference,
      receivedOn: row.received_on,
      method: row.method,
      amountFils: row.amount_fils,
      paymentReference: row.reference,
      settles:
        row.invoice_reference && row.invoice_issued_on
          ? { reference: row.invoice_reference, issuedOn: row.invoice_issued_on }
          : null,
    },
  };
}
