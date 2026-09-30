import { Field, Select } from '../../shell/components/Controls';
import type { SaleDiscountKind } from './money';

/**
 * The one discount control, shared by the three drawers that offer one: the
 * price list, the bundle catalogue and the sale (docs/SPEC/billing.md section
 * 2.4). A choice of nothing, a share or a sum, and one value beside it.
 *
 * The control holds no arithmetic. The parent computes the preview through
 * `previewDiscount`, which is `domain/billing/discount.ts` — the same function
 * the server writes the row with — so no screen works a discount out for
 * itself.
 *
 * A sale also offers "Free (100%)" (`offerFree`, the owner's request of 30
 * September 2026): no figure is typed, because free is the whole of what the
 * price list leaves, which the parent works out through the domain. `hint`
 * says once how much more a sale may give.
 *
 * English only, like every other staff screen (the operator's decision of
 * 7 September 2026, `tests/lint/console-is-english.test.ts`).
 */
export function DiscountFields<Kind extends SaleDiscountKind>({
  id,
  label,
  kind,
  value,
  error,
  offerFree = false,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  kind: Kind;
  value: string;
  error?: string;
  offerFree?: boolean;
  hint?: string | null;
  onChange: (next: { kind: Kind; value: string }) => void;
}) {
  return (
    <div className="discount-fields">
      <Select
        id={`${id}-kind`}
        label={label}
        value={kind}
        onChange={(e) => onChange({ kind: e.target.value as Kind, value })}
      >
        <option value="none">No discount</option>
        <option value="percent">Percentage</option>
        <option value="amount">Amount (AED)</option>
        {offerFree ? <option value="free">Free (100%)</option> : null}
      </Select>
      {kind === 'none' || kind === 'free' ? null : (
        <Field
          id={`${id}-value`}
          label={kind === 'percent' ? 'Discount (%)' : 'Discount (AED)'}
          type="text"
          inputMode="decimal"
          placeholder={kind === 'percent' ? '15' : '0.00'}
          value={value}
          onChange={(e) => onChange({ kind, value: e.target.value })}
          error={error}
        />
      )}
      {hint && (kind === 'percent' || kind === 'amount') ? (
        <p className="small muted">{hint}</p>
      ) : null}
    </div>
  );
}
