import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/** Buttons and fields in the ledger's vocabulary: ink on paper, no hue, 44px tall. */

export function Button({
  variant = 'secondary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return (
    <button
      type="button"
      {...rest}
      className={['button', `button--${variant}`, className].filter(Boolean).join(' ')}
    />
  );
}

export function Field({
  label,
  id,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input id={id} className="field__input" {...rest} />
      {hint ? <div className="field__hint small muted">{hint}</div> : null}
    </div>
  );
}

export function Select({
  label,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <select id={id} className="field__input" {...rest}>
        {children}
      </select>
    </div>
  );
}

/** A quiet line of text that answers a state: loading, empty, an error. Never a banner. */
export function Note({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'critical';
  children: ReactNode;
}) {
  return (
    <p className={`note note--${tone}`} role={tone === 'critical' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export function PageHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header className="page__header">
      <h1>{title}</h1>
      {aside ? <div className="page__aside small muted">{aside}</div> : null}
    </header>
  );
}
