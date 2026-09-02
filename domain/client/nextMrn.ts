import { formatMrn } from './formatMrn';
import { parseMrn } from './parseMrn';

/** 'MW-000001' when there is no prior MRN, otherwise the next number after the last one. */
export function nextMrn(last: string | null): string {
  if (last === null) {
    return formatMrn(1);
  }
  const n = parseMrn(last);
  if (n === null) {
    throw new Error('Not an MRN.');
  }
  return formatMrn(n + 1);
}
