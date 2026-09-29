import { useId, useRef, useState } from 'react';
import { REGION_IDS, type RegionId } from '../../../../domain/reports/qeeg/catalogue/ids';
import type {
  ChangeFigure,
  CustomItem,
  Picked,
  RichText,
  TypedFigure,
} from '../../../../domain/reports/qeeg/types';
import { LIMITS } from '../../../../domain/reports/qeeg/types';
import { phrase } from '../../../../domain/reports/qeeg/wording';
import { typedFigure } from '../../../../domain/reports/qeeg/choices';
import { isBlank } from '../../../../domain/reports/qeeg/text';
import { Button, Field, Select } from '../../../shell/components/Controls';
import { Checkbox } from '../../clients/FormAtoms';
import { retype, stylesAt, toggleMark, type Style } from './richEdit';

/**
 * The pieces the brain-map form is made of: a list of ticks with her own
 * items beside them, the regions of the head, a figure she estimates, and
 * the summary box with bold and underline.
 *
 * **Every choice starts unmade.** A select opens on "Not chosen", a score on
 * "Not scored", a figure on "Not given". The report was rebuilt from a tool
 * that started every score at 5 and printed it whether anyone had looked;
 * here nothing is put on a page that she did not choose
 * (docs/SPEC/reports-qeeg.md section 4, rule 3).
 *
 * **Every word of the report's own comes from its wording** (`phrase`), so
 * what she ticks here is the sentence the page prints. The console's own
 * words around it are English, as every staff screen is.
 */

// ---------------------------------------------------------------------------
// A list of ticks, and her own items
// ---------------------------------------------------------------------------

type OwnItem = CustomItem & { readonly position: number };

/** The next key the app makes for an item of hers: `c0`, `c1`, … never one in use. */
function nextKey(custom: Readonly<Record<string, OwnItem>>): string {
  let n = 0;
  while (Object.hasOwn(custom, `c${n}`)) n += 1;
  return `c${n}`;
}

/** Her items in their order. */
function inOrder(custom: Readonly<Record<string, OwnItem>>): [string, OwnItem][] {
  return Object.entries(custom).sort(([, a], [, b]) => a.position - b.position);
}

/** The items renumbered from 0 in the order given, as the shape requires. */
function renumbered(entries: readonly [string, OwnItem][]): Record<string, OwnItem> {
  return Object.fromEntries(entries.map(([key, item], position) => [key, { ...item, position }]));
}

/**
 * The label of an item of hers. Emptied, it stays on screen with a hint and
 * is not taken into the report, which keeps the label it had: the report
 * holds no empty item, and a half-typed value is held back as a figure is.
 */
function OwnLabel({
  id,
  label,
  onChange,
}: {
  id: string;
  label: string;
  onChange: (next: string) => void;
}) {
  const [typed, setTyped] = useState(label);
  return (
    <Field
      id={id}
      label="Your own item"
      value={typed}
      maxLength={LIMITS.label}
      error={isBlank(typed) ? 'An item is never empty. Remove it instead.' : undefined}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setTyped(next);
        if (!isBlank(next)) onChange(next);
      }}
    />
  );
}

