// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH, SignaturePad } from './SignaturePad';

/**
 * The signature pad (docs/SPEC/client-record.md section 7).
 *
 * jsdom has no canvas, which is the honest reason the component checks for one
 * rather than assuming it: with nothing stubbed the pad must say so and send
 * the person to the paper form, and that is the first test here. The rest stub
 * a two-dimensional context so the drawing path itself can be walked.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TODAY = '2026-09-03';

/** Everything the pad asks of a context, and nothing more. */
function fakeContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    lineCap: 'round',
    lineJoin: 'round',
    strokeStyle: '',
    fillStyle: '',
    font: '',
  } as unknown as CanvasRenderingContext2D;
}

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext() as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG_DATA_URL);
  // jsdom lays nothing out, so the pad would map every pointer to nothing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: SIGNATURE_WIDTH,
    bottom: SIGNATURE_HEIGHT,
    width: SIGNATURE_WIDTH,
    height: SIGNATURE_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect);
}

/** Draws a short stroke across the pad, the way a finger would. */
function sign(pad: Element): void {
  fireEvent.pointerDown(pad, { clientX: 100, clientY: 120, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 160, clientY: 90, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 220, clientY: 130, pointerId: 1 });
  fireEvent.pointerUp(pad, { clientX: 220, clientY: 130, pointerId: 1 });
}

describe('SignaturePad without a canvas', () => {
  it('says so, and sends the person to the paper form', () => {
    const onChange = vi.fn();
    render(
      <SignaturePad signedName="" onSignedNameChange={vi.fn()} onChange={onChange} today={TODAY} />,
    );
    expect(
      screen.getByText(
        'This browser cannot take a signature on screen. Use the paper form instead.',
      ),
    ).toBeTruthy();
    // Never a silently empty image.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SignaturePad', () => {
  beforeEach(stubCanvas);

  it('renders nothing until something is drawn, then a PNG', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SignaturePad
        signedName="Iris Harbour"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today={TODAY}
      />,
    );
    // A typed name on its own produces no signature: this is the rule the
    // route depends on, since `app_signature` attests that somebody signed.
    expect(onChange).not.toHaveBeenCalled();

    const pad = container.querySelector('canvas');
    expect(pad).not.toBeNull();
    sign(pad as Element);

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as { mimeType: string; bytesBase64: string };
    expect(last.mimeType).toBe('image/png');
    // The data URL prefix is stripped: the route wants the bytes, not a URL.
    expect(last.bytesBase64).toBe('iVBORw0KGgoAAAANSUhEUg==');
  });

  it('says on screen that a typed name is not a signature', () => {
    render(
      <SignaturePad signedName="" onSignedNameChange={vi.fn()} onChange={vi.fn()} today={TODAY} />,
    );
    expect(screen.getByText(/A typed name on its own is not a signature/)).toBeTruthy();
  });

  it('prints the typed name into the image, and re-renders when it changes', () => {
    const onChange = vi.fn();
    const context = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);

    const { container, rerender } = render(
      <SignaturePad
        signedName="Iris Harbour"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today={TODAY}
      />,
    );
    sign(container.querySelector('canvas') as Element);
    const fillText = context.fillText as unknown as ReturnType<typeof vi.fn>;
    expect(fillText.mock.calls.some((call) => call[0] === 'Iris Harbour')).toBe(true);
    expect(fillText.mock.calls.some((call) => call[0] === TODAY)).toBe(true);

    // Correcting the name after signing must not leave the filed image
    // carrying a name the form no longer shows.
    fillText.mockClear();
    rerender(
      <SignaturePad
        signedName="Iris Creek"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today={TODAY}
      />,
    );
    expect(fillText.mock.calls.some((call) => call[0] === 'Iris Creek')).toBe(true);
  });

  it('clears back to nothing, and says nothing is signed', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SignaturePad
        signedName="Iris Harbour"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today={TODAY}
      />,
    );
    const clear = screen.getByRole('button', { name: 'Clear' });
    // Nothing drawn: nothing to clear.
    expect((clear as HTMLButtonElement).disabled).toBe(true);

    sign(container.querySelector('canvas') as Element);
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('prints a caption beneath the name and the date when one is given, smaller than either', () => {
    const onChange = vi.fn();
    const context = fakeContext();
    const fontAtCall: string[] = [];
    context.fillText = vi.fn((text: string) => {
      fontAtCall.push(String(context.font));
      void text;
    }) as unknown as CanvasRenderingContext2D['fillText'];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);

    const { container } = render(
      <SignaturePad
        signedName="Alpha Synthetic"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today={TODAY}
        caption="Signed for: participation, visits at home, brain-map and neurofeedback information"
      />,
    );
    sign(container.querySelector('canvas') as Element);

    const fillText = context.fillText as unknown as ReturnType<typeof vi.fn>;
    const texts = fillText.mock.calls.map((call) => call[0]);
    expect(texts).toContain('Alpha Synthetic');
    expect(texts).toContain(TODAY);
    expect(texts).toContain(
      'Signed for: participation, visits at home, brain-map and neurofeedback information',
    );

    // Beneath the name and the date, in a smaller face: this line names what
    // was agreed to, and must never read as a second signature.
    const captionIndex = texts.indexOf(
      'Signed for: participation, visits at home, brain-map and neurofeedback information',
    );
    const nameIndex = texts.indexOf('Alpha Synthetic');
    const dateIndex = texts.indexOf(TODAY);
    expect(captionIndex).toBeGreaterThan(nameIndex);
    expect(captionIndex).toBeGreaterThan(dateIndex);
    const captionFontSize = parseInt(fontAtCall[captionIndex] ?? '', 10);
    const nameFontSize = parseInt(fontAtCall[nameIndex] ?? '', 10);
    expect(captionFontSize).toBeLessThan(nameFontSize);
  });

  it('renders exactly as before when no caption is given', () => {
    const onChange = vi.fn();
    const context = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);

    const { container } = render(
      <SignaturePad
        signedName="Alpha Synthetic"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        today={TODAY}
      />,
    );
    sign(container.querySelector('canvas') as Element);

    const fillText = context.fillText as unknown as ReturnType<typeof vi.fn>;
    // Only the name and the date: no absent-caption blank line, no shifted
    // band, nothing new in the image's shape.
    expect(fillText.mock.calls.map((call) => call[0])).toEqual(['Alpha Synthetic', TODAY]);
  });

  it('does not draw while it is disabled', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SignaturePad
        signedName="Iris Harbour"
        onSignedNameChange={vi.fn()}
        onChange={onChange}
        disabled
        today={TODAY}
      />,
    );
    sign(container.querySelector('canvas') as Element);
    expect(onChange).not.toHaveBeenCalled();
  });
});
