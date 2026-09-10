import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button, Field, Note } from '../../shell/components/Controls';
import { wrapCaption } from './wrapCaption';

/**
 * Signing on screen (docs/SPEC/client-record.md section 7, method
 * `app_signature`): a stroke drawn with a finger or a mouse, the person's
 * name typed beside it, and a PNG at a fixed size that becomes the immutable
 * evidence the consent points at.
 *
 * **No library.** A signature pad is a pointer event, a path and
 * `toDataURL`; the dependency would be larger than the file and every byte of
 * it would sit in the bundle of a practice that files a handful of consents a
 * week. `package.json` is the shared zone besides (docs/SPEC/OWNERSHIP.md), so
 * adding one is a change request, and there is nothing here to ask for.
 *
 * **A typed name is not a signature.** The name field is beside the drawing,
 * never instead of it: Confirm stays disabled until an actual stroke exists,
 * and the line under the pad says so and points at the paper form. Recording
 * a typed name as `app_signature` would put a consent on the record attesting
 * to something that never happened.
 *
 * **Fixed size, except for how tall the caption makes it.** The visible
 * canvas is scaled for the screen it is on, so a stroke is not a staircase on
 * a retina display; the PNG is composed separately at exactly 600 wide, 260
 * tall while there is no caption or a one-line one. The printed name and the
 * date are drawn into the image beneath the stroke, the way they sit on a
 * paper form — which also means the name is inside the evidence rather than
 * in a column beside it.
 *
 * **The caption wraps rather than reword the evidence.** Signing once for
 * several purposes at once (`SignAllForm.tsx`) means naming all of them in
 * the caption, in the same words their headings use, and that can run wider
 * than one `fillText` line ever holds. `wrapCaption.ts` breaks it into lines
 * that fit, measured against the real font with `ctx.measureText`, and the
 * image grows downward to hold whatever that produces — the space reserved
 * above the caption band for the stroke itself never shrinks to make room.
 *
 * **The keyboard cannot draw**, and no arrangement of this control changes
 * that. The alternative is not a worse version of the same thing but a
 * different route through the same rule: the paper form, offered beside this
 * on the same screen and equally valid (section 7's `paper_scan`). The line
 * under the pad names it rather than leaving somebody stuck.
 *
 * **When there is no canvas at all** — an old browser, or a test environment
 * without one — the pad says so plainly and the form offers the paper route
 * instead. It never silently produces an empty image.
 */

/** The PNG every signature is rendered at, whatever drew it. */
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 260;
/** The band at the foot of the image holding the printed name and the date. */
const CAPTION_HEIGHT = 60;
/**
 * How much room one line of the caption needs: the fixed extra the band has
 * always grown by when a caption exists at all, the spacing between two
 * wrapped lines, and — for a caption past the first line — how much taller
 * the whole image grows to hold each one. One number for all three, because
 * they are the same "one more line" the caption is asking for.
 */
const CAPTION_LINE_HEIGHT = 20;
const CAPTION_FONT = '12px sans-serif';
const NAME_FONT = '16px sans-serif';
const STROKE_WIDTH = 2.5;

export type SignatureResult = {
  /** `image/png`, always: the route accepts nothing else for a drawn signature. */
  mimeType: 'image/png';
  bytesBase64: string;
};

type Point = { x: number; y: number };

