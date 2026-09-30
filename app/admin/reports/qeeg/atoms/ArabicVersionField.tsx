import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { RichText } from '../../../../../domain/reports/qeeg/types';
import { Button, Field } from '../../../../shell/components/Controls';
import { Textarea } from '../../../clients/FormAtoms';
import { RichTextBox, tooLongSentence } from '../RichTextBox';

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
 * **Formatted text is formatted here too** (`rich`). The Arabic of the
 * summary, and of the page of what has changed, is a `RichText` of its own,
 * with bold and underline set by the same tools as the English
 * (`RichTextBox`); this file hands the box the attributes that say it is
 * Arabic, so it stays the only file that does.
 *
 * **For a keyboard and a screen reader.** The button that opens a box names
 * the region it opens (`aria-controls`) and says whether it is open; opening
 * it moves focus into the box; the sentence beneath is read with the box
 * (`aria-describedby`). A text longer than it may hold, typed or pasted, is
 * refused with a sentence and never cut (section 4, rule 6).
 *
 * **Shown only where a half may be written.** A form that shows a report read
 * only (the draft of a second-language report, whose everything but its own
 * language is the first report's) turns these off with `ArabicBoxes`, and
 * gathers the boxes it does take in one place of its own.
 */

/** Whether the Arabic boxes beside what she typed are offered here. */
export const ArabicBoxes = createContext(true);

const STAND_IN =
  'Where no Arabic version is given, the Arabic report prints the English as it was typed.';

/** What says a box holds Arabic, read from the right. The one place in the console. */
const ARABIC = Object.freeze({ lang: 'ar', dir: 'rtl' } as const);

type Plain = {
  rich?: false;
  /** The Arabic half as it stands, or null when none is given. */
  value: string | null;
  /** The new Arabic half, or null when emptied. */
  onChange: (arabic: string | null) => void;
  /** A paragraph rather than a line. */
  multiline?: boolean;
};

type Rich = {
  /** Formatted text: bold and underline, set as in the English box. */
  rich: true;
  value: RichText | null;
  onChange: (arabic: RichText | null) => void;
  multiline?: never;
};

export function ArabicVersionField(
  props: {
    id: string;
    /** What it is the Arabic version of, in English: "the summary", "your own item". */
    of: string;
    most: number;
    /** Open from the first, where writing the Arabic is the whole of the task. */
    startOpen?: boolean;
  } & (Plain | Rich),
) {
  const { id, of, most, startOpen = false } = props;
  const offered = useContext(ArabicBoxes);
  const [open, setOpen] = useState(startOpen);
  const [refused, setRefused] = useState(false);
  const bodyId = useId();
  // Focus follows a box she opened, never one open from the first.
  const asked = useRef(false);
  useEffect(() => {
    if (open && asked.current) document.getElementById(id)?.focus();
  }, [open, id]);
  if (!offered) return null;

  const text = props.rich ? (props.value?.text ?? null) : props.value;
  const given = text !== null && text.trim() !== '';
  const label = `Arabic version of ${of}`;

  const takePlain = (typed: string) => {
    if (props.rich) return;
    if (typed.length > most) {
      // Refused, never cut: what she pasted is not taken, and she is told.
      setRefused(true);
      return;
    }
    setRefused(false);
    props.onChange(typed === '' ? null : typed);
  };

  let box = null;
  if (open) {
    if (props.rich) {
      const { onChange } = props;
      box = (
        <RichTextBox
          id={id}
          label={label}
          value={props.value ?? { text: '', marks: [] }}
          most={most}
          hint={STAND_IN}
          textProps={ARABIC}
          refuseLongerThan={most}
          onChange={(next) => onChange(next.text === '' ? null : next)}
        />
      );
    } else {
      const shared = {
        id,
        label,
        ...ARABIC,
        value: props.value ?? '',
        hint: STAND_IN,
        error: refused ? tooLongSentence(most) : undefined,
      };
      box = props.multiline ? (
        <Textarea {...shared} onChange={(event) => takePlain(event.currentTarget.value)} />
      ) : (
        <Field {...shared} onChange={(event) => takePlain(event.currentTarget.value)} />
      );
    }
  }

  return (
    <div className="qeeg-arabic">
      {startOpen ? null : (
        <Button
          variant="quiet"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            asked.current = true;
            setRefused(false);
            setOpen((was) => !was);
          }}
        >
          {open
            ? 'Close the Arabic version'
            : given
              ? `Change the Arabic version of ${of}`
              : `Add an Arabic version of ${of}`}
        </Button>
      )}
      {!open && given ? <span className="small muted">An Arabic version is given.</span> : null}
      <div id={bodyId} className="qeeg-arabic__body">
        {box}
      </div>
    </div>
  );
}
