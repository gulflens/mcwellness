import type { ChangeEvent } from 'react';

/**
 * The two places Settings › Announcements holds Arabic, and the ONE file of
 * that screen allowed to set the language and the direction of its text (the
 * allow-list in `tests/lint/console-is-english.test.ts`;
 * docs/CHANGE-REQUESTS/client-portal-06.md).
 *
 * The console is English (the operator's decision of 7 September 2026), and
 * an announcement is read by households in both languages (the push memo's
 * decision 3: "written by you or an admin, in Settings, in both languages"),
 * so the form must take the Arabic somewhere. A box that holds Arabic says it
 * is Arabic (`lang="ar"`) for a screen reader to read it so, and reads from
 * the right (`dir="rtl"`) for the person typing it; the preview of the Arabic
 * is drawn the same way, because it is what an Arabic household will read.
 * The pattern is the brain-map report's `ArabicVersionField`: one component,
 * so the guard sees the one exception by its name, and every label around it
 * stays English and names what it is the Arabic of.
 */

const ARABIC = Object.freeze({ lang: 'ar', dir: 'rtl' } as const);

export function ArabicTextField({
  id,
  label,
  value,
  onChange,
  multiline = false,
  error,
  hint,
}: {
  id: string;
  /** In English: "Arabic title", "Arabic text". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  error?: string;
  hint?: string;
}) {
  const message = error || hint;
  const messageId = message ? `${id}-message` : undefined;
  const shared = {
    id,
    ...ARABIC,
    value,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': messageId,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.currentTarget.value),
  };
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {multiline ? (
        <textarea className="field__input announcements__textarea" rows={5} {...shared} />
      ) : (
        <input className="field__input" type="text" {...shared} />
      )}
      {message ? (
        <div
          id={messageId}
          role={error ? 'alert' : undefined}
          className={['field__hint', 'small', error ? 'field__hint--error' : 'muted'].join(' ')}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

/** The Arabic of an announcement as an Arabic household will read it. */
export function ArabicPreview({ title, body }: { title: string; body: string }) {
  return (
    <article className="announcements__preview" {...ARABIC}>
      <h4>{title}</h4>
      <p>{body}</p>
    </article>
  );
}
