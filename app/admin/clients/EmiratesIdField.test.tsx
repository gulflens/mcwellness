// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmiratesIdField } from './EmiratesIdField';

// This suite carries vitest's own matchers and not jest-dom's (see
// tests/accounting/BooksPage.test.tsx), so a value is read off the input
// rather than asserted on with toHaveValue.
afterEach(cleanup);

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <EmiratesIdField
      id="e"
      label="Emirates ID"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('EmiratesIdField', () => {
  it('groups a full run of digits as it is typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Emirates ID') as HTMLInputElement;
    await user.type(box, '784190000000017');
    expect(box.value).toBe('784-1900-0000001-7');
  });

  it('places dashes progressively rather than all at once', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Emirates ID') as HTMLInputElement;
    await user.type(box, '7841');
    expect(box.value).toBe('784-1');
    await user.type(box, '900');
    expect(box.value).toBe('784-1900');
  });

  it('never throws on a partial run', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Emirates ID') as HTMLInputElement;
    await expect(user.type(box, '7')).resolves.toBeUndefined();
    expect(box.value).toBe('7');
  });

  it('clearing the box emits an empty string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByLabelText('Emirates ID') as HTMLInputElement;
    await user.type(box, '784');
    await user.clear(box);
    expect(box.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('redraws the typed text when the value prop changes underneath it', () => {
    const { rerender } = render(
      <EmiratesIdField id="e" label="Emirates ID" value="" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Emirates ID') as HTMLInputElement).value).toBe('');
    rerender(
      <EmiratesIdField
        id="e"
        label="Emirates ID"
        value="784-1900-0000001-7"
        onChange={() => undefined}
      />,
    );
    expect((screen.getByLabelText('Emirates ID') as HTMLInputElement).value).toBe(
      '784-1900-0000001-7',
    );
  });

  // The regression DateField shipped once: a resync guard that compares two
  // different representations of "nothing typed yet" can read a mid-edit
  // Backspace as a real external change and wipe the box. This control's
  // `typed` and `value` are always the same grouped string, so there is no
  // second representation to disagree — this is the guard against it.
  it('keeps the partial text after a backspace off a complete run', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Emirates ID') as HTMLInputElement;
    await user.type(box, '784190000000017');
    expect(box.value).toBe('784-1900-0000001-7');
    await user.type(box, '{Backspace}');
    expect(box.value).toBe('784-1900-0000001');
  });

  it('clears the box on a genuine reset', () => {
    const { rerender } = render(
      <EmiratesIdField
        id="e"
        label="Emirates ID"
        value="784-1900-0000001-7"
        onChange={() => undefined}
      />,
    );
    expect((screen.getByLabelText('Emirates ID') as HTMLInputElement).value).toBe(
      '784-1900-0000001-7',
    );
    rerender(<EmiratesIdField id="e" label="Emirates ID" value="" onChange={() => undefined} />);
    expect((screen.getByLabelText('Emirates ID') as HTMLInputElement).value).toBe('');
  });

  it('sets a numeric input mode and the grouped example as placeholder', () => {
    render(<EmiratesIdField id="e" label="Emirates ID" value="" onChange={() => undefined} />);
    const box = screen.getByLabelText('Emirates ID') as HTMLInputElement;
    expect(box.getAttribute('inputmode')).toBe('numeric');
    expect(box.placeholder).toBe('784-1900-1234567-1');
  });
});
