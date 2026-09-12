// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeField } from './TimeField';

// This suite carries vitest's own matchers and not jest-dom's (see
// tests/accounting/BooksPage.test.tsx), so a value is read off the input
// rather than asserted on with toHaveValue. Renders are also not
// auto-cleaned between tests here, so each one is torn down explicitly.
afterEach(cleanup);

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <TimeField
      id="t"
      label="Start"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('TimeField', () => {
  it('draws the colon as the digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Start') as HTMLInputElement;
    await user.type(box, '1430');
    expect(box.value).toBe('14:30');
  });

  it('emits a complete twenty-four hour time and nothing before it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Start'), '1430');
    expect(onChange).toHaveBeenLastCalledWith('14:30');
  });

  it('refuses an hour the clock does not have', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Start'), '2500');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  // Finding 5: jsdom never renders an AM/PM string regardless of what the
  // control does, so the original assertion could not fail. What is
  // actually worth guarding is that the rendered box is never a native
  // `<input type="time">`, which is the element that would show a locale
  // meridiem.
  it('never renders a native time input', () => {
    render(<Harness />);
    const box = screen.getByLabelText('Start') as HTMLInputElement;
    expect(box.type).not.toBe('time');
  });

  // Finding 2(a): nothing above ever rerenders a mounted TimeField with a
  // changed `value` prop.
  it('redraws the typed form when the value prop changes underneath it', () => {
    const { rerender } = render(
      <TimeField id="t" label="Start" value="" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('');
    rerender(<TimeField id="t" label="Start" value="14:30" onChange={() => undefined} />);
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('14:30');
  });

  // Finding 2(b): the resync guard used to compare `typed` (still the
  // partial string `'14:3'`) against `value` (emptied to `''` by `take`)
  // and, reading those as different, blanked the box on a single Backspace
  // after a complete time.
  it('keeps the partial text after a backspace off a complete time', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Start') as HTMLInputElement;
    await user.type(box, '1430');
    expect(box.value).toBe('14:30');
    await user.type(box, '{Backspace}');
    expect(box.value).toBe('14:3');
  });
});
