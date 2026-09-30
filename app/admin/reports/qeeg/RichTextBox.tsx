import { useId, useRef, useState, type TextareaHTMLAttributes } from 'react';
import type { RichText } from '../../../../domain/reports/qeeg/types';
import { Button } from '../../../shell/components/Controls';
import { retype, stylesAt, toggleMark, type Style } from './richEdit';

/**
 * A box of formatted text, bold and underline and nothing else, as the
 * summary and the page of what has changed are typed (docs/SPEC/reports-qeeg.md
 * section 4: "formatted text: bold and underline").
 *
 * **One set of controls for either language.** The English summary and its
 * Arabic version are formatted with the same tools, so a mark means the same
 * in both, and `richEdit` keeps each mark on its letters as she types. The
 * box knows nothing of a language: the Arabic box (`atoms/ArabicVersionField`,
 * the one console file allowed to say a text is Arabic) hands in the
 * attributes that say so, through `textProps`, and they are set on the box and
 * on the line that shows how it will be set, never on a label or a button.
 *
 * **Too long is refused when asked, never cut.** With `refuseLongerThan`, a
 * change that would make the text longer than it may hold is not taken, and a
 * sentence says why (section 4, rule 6: text that is too long is refused,
 * never cut). Without it, the box's own `maxLength`, if given, applies as
 * before.
 */

/** The text as the page will set it: bold and underline, nothing else. */
function Formatted({
  rich,
  textProps,
}: {
  rich: RichText;
  textProps: TextareaHTMLAttributes<HTMLTextAreaElement>;
}) {
  const pieces: { text: string; bold: boolean; underline: boolean }[] = [];
  let at = 0;
  for (const mark of rich.marks) {
    if (mark.from > at)
      pieces.push({ text: rich.text.slice(at, mark.from), bold: false, underline: false });
    pieces.push({
      text: rich.text.slice(mark.from, mark.to),
      bold: mark.bold === true,
      underline: mark.underline === true,
    });
    at = mark.to;
  }
  if (at < rich.text.length)
    pieces.push({ text: rich.text.slice(at), bold: false, underline: false });
  return (
    <p className="qeeg-rich__formatted" lang={textProps.lang} dir={textProps.dir}>
      {pieces.map((piece, index) => {
        const underlined = piece.underline ? <u>{piece.text}</u> : piece.text;
        return piece.bold ? (
          <strong key={index}>{underlined}</strong>
        ) : (
          <span key={index}>{underlined}</span>
        );
      })}
    </p>
  );
}

/** The sentence a box says when what was typed or pasted is longer than it may hold. */
export function tooLongSentence(most: number): string {
  return `This is longer than the ${most} characters it may hold, so it was not taken. Shorten it and try again.`;
}

export function RichTextBox({
  id,
  label,
  value,
  most,
  onChange,
  hint,
  textProps = {},
  refuseLongerThan,
}: {
  id: string;
  label: string;
  value: RichText;
  most: number;
  onChange: (next: RichText) => void;
  /** A sentence after the count, read with the box. */
  hint?: string;
  /** Set on the box and on the line that shows how it will be set. */
  textProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
  /** Refuse, with a sentence, a change longer than this. */
  refuseLongerThan?: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const errorId = useId();
  const [selection, setSelection] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const [refused, setRefused] = useState(false);
  const styled = stylesAt(value, selection.from, selection.to);
  const hasSelection = selection.from < selection.to;

  const remember = () => {
    const element = box.current;
    if (element) setSelection({ from: element.selectionStart, to: element.selectionEnd });
  };

  const apply = (style: Style) => {
    onChange(toggleMark(value, selection.from, selection.to, style));
    // Back to the box, with the same stretch still chosen.
    const element = box.current;
    if (element) {
      element.focus();
      element.setSelectionRange(selection.from, selection.to);
    }
  };

  const take = (text: string) => {
    if (refuseLongerThan !== undefined && text.length > refuseLongerThan) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onChange(retype(value, text));
  };

  return (
    <>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="qeeg-rich__tools" role="toolbar" aria-label={`Formatting for ${label}`}>
        <Button
          variant="quiet"
          aria-pressed={hasSelection && styled.bold}
          disabled={!hasSelection}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply('bold')}
        >
          Bold
        </Button>
        <Button
          variant="quiet"
          aria-pressed={hasSelection && styled.underline}
          disabled={!hasSelection}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply('underline')}
        >
          Underline
        </Button>
      </div>
      <textarea
        ref={box}
        id={id}
        className="report-editor__note"
        {...textProps}
        aria-describedby={refused ? `${errorId} ${hintId}` : hintId}
        aria-invalid={refused ? true : undefined}
        value={value.text}
        onChange={(event) => take(event.currentTarget.value)}
        onSelect={remember}
        onKeyUp={remember}
        onMouseUp={remember}
      />
      {refused ? (
        <p id={errorId} className="field__hint field__hint--error small">
          {tooLongSentence(most)}
        </p>
      ) : null}
      <p id={hintId} className="small muted">
        {value.text.length} of {most} characters. Choose words, then Bold or Underline.
        {hint ? ` ${hint}` : ''}
      </p>
      {value.marks.length > 0 ? (
        <div className="qeeg-rich__as-set">
          <span className="field__label">As it will be set</span>
          <Formatted rich={value} textProps={textProps} />
        </div>
      ) : null}
    </>
  );
}