export function PickedList<Id extends string>({
  id,
  ids,
  labelOf,
  picked,
  onChange,
  withNote = false,
}: {
  id: string;
  ids: readonly Id[];
  labelOf: (id: Id) => string;
  picked: Picked<Id>;
  onChange: (next: Picked<Id>) => void;
  /** A recommendation she adds has a second half, the advice. */
  withNote?: boolean;
}) {
  const [adding, setAdding] = useState('');
  const custom = picked.custom as Readonly<Record<string, OwnItem>>;
  const own = inOrder(custom);
  const full = own.length >= LIMITS.customPerList;

  const tick = (item: Id, on: boolean) =>
    onChange({
      ...picked,
      // Kept in the list's order, whatever order she ticked them in.
      chosen: ids.filter((each) => (each === item ? on : picked.chosen.includes(each))),
    });

  const setOwn = (key: string, item: OwnItem) =>
    onChange({ ...picked, custom: { ...custom, [key]: item } });

  const removeOwn = (key: string) =>
    onChange({ ...picked, custom: renumbered(own.filter(([each]) => each !== key)) });

  const add = () => {
    const label = adding.trim();
    if (label === '' || full) return;
    const key = nextKey(custom);
    onChange({
      ...picked,
      custom: {
        ...custom,
        [key]: {
          label: { en: label, ar: null },
          note: withNote ? { en: '', ar: null } : null,
          chosen: true,
          position: own.length,
        },
      },
    });
    setAdding('');
  };

  return (
    <div className="qeeg-picked">
      <div className="qeeg-picked__ticks">
        {ids.map((item) => (
          <Checkbox
            key={item}
            id={`${id}-${item}`}
            label={labelOf(item)}
            checked={picked.chosen.includes(item)}
            onChange={(on) => tick(item, on)}
          />
        ))}
      </div>
      {own.map(([key, item]) => (
        <div key={key} className="qeeg-own">
          <Checkbox
            id={`${id}-own-${key}`}
            label="Included in the report"
            checked={item.chosen}
            onChange={(on) => setOwn(key, { ...item, chosen: on })}
          />
          <OwnLabel
            id={`${id}-own-${key}-label`}
            label={item.label.en}
            onChange={(en) => setOwn(key, { ...item, label: { ...item.label, en } })}
          />
          {withNote ? (
            <Field
              id={`${id}-own-${key}-note`}
              label="What it advises"
              value={item.note?.en ?? ''}
              maxLength={LIMITS.note}
              onChange={(event) =>
                setOwn(key, {
                  ...item,
                  note: { en: event.currentTarget.value, ar: item.note?.ar ?? null },
                })
              }
            />
          ) : null}
          <Button variant="quiet" onClick={() => removeOwn(key)}>
            Remove this item
          </Button>
        </div>
      ))}
      {full ? (
        <p className="small muted">
          {LIMITS.customPerList} of your own items is the most one list holds.
        </p>
      ) : (
        <div className="qeeg-add">
          <Field
            id={`${id}-add`}
            label="Add your own item"
            value={adding}
            maxLength={LIMITS.label}
            onChange={(event) => setAdding(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button disabled={adding.trim() === ''} onClick={add}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regions of the head
// ---------------------------------------------------------------------------

export function RegionPicker({
  id,
  regions,
  onChange,
}: {
  id: string;
  regions: readonly RegionId[];
  onChange: (next: RegionId[]) => void;
}) {
  return (
    <fieldset className="qeeg-regions">
      <legend className="field__label">Regions</legend>
      <div className="qeeg-regions__list">
        {REGION_IDS.map((region) => (
          <Checkbox
            key={region}
            id={`${id}-${region}`}
            label={phrase(`region.${region}.label`, 'initial', 'en')}
            checked={regions.includes(region)}
            onChange={(on) =>
              // In the list's order: the page reads regions front to back.
              onChange(REGION_IDS.filter((each) => (each === region ? on : regions.includes(each))))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// A choice from a list, starting unmade
// ---------------------------------------------------------------------------

export function Choice<V extends string>({
  id,
  label,
  value,
  options,
  none = 'Not chosen',
  onChange,
}: {
  id: string;
  label: string;
  value: V | null;
  options: readonly { value: V; label: string }[];
  none?: string;
  onChange: (next: V | null) => void;
}) {
  return (
    <Select
      id={id}
      label={label}
      value={value ?? ''}
      onChange={(event) => {
        const chosen = event.currentTarget.value;
        onChange(options.find((option) => option.value === chosen)?.value ?? null);
      }}
    >
      <option value="">{none}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

// ---------------------------------------------------------------------------
// A figure she estimates
// ---------------------------------------------------------------------------

type Direction = '' | 'increase' | 'decrease' | 'none';

/**
 * The whole number she typed, or NaN when what she typed is not one. Reading
 * the box is the form's; whether the number is one the report takes is the
 * domain's (`typedFigure`, `isSessionCount`).
 */
export function wholeNumberIn(typed: string): number {
  const text = typed.trim();
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

function directionOf(figure: ChangeFigure | null): Direction {
  if (figure === null) return '';
  return figure.kind === 'percent' ? figure.direction : 'none';
}

const FIGURE_PROBLEM = `Give a whole number of percent up to ${LIMITS.percentMost}. The top of a range is above its bottom.`;

/**
 * What she typed, as a figure, or null with a hint while it is not one yet.
 * A figure is her own estimate (`typed`); a calculated one is not offered on
 * this form, and none is ever read off a picture (section 10). Whether it is
 * a figure at all is `typedFigure`'s answer, which asks the shape.
 */
function figureFrom(
  direction: Direction,
  low: string,
  high: string,
): { figure: TypedFigure | null; problem: string | null } {
  if (direction === '') return { figure: null, problem: null };
  const top = high.trim() === '' ? null : wholeNumberIn(high);
  const figure = typedFigure(direction, low.trim() === '' ? null : wholeNumberIn(low), top);
  return { figure, problem: figure === null ? FIGURE_PROBLEM : null };
}

export function FigureField({
  id,
  label,
  figure,
  onChange,
}: {
  id: string;
  label: string;
  figure: ChangeFigure | null;
  onChange: (next: TypedFigure | null) => void;
}) {
  const [direction, setDirection] = useState<Direction>(() => directionOf(figure));
  const [low, setLow] = useState(() => (figure?.kind === 'percent' ? String(figure.low) : ''));
  const [high, setHigh] = useState(() =>
    figure?.kind === 'percent' && figure.high !== null ? String(figure.high) : '',
  );
  const { problem } = figureFrom(direction, low, high);

  const take = (next: { direction?: Direction; low?: string; high?: string }) => {
    const d = next.direction ?? direction;
    const l = next.low ?? low;
    const h = next.high ?? high;
    if (next.direction !== undefined) setDirection(d);
    if (next.low !== undefined) setLow(l);
    if (next.high !== undefined) setHigh(h);
    onChange(figureFrom(d, l, h).figure);
  };

  return (
    <fieldset className="qeeg-figure">
      <legend className="field__label">{label}</legend>
      <div className="qeeg-figure__row">
        <Select
          id={`${id}-direction`}
          label="Change"
          value={direction}
          onChange={(event) => take({ direction: event.currentTarget.value as Direction })}
        >
          <option value="">Not given</option>
          <option value="increase">Increase</option>
          <option value="decrease">Decrease</option>
          <option value="none">{phrase('figure.none', 'follow-up', 'en')}</option>
        </Select>
        {direction === 'increase' || direction === 'decrease' ? (
          <>
            <Field
              id={`${id}-low`}
              label="About, in percent"
              inputMode="numeric"
              value={low}
              onChange={(event) => take({ low: event.currentTarget.value })}
            />
            <Field
              id={`${id}-high`}
              label="To, for a range"
              inputMode="numeric"
              value={high}
              onChange={(event) => take({ high: event.currentTarget.value })}
            />
          </>
        ) : null}
      </div>
      {problem ? <p className="field__hint field__hint--error small">{problem}</p> : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// The summary, with bold and underline
// ---------------------------------------------------------------------------

/** The text as the page will set it: bold and underline, nothing else. */
function Formatted({ rich }: { rich: RichText }) {
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
    <p className="qeeg-rich__formatted">
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

export function RichField({
  id,
  label,
  value,
  most,
  onChange,
}: {
  id: string;
  label: string;
  value: RichText;
  most: number;
  onChange: (next: RichText) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const [selection, setSelection] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
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

  return (
    <div className="qeeg-rich">
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
        aria-describedby={hintId}
        value={value.text}
        maxLength={most}
        onChange={(event) => onChange(retype(value, event.currentTarget.value))}
        onSelect={remember}
        onKeyUp={remember}
        onMouseUp={remember}
      />
      <p id={hintId} className="small muted">
        {value.text.length} of {most} characters. Choose words, then Bold or Underline.
      </p>
      {value.marks.length > 0 ? (
        <div className="qeeg-rich__as-set">
          <span className="field__label">As it will be set</span>
          <Formatted rich={value} />
        </div>
      ) : null}
    </div>
  );
}
