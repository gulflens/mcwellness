import { Field, Select } from '../../shell/components/Controls';
import type { DiscountKind } from './money';

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
 * English only, like every other staff screen (the operator's decision of
 * 7 September 2026, `tests/lint/console-is-english.test.ts`).
 */
export function DiscountFields({
  id,
  label,
  kind,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  kind: DiscountKind;
  value: string;
  error?: string;
  onChange: (next: { kind: DiscountKind; value: string }) => void;
}) {
  return (
    <div className="discount-fields">
      <Select
        id={`${id}-kind`}
        label={label}
        value={kind}
        onChange={(e) => onChange({ kind: e.target.value as DiscountKind, value })}
      >
        <option value="none">No discount</option>
        <option value="percent">Percentage</option>
        <option value="amount">Amount (AED)</option>
      </Select>
      {kind === 'none' ? null : (
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
    </div>
  );
}
