import type { ReactNode, TextareaHTMLAttributes } from 'react';

/**
 * Two small controls the shared component library (app/shell/components/Controls.tsx,
 * the shared zone) does not carry yet: a checkbox row and a textarea. Both
 * reuse the shell's own tokens and field classes rather than inventing a
 * parallel vocabulary (docs/DESIGN-BRIEF.md section 8: tokens only), and
 * both stay local to this module until a second stream needs them, at which
 * point they belong in a change request, not a second copy elsewhere.
 */

export function Checkbox({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="checkbox">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Textarea({
  label,
  id,
  hint,
  error,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  id: string;
  hint?: string;
  error?: string;
}) {
  const message = error || hint;
  const messageId = message ? `${id}-message` : undefined;
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <textarea
        id={id}
        className="field__input field__input--textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        {...rest}
      />
      {message ? (
        <div
          id={messageId}
          className={['field__hint', 'small', error ? 'field__hint--error' : 'muted'].join(' ')}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

/** A row of fields or controls, laid out with the ledger's own rhythm. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>;
}
