import type { ComponentPropsWithRef, ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronIcon } from './Icons';

/** Buttons and fields in the ledger's vocabulary: ink on paper, no hue, 44px tall. */

export function Button({
  variant = 'secondary',
  className,
  ...rest
}: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
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
  error,
  className,
  ...rest
}: ComponentPropsWithRef<'input'> & {
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
      <input
        id={id}
        className="field__input"
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

export function Select({
  label,
  id,
  hint,
  error,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const message = error || hint;
  const messageId = message ? `${id}-message` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <span className="select">
        <select
          id={id}
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          {...rest}
        >
          {children}
        </select>
        <ChevronIcon className="select__chevron" />
      </span>
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

/**
 * A quiet line of text that answers a state: loading, empty, an error. Never
 * a banner. Three tones: `muted` for a state that asks nothing of the reader,
 * `attention` for one that wants noticing but is not wrong yet (a package
 * expiring in thirty days), `critical` for one that is wrong now. Attention is
 * announced politely, critical assertively.
 */
export function Note({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'attention' | 'critical';
  children: ReactNode;
}) {
  const role = tone === 'critical' ? 'alert' : tone === 'attention' ? 'status' : undefined;
  return (
    <p className={`note note--${tone}`} role={role}>
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  aside,
  action,
}: {
  title: string;
  aside?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page__header">
      <h1>{title}</h1>
      {aside ? <div className="page__aside small muted">{aside}</div> : null}
      {action ? <div className="page__action">{action}</div> : null}
    </header>
  );
}
