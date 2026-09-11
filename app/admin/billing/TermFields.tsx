import { termWords } from '@domain/billing';
import { Term } from '../../api/billing/schema';
import { Field, Select } from '../../shell/components/Controls';

/**
 * How long the credits something sells last: a number, and the unit beside it.
 *
 * The one term control, shared by the two catalogue drawers that set one —
 * the bundle catalogue and the price list (docs/SPEC/billing.md section 4.3;
 * the operator's ruling of 12 September 2026,
 * docs/superpowers/plans/2026-09-12-optional-terms.md).
 *
 * **Blank is a real answer, and the control says what it means.** A programme
 * or a price with no term sells credits that never expire; that is the
 * practice's default and it is written under the fields in words, not left to
 * be inferred from an empty box.
 *
 * **There is no default unit.** The select starts on nothing, so a term
 * cannot be saved without somebody choosing days or months — which is what
 * stops a coordinator typing 6 meaning months into a field already set to
 * days and selling a week's credits. Both halves are typed on purpose or
 * neither is, and the wholeness is checked here as well as by migration 412's
 * constraint, because a person should not learn it from a 400.
 *
 * The control holds no arithmetic and invents no wording: the sentence under
 * it is `domain/billing/term.ts`'s, the same function the invoice line uses,
 * and the five-year ceiling is the wire's own `Term` rather than a second
 * copy of the number.
 *
 * English only, like every other staff screen (the operator's decision of
 * 7 September 2026, `tests/lint/console-is-english.test.ts`).
 */

/** What the two boxes hold, as typed. `unit` is empty until one is chosen. */
export type TermDraft = { amount: string; unit: '' | 'day' | 'month' };

/** Both boxes empty: the credits never expire. */
export const NO_TERM: TermDraft = { amount: '', unit: '' };

/** What the fields say when they are empty, and what empty means. */
export const NEVER_EXPIRES = 'Leave blank and these credits never expire.';

/** Why a draft cannot be read whole, and which of the two boxes to move to. */
export type TermRefusal = { message: string; focus: 'amount' | 'unit' };

/** A draft read whole, or the one sentence saying why it cannot be. */
export type TermReading = { ok: true; term: Term | null } | ({ ok: false } & TermRefusal);

/** The term a row carries, put back into the two boxes. */
export function draftFrom(term: Term | null): TermDraft {
  return term === null ? NO_TERM : { amount: String(term.amount), unit: term.unit };
}

/**
 * The two boxes read as one answer: a term, no term, or a refusal.
 *
 * Half a term is the way this goes wrong, so each half missing has its own
 * sentence naming what to do about it. Everything else the wire refuses — a
 * term that is not a whole number of one or more, and a term longer than five
 * years — is refused here first, by asking `Term` itself rather than
 * restating its limits.
 */
export function readTerm(draft: TermDraft): TermReading {
  const typed = draft.amount.trim();
  if (typed === '' && draft.unit === '') {
    return { ok: true, term: null };
  }
  if (typed === '') {
    return { ok: false, message: 'Say how many, or leave both blank.', focus: 'amount' };
  }
  if (draft.unit === '') {
    return { ok: false, message: 'Choose days or months.', focus: 'unit' };
  }
  const amount = Number(typed);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    return {
      ok: false,
      message: 'A term is a whole number of days or months, such as 30.',
      focus: 'amount',
    };
  }
  const parsed = Term.safeParse({ amount, unit: draft.unit });
  if (!parsed.success) {
    // The only limit left on the wire's shape, said in words rather than in a
    // second copy of the figure.
    return {
      ok: false,
      message: 'A term is at most five years, in either unit.',
      focus: 'amount',
    };
  }
  return { ok: true, term: parsed.data };
}

export function TermFields({
  id,
  draft,
  error,
  onChange,
}: {
  id: string;
  draft: TermDraft;
  /** The refusal from `readTerm`, once a save has been attempted. */
  error?: TermRefusal;
  onChange: (next: TermDraft) => void;
}) {
  const reading = readTerm(draft);
  // The wording is the rule's, not this file's: the same function that words
  // the term on an invoice line (domain/billing/term.ts). Null in, null out,
  // and null is the sentence that says what blank means.
  const words = reading.ok ? termWords(reading.term) : null;
  const said = words
    ? `These credits last ${words.en} from the day they are bought.`
    : NEVER_EXPIRES;
  return (
    <div className="term">
      <div className="term-fields">
        <Field
          id={`${id}-amount`}
          label="Runs for"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={draft.amount}
          onChange={(e) => onChange({ ...draft, amount: e.target.value })}
          error={error?.focus === 'amount' ? error.message : undefined}
        />
        <Select
          id={`${id}-unit`}
          label="Counted in"
          value={draft.unit}
          onChange={(e) => onChange({ ...draft, unit: e.target.value as TermDraft['unit'] })}
          error={error?.focus === 'unit' ? error.message : undefined}
        >
          <option value="">Choose days or months</option>
          <option value="day">Days</option>
          <option value="month">Months</option>
        </Select>
      </div>
      <p className="small muted">{said}</p>
    </div>
  );
}
