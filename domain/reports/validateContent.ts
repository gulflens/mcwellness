import { ProgressReportShape } from './shapes/progress';
import { SessionReportShape } from './shapes/session';
import type { ReportContent, ReportKind } from './types';

/**
 * Rule 2 (docs/SPEC/reports-v1.md section 8): the declared shape per kind,
 * refused with the field named.
 *
 * **Named, not merely refused.** A draft that will not save is a practitioner
 * staring at a form, so the answer says which field is wrong — `ratings.0.after`,
 * `coverageTo` — rather than "invalid". The message beside it is the shape's
 * own, in plain words where the shape gives one.
 *
 * Pure: a kind and a value in, an answer out. No clock, no I/O.
 */

export type ContentRefusal = {
  ok: false;
  /** The path to the field, dotted: `goals.2.movement`. Empty for the whole body. */
  field: string;
  message: string;
};

export type ContentAccepted = { ok: true; content: ReportContent };

export type ContentAnswer = ContentAccepted | ContentRefusal;

/**
 * A kind the body claims that is not the kind the report is. Worth its own
 * refusal: it is the one mistake a caller can make that would otherwise be
 * reported as twelve missing fields.
 */
function wrongKind(kind: ReportKind, claimed: unknown): ContentRefusal {
  return {
    ok: false,
    field: 'kind',
    message: `This is a ${kind} report; the body says ${String(claimed)}.`,
  };
}

export function validateContent(kind: ReportKind, content: unknown): ContentAnswer {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, field: '', message: 'A report body is a set of fields.' };
  }
  const claimed = (content as { kind?: unknown }).kind;
  if (claimed !== kind) {
    return wrongKind(kind, claimed);
  }

  const parsed =
    kind === 'session'
      ? SessionReportShape.safeParse(content)
      : ProgressReportShape.safeParse(content);
  if (parsed.success) {
    return { ok: true, content: parsed.data as ReportContent };
  }
  const first = parsed.error.issues[0];
  if (first?.code === 'unrecognized_keys') {
    // A field the shape does not know has no path of its own — it is a key on
    // the object being read — so it is named from the issue's own list.
    // Naming it matters more here than anywhere else: `content` is what a
    // report is re-rendered from years later, and a field the renderer never
    // reads would be a promise the document does not keep.
    const unknown = first.keys[0] ?? '';
    return {
      ok: false,
      field: [...first.path, unknown].filter((part) => String(part).length > 0).join('.'),
      message: 'A report body carries only the fields its kind declares.',
    };
  }
  return {
    ok: false,
    field: (first?.path ?? []).join('.'),
    message: first?.message ?? 'That is not a report body.',
  };
}
