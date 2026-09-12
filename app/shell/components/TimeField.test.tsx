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

  it('never shows a meridiem', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Start'), '1430');
    expect(screen.queryByText(/AM|PM/i)).toBe(null);
  });
});
