import { createContext, useContext, useId, useState } from 'react';
import { Button, Field } from '../../../../shell/components/Controls';
import { Textarea } from '../../../clients/FormAtoms';

/**
 * The box in which the practitioner types the Arabic version of something she
 * typed in English (docs/SPEC/reports-qeeg.md section 8), and the ONE file of
 * the console allowed to set the language and the direction of its text
 * (docs/CHANGE-REQUESTS/reports-02.md, request 5; the allow-list in
 * `tests/lint/console-is-english.test.ts`).
 *
 * **Why one component.** The staff screens are English. The Arabic report
 * prints the approved Arabic wording and her Arabic where she gave it, so the
 * form must take her Arabic somewhere; a box that holds Arabic must say it is
 * Arabic (`lang="ar"`) for a screen reader to read it as Arabic, and read from
 * the right (`dir="rtl"`) for her to type it. One component does that for
 * every such box, so the guard sees the one exception by its name. Every
 * label around it stays English, and names what it is the Arabic version of.
 *
 * **Collapsed until asked for.** Most of what she types needs no Arabic of its
 * own: an Arabic report prints the English where none is given. So each box
 * is a quiet button beside its English until she opens it, and says whether
 * an Arabic version is already given.
 *
 * **It writes the Arabic half and nothing else.** It hands back only the text
 * of the Arabic, or null when she empties it; the caller writes that into the
 * `ar` half of the one `Bilingual` it belongs to, keeping the English as it
 * is. Cleaning it (what draws nothing, direction marks) is the shape's, on the
 * server, as for everything she types.
 *
 * **Shown only where a half may be written.** A form that shows a report read
 * only (the draft of a second-language report, whose everything but its own
 * language is the first report's) turns these off with `ArabicBoxes`, and
 * gathers the boxes it does take in one place of its own.
 */

/** Whether the Arabic boxes beside what she typed are offered here. */
export const ArabicBoxes = createContext(true);

export function ArabicVersionField({
  id,
  of,
  value,
  most,
  multiline = false,
  startOpen = false,
  onChange,
}: {
  id: string;
  /** What it is the Arabic version of, in English: "the summary", "your own item". */
  of: string;
  /** The Arabic half as it stands, or null when none is given. */
  value: string | null;
  most: number;
  /** A paragraph rather than a line. */
  multiline?: boolean;
  /** Open from the first, where writing the Arabic is the whole of the task. */
  startOpen?: boolean;
  /** The new Arabic half, or null when emptied. */
  onChange: (arabic: string | null) => void;
}) {
  const offered = useContext(ArabicBoxes);
  const [open, setOpen] = useState(startOpen);
  const bodyId = useId();
  if (!offered) return null;

  const given = value !== null && value.trim() !== '';
  const label = `Arabic version of ${of}`;
  const take = (text: string) => onChange(text === '' ? null : text);

  if (!open) {
    return (
      <div className="qeeg-arabic">
        <Button variant="quiet" aria-expanded={false} onClick={() => setOpen(true)}>
          {given ? `Change the Arabic version of ${of}` : `Add an Arabic version of ${of}`}
        </Button>
        {given ? <span className="small muted">An Arabic version is given.</span> : null}
      </div>
    );
  }

  return (
    <div className="qeeg-arabic" id={bodyId}>
      {multiline ? (
        <Textarea
          id={id}
          label={label}
          lang="ar"
          dir="rtl"
          maxLength={most}
          value={value ?? ''}
          onChange={(event) => take(event.currentTarget.value)}
        />
      ) : (
        <Field
          id={id}
          label={label}
          lang="ar"
          dir="rtl"
          maxLength={most}
          value={value ?? ''}
          onChange={(event) => take(event.currentTarget.value)}
        />
      )}
      <p className="small muted">
        Where no Arabic version is given, the Arabic report prints the English as it was typed.
      </p>
      {startOpen ? null : (
        <Button variant="quiet" aria-expanded aria-controls={bodyId} onClick={() => setOpen(false)}>
          Close the Arabic version
        </Button>
      )}
    </div>
  );
}
