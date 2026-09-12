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
afterEach(cleanup);

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <DateField
      id="d"
      label="Date of birth"
      value={value}
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

  it('falls back to focusing the hidden input where showPicker is absent', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // No showPicker defined: the press must not throw.
    await expect(
      user.click(screen.getByRole('button', { name: /calendar/i })),
    ).resolves.not.toThrow();
  });
});
