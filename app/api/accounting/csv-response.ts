import type { Context } from 'hono';

/**
 * A statement as a file. The same rows the screen shows, produced by the same
 * function (docs/SPEC/accounting.md section 4.5): a file that could disagree
 * with the screen would be worse than no file at all.
 */
export function csvResponse(c: Context, name: string, csv: string): Response {
  return c.body(csv, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${name}"`,
  });
}