function context(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

export function SignaturePad({
  signedName,
  onSignedNameChange,
  onChange,
  disabled,
  today,
  caption,
}: {
  signedName: string;
  onSignedNameChange: (value: string) => void;
  /** The rendered PNG, or null while there is nothing drawn to render. */
  onChange: (signature: SignatureResult | null) => void;
  disabled?: boolean;
  /** The date printed into the image, in the practice's own day. */
  today: string;
  /**
   * What the signature covers, printed small beneath the date when a
   * signature stands for several consents at once; the image is the
   * evidence, so the image says so.
   */
  caption?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  /** Paints what has been drawn onto the visible canvas at its own scale. */
  const repaint = useCallback((): void => {
    const canvas = canvasRef.current;
    const ctx = context(canvas);
    if (!canvas || !ctx) return;
    const scale = canvas.width / SIGNATURE_WIDTH;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = STROKE_WIDTH * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The ink is the interface's own colour, read from the token rather than
    // written here: docs/DESIGN-BRIEF.md section 8 keeps every colour in
    // app/shell/tokens.css, and a hex literal in a component fails review.
    ctx.strokeStyle = getComputedStyle(canvas).color || 'currentColor';
    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      const [first, ...rest] = stroke;
      if (!first) continue;
      ctx.moveTo(first.x * scale, first.y * scale);
      for (const point of rest) ctx.lineTo(point.x * scale, point.y * scale);
      // A single tap is a dot, not nothing: without this a full stop of a
      // signature would vanish.
      if (rest.length === 0) ctx.lineTo(first.x * scale + 0.1, first.y * scale);
      ctx.stroke();
    }
  }, []);

  /**
   * The PNG, composed with the printed name beneath the stroke and the
   * caption — wrapped into however many lines it needs — beneath that. The
   * image grows downward to hold any line past the first; the space above
   * the band, where the stroke itself lives, stays the size it has always
   * been, whatever the caption says.
   */
  const render = useCallback((): SignatureResult | null => {
    const source = canvasRef.current;
    if (!source || typeof document.createElement !== 'function') return null;
    const out = document.createElement('canvas');
    const ctx = context(out);
    if (!ctx || typeof out.toDataURL !== 'function') return null;

    // Measured before anything is drawn: `measureText` answers for the
    // caption's own font, so that font has to be set first, and how many
    // lines wrapping produces decides how tall the image needs to be.
    const captionLines = caption
      ? (() => {
          ctx.font = CAPTION_FONT;
          return wrapCaption(caption, SIGNATURE_WIDTH - 48, (text) => ctx.measureText(text).width);
        })()
      : [];
    const extraLines = Math.max(0, captionLines.length - 1);

    out.width = SIGNATURE_WIDTH;
    out.height = SIGNATURE_HEIGHT + extraLines * CAPTION_LINE_HEIGHT;
    // Ink on paper, deliberately, and deliberately not the interface's own
    // colours: this is a filed document rather than a screen. A signature
    // rendered in a dark theme would be a white stroke on black, which is
    // wrong in every place a consent is ever looked at — printed, attached to
    // an email, opened years later by somebody who was not there.
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes.current) {
      const [first, ...rest] = stroke;
      if (!first) continue;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of rest) ctx.lineTo(point.x, point.y);
      if (rest.length === 0) ctx.lineTo(first.x + 0.1, first.y);
      ctx.stroke();
    }
    // A caption needs its own lines, so the band grows to hold them rather
    // than crowding the name and the date it sits beneath — pinned to the
    // same offset from the top whether the caption is one line or four, so
    // the stroke's own room above it never shrinks to make space.
    const captionTop =
      SIGNATURE_HEIGHT -
      (captionLines.length > 0 ? CAPTION_HEIGHT + CAPTION_LINE_HEIGHT : CAPTION_HEIGHT);
    ctx.beginPath();
    ctx.moveTo(24, captionTop);
    ctx.lineTo(SIGNATURE_WIDTH - 24, captionTop);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'black';
    ctx.font = NAME_FONT;
    ctx.fillText(signedName, 24, captionTop + 26);
    ctx.fillText(today, 24, captionTop + 48);
    if (captionLines.length > 0) {
      // Smaller than the name and the date: these lines name what was
      // agreed to, not who agreed to it, and must never read as a second
      // signature.
      ctx.font = CAPTION_FONT;
      captionLines.forEach((line, index) => {
        ctx.fillText(line, 24, captionTop + 66 + index * CAPTION_LINE_HEIGHT);
      });
    }
    const url = out.toDataURL('image/png');
    const comma = url.indexOf(',');
    if (!url.startsWith('data:image/png;base64,') || comma === -1) return null;
    return { mimeType: 'image/png', bytesBase64: url.slice(comma + 1) };
  }, [signedName, today, caption]);

  // The visible canvas is sized to its own box and the device's pixel ratio
  // once it is on screen; the fixed-size PNG is composed separately, so this
  // only affects how the stroke looks while it is being drawn.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!context(canvas)) {
      setUnavailable(true);
      return;
    }
    const ratio = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;
    const width = canvas.clientWidth || SIGNATURE_WIDTH;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((width * SIGNATURE_HEIGHT * ratio) / SIGNATURE_WIDTH);
    repaint();
  }, [repaint]);

  // The typed name is drawn into the image, so changing it after a stroke has
  // to re-render: otherwise the evidence would carry a name the form no longer
  // shows.
  useEffect(() => {
    if (hasInk) onChange(render());
  }, [hasInk, onChange, render, signedName, caption]);

  function pointFrom(event: PointerEvent<HTMLCanvasElement>): Point | null {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0) return null;
    return {
      x: ((event.clientX - box.left) / box.width) * SIGNATURE_WIDTH,
      y: ((event.clientY - box.top) / box.width) * SIGNATURE_WIDTH,
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>): void {
    if (disabled || unavailable) return;
    const point = pointFrom(event);
    if (!point) return;
    // The pointer keeps reporting to this element once it leaves it, so a
    // stroke that runs off the edge finishes rather than freezing mid-line.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    strokes.current = [...strokes.current, [point]];
    repaint();
  }

  function move(event: PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current) return;
    const point = pointFrom(event);
    if (!point) return;
    const last = strokes.current[strokes.current.length - 1];
    last?.push(point);
    repaint();
  }

  function end(): void {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(strokes.current.some((stroke) => stroke.length > 0));
  }

  function clear(): void {
    strokes.current = [];
    drawing.current = false;
    setHasInk(false);
    repaint();
    onChange(null);
  }

  return (
    <div className="signature">
      <p className="field__label" id="signature-label">
        Signature
      </p>
      {unavailable ? (
        <Note tone="critical">
          This browser cannot take a signature on screen. Use the paper form instead.
        </Note>
      ) : (
        <canvas
          ref={canvasRef}
          className={disabled ? 'signature__pad signature__pad--gated' : 'signature__pad'}
          aria-labelledby="signature-label"
          // Gated, not broken: the pad is live-looking and strokes vanish
          // without this, so somebody signs, sees nothing, and signs again.
          aria-disabled={disabled ? true : undefined}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
      {disabled && !unavailable ? (
        // Beside the pad, where the person is looking, rather than two
        // controls away where the scroll box is.
        <p className="small muted">Read to the end of the wording to sign.</p>
      ) : null}
      {!disabled && !unavailable ? (
        <div className="signature__actions">
          <Button variant="quiet" onClick={clear} disabled={!hasInk}>
            Clear
          </Button>
        </div>
      ) : null}
      <p className="small muted">
        Sign with a finger or the mouse. A typed name on its own is not a signature — if the person
        cannot sign on screen, take the paper form instead.
      </p>
      <Field
        id="signature-name"
        label="Name, as the person writes it"
        value={signedName}
        onChange={(event) => onSignedNameChange(event.target.value)}
        disabled={disabled}
        hint="Printed beneath the signature in the image that is filed."
      />
    </div>
  );
}
