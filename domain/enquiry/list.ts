import { ENQUIRY_SOURCES, type EnquirySource } from './parse';

/**
 * How the office reads its enquiries (the operator's ask of 19 September
 * 2026): what is still waiting in one table, what was dismissed in another
 * and what became a lead in a third, because at an expo's volume one table of
 * all three is a table nobody can work from. Pure.
 *
 * One table in the database, as before. A dismissed row is the same audited
 * row with its status changed and its person scrubbed from it; moving it to a
 * table of its own would buy the screen nothing and cost the record its one
 * history. The screen asks for one status at a time instead, which the index
 * `enquiry_tenant_status_received_idx` (migration 916) was already cut for.
 */
export const ENQUIRY_STATUSES = ['new', 'converted', 'dismissed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** A page a person can read. The rest is a press away, and counted above the table. */
export const ENQUIRY_PAGE = 100;

/** Where a page stopped: the row's own moment and its id, so a tie still has an order. */
export type EnquiryCursor = { receivedAt: string; id: string };

export type EnquiryListQuery = {
  status: EnquiryStatus;
  /** Null is every source. */
  source: EnquirySource | null;
  /** Null is the top of the list. */
  before: EnquiryCursor | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function enquiryCursor(row: EnquiryCursor): string {
  return `${row.receivedAt}_${row.id}`;
}

function readCursor(text: string): EnquiryCursor | null {
  const parts = text.split('_');
  const [receivedAt, id] = parts;
  if (parts.length !== 2 || receivedAt === undefined || id === undefined) return null;
  if (!ISO.test(receivedAt) || Number.isNaN(Date.parse(receivedAt)) || !UUID.test(id)) return null;
  return { receivedAt, id };
}

/**
 * What the address asked for, or null when it asked for something this list
 * does not have. Nothing at all is the waiting enquiries from the top: what a
 * screen built before the tabs asks for, and the list it was for.
 */
export function readEnquiryListQuery(raw: {
  status?: string | undefined;
  source?: string | undefined;
  before?: string | undefined;
}): EnquiryListQuery | null {
  const status = raw.status === undefined ? 'new' : raw.status;
  if (!(ENQUIRY_STATUSES as readonly string[]).includes(status)) return null;

  let source: EnquirySource | null = null;
  if (raw.source !== undefined && raw.source !== 'all') {
    if (!(ENQUIRY_SOURCES as readonly string[]).includes(raw.source)) return null;
    source = raw.source as EnquirySource;
  }

  let before: EnquiryCursor | null = null;
  if (raw.before !== undefined) {
    before = readCursor(raw.before);
    if (before === null) return null;
  }
  return { status: status as EnquiryStatus, source, before };
}

export type EnquiryTally = Record<EnquiryStatus, Record<'all' | EnquirySource, number>>;

/** Every status by every source, with a nought where the database had no row to count. */
export function tallyEnquiries(
  counted: readonly { status: EnquiryStatus; source: EnquirySource; count: number }[],
): EnquiryTally {
  const none = (): Record<'all' | EnquirySource, number> => ({
    all: 0,
    website: 0,
    discovery_call: 0,
    expo: 0,
  });
  const tally: EnquiryTally = { new: none(), converted: none(), dismissed: none() };
  for (const { status, source, count } of counted) {
    tally[status][source] += count;
    tally[status].all += count;
  }
  return tally;
}
