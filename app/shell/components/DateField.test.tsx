// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from './DateField';

// This suite carries vitest's own matchers and not jest-dom's (see
// tests/accounting/BooksPage.test.tsx), so a value is read off the input
// rather than asserted on with toHaveValue. Renders are also not
// auto-cleaned between tests here, so each one is torn down explicitly.
// The prototype patch a showPicker test installs is torn down here too,
// rather than only at the end of the test body: a failed assertion above
// that line would otherwise leak the mock into every test that runs after.
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
});

function Harness({
  onChange,
  min,
  max,
}: {
  onChange?: (v: string) => void;
  min?: string;
  max?: string;
}) {
  const [value, setValue] = useState('');
  return (
    <DateField
      id="d"
      label="Date of birth"
      value={value}
      min={min}
      max={max}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('DateField', () => {
  it('draws the slashes as the digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Date of birth') as HTMLInputElement;
    await user.type(box, '12091988');
    expect(box.value).toBe('12/09/1988');
  });

  it('emits the stored ISO form only once the date is complete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Date of birth'), '12091988');
    expect(onChange).toHaveBeenLastCalledWith('1988-09-12');
    expect(onChange).not.toHaveBeenCalledWith('1988-09-1');
  });

  it('refuses an impossible date and emits nothing for it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Date of birth'), '31022026');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('shows a stored value in the typed form', () => {
    render(
      <DateField id="d" label="Date of birth" value="1988-09-12" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('12/09/1988');
  });

  // Finding 2(a): nothing above ever rerenders a mounted DateField with a
  // changed `value` prop — every harness starts at '' and only ever moves
  // forward from what the user typed. A record loading into an already
  // mounted field is a real path (an enrolment wizard's date-of-birth step
  // arriving after its record fetch resolves) and needs its own coverage.
  it('redraws the typed form when the value prop changes underneath it', () => {
    const { rerender } = render(
      <DateField id="d" label="Date of birth" value="" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('');
    rerender(
      <DateField id="d" label="Date of birth" value="1988-09-12" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Date of birth') as HTMLInputElement).value).toBe('12/09/1988');
  });

  // Finding 2(b): the resync guard used to compare `isoFromDisplay(typed)`
  // (which is `null` for an incomplete date) against `value` (which is `''`
  // once `take` empties it), read those as different, and blanked the whole
  // box — an eight-digit date lost to one Backspace. Typing the full date,
  // deleting one digit, and expecting the partial text to survive is the
  // regression guard for that.
  it('keeps the partial text after a backspace off a complete date', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Date of birth') as HTMLInputElement;
    await user.type(box, '12091988');
    expect(box.value).toBe('12/09/1988');
    await user.type(box, '{Backspace}');
    expect(box.value).toBe('12/09/198');
  });

  // Finding 4: `min`/`max` only ever reached the hidden native input, so a
  // date typed directly into the text box could sit outside the bound the
  // caller asked for and still be emitted.
  it('refuses a complete date that falls after max', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} max="2020-01-01" />);
    await user.type(screen.getByLabelText('Date of birth'), '01012025');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('opens the native picker when the calendar button is pressed', async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    // jsdom implements no showPicker; the control must tolerate both worlds.
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /calendar/i }));
    expect(showPicker).toHaveBeenCalled();
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
  });

  // Finding 3: a real browser's showPicker() can throw (SecurityError with
  // no user activation, NotAllowedError in a cross-origin frame). The press
  // must still land on the same focus() fallback rather than propagate.
  it('falls back to focusing the hidden input where showPicker throws', async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn(() => {
      throw new DOMException('No user activation.', 'NotAllowedError');
    });
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    const { container } = render(<Harness />);
    const native = container.querySelector('input[type="date"]');
    await user.click(screen.getByRole('button', { name: /calendar/i }));
    expect(showPicker).toHaveBeenCalled();
    expect(document.activeElement).toBe(native);
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
  });

  // Finding 5: the previous version of this test only asserted that the
  // click's promise resolved, which passes whether or not focus ever moves —
  // it could not fail. The hidden native input (aria-hidden, so it is
  // outside `getByRole`'s tree) is read directly off the container instead.
  it('falls back to focusing the hidden input where showPicker is absent', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const native = container.querySelector('input[type="date"]');
    await user.click(screen.getByRole('button', { name: /calendar/i }));
    expect(document.activeElement).toBe(native);
  });
});
