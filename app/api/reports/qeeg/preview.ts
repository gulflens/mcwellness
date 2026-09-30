import type { Context } from 'hono';
import { z } from 'zod';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import { WORDING_STATUS } from '../../../../domain/reports/qeeg/wording';
import { logRead } from '../../_middleware/audit';
import type { ApiEnv } from '../../_middleware/request-context';
import { ReportLocaleInput } from '../schema';
import type { ReportRecord } from '../source';
import {
  draftFacts,
  gatheredOnce,
  notesHeader,
  pagesOf,
  picturesOf,
  QEEG_LAYOUT_HEADER,
  renderSigned,
  type Filed,
  type PictureRefusal,
} from './pages';

/**
 * `GET /api/reports/:id/preview?locale=` for a brain-map (qEEG) report
 * (docs/SPEC/reports-qeeg.md sections 12 and 14). `preview.ts` hands a row of
 * this kind here after it has found the row and asked who may draft.
 *
 * **A draft is drawn as it would be signed now.** Its saved content, with the
 * client's head read from the record once more as the signature will read it;
 * the practice as it stands; its pictures through its own links; and no
 * signer, so the signature block is the room, the rule and the label (section
 * 12, point 9). While the words are a draft in the language asked, the page
 * carries the draft-wording line (section 14).
 *
 * **A signed report is drawn from its row**, as the repair path draws it: the
 * page the household holds. It is drawn only in its own language, because the
 * other language is its own report (section 8).
 *
 * **Either language for a draft.** `?locale=` defaults to the draft's own. An
 * Arabic preview of an English draft needs nothing of the second-language
 * work: the pages print what she typed where she gave no Arabic, as they do
 * on any Arabic report.
 *
 * **No file while anything runs over** (section 12, known limit 1). The
 * refusal names every part that ran over, and carries what the editor is
 * told of the pages in its body; a PDF carries the same in the
 * `x-report-layout` header. A picture whose bytes are gone, or are not what
 * was filed, is refused by the field that places it.
 *
 * **Audited as the read it is**, of the report and, for a draft, of the
 * client whose record was read to head it.
 */

const PreviewQuery = z.object({ locale: ReportLocaleInput.optional() }).strict();

export async function previewQeeg(
  c: Context<ApiEnv>,
  record: ReportRecord,
  now: Date,
): Promise<Response> {
  const requestId = c.get('requestId');
  const query = PreviewQuery.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
  }
  const locale = query.data.locale ?? record.locale;
  const storage = c.get('storage');
  if (!storage) {
    return c.json({ error: 'storage_unavailable', requestId }, 503);
  }
  const db = c.get('db');

  const refusePicture = (refusal: PictureRefusal) =>
    c.json({ error: 'unprocessable', ...refusal, requestId }, 422);

  let filed: Filed;
  switch (record.status) {
    case 'issued':
    case 'superseded': {
      if (locale !== record.locale) {
        return c.json({ error: 'unprocessable', code: 'locale_fixed', requestId }, 422);
      }
      filed = await renderSigned(db, storage, record);
      break;
    }
    case 'draft': {
      if (record.imported_from !== null) {
        // Read from the old tool's file: its pages were printed by that tool,
        // and it is reviewed through the import's own screen.
        return c.json({ error: 'unprocessable', code: 'imported_draft', requestId }, 422);
      }
      const checked = validateQeegContent(record.content);
      if (!checked.ok) {
        return c.json(
          {
            error: 'unprocessable',
            code: 'invalid_content',
            field: checked.refusals[0]?.path ?? '',
            requestId,
          },
          422,
        );
      }
      const gathered = await gatheredOnce(db, record.client_id, checked.content, now);
      if (!gathered.ok) {
        return gathered.code === 'client_erased'
          ? c.json({ error: 'unprocessable', code: 'client_erased', requestId }, 422)
          : c.json({ error: 'not_found', requestId }, 404);
      }
      await logRead(db, 'client', record.client_id, record.client_id);
      const pictures = await picturesOf(db, storage, record.id, gathered.content);
      if (!pictures.ok) return refusePicture(pictures.refusal);
      const facts = await draftFacts(db, storage, {
        clientName: gathered.clientName,
        pictures: pictures.pictures,
        draftWording: WORDING_STATUS[locale] === 'draft',
      });
      if (facts === null) return c.json({ error: 'not_found', requestId }, 404);
      filed = pagesOf({ content: gathered.content, locale, facts });
      break;
    }
    case 'imported':
      // A past record has no pages of this app's: the old tool printed it.
      return c.json({ error: 'unprocessable', code: 'imported_record', requestId }, 422);
    default: {
      const unknown: never = record.status;
      return unknown;
    }
  }

  await logRead(db, 'report', record.id, record.client_id);

  if (!filed.ok) {
    switch (filed.code) {
      case 'overrun':
        return c.json(
          {
            error: 'unprocessable',
            code: 'overrun',
            parts: filed.notes.overflowing,
            layout: filed.notes,
            requestId,
          },
          422,
        );
      case 'unlinked_figure':
      case 'map_missing':
      case 'map_differs':
        return refusePicture(filed.refusal);
      case 'invalid_content':
      case 'not_signed':
        return c.json({ error: 'unprocessable', code: filed.code, requestId }, 422);
      default: {
        const unknown: never = filed;
        return unknown;
      }
    }
  }

  return c.body(filed.bytes as unknown as ArrayBuffer, 200, {
    'content-type': 'application/pdf',
    // Never stored, never shared: a preview is a page somebody is looking at
    // once, and it carries a household's own figures.
    'cache-control': 'no-store',
    'content-disposition': 'inline; filename="preview.pdf"',
    [QEEG_LAYOUT_HEADER]: notesHeader(filed.notes),
  });
}
