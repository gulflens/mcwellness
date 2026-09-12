// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneField } from './PhoneField';

// This suite carries vitest's own matchers and not jest-dom's (see
// DateField.test.tsx), so a value is read off the element rather than
// asserted on with toHaveValue. Renders are also not auto-cleaned between
// tests here, so each one is torn down explicitly.
afterEach(cleanup);

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneField
      id="p"
      label="Phone"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('PhoneField', () => {
  it('defaults to the UAE', () => {
    render(<Harness />);
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('+971');
  });

  it('builds E.164 and drops the locally written leading zero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Phone'), '0500001234');
    expect(onChange).toHaveBeenLastCalledWith('+971500001234');
  });

  it('splits a stored number back into its two halves', () => {
    render(<Harness initial="+971500001234" />);
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('+971');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('500001234');
  });

  it('rebuilds the value when the country changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="+971500001234" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText(/country/i), '+966');
    expect(onChange).toHaveBeenLastCalledWith('+966500001234');
  });

  it('emits an empty string when the number is cleared, so optional stays optional', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="+971500001234" onChange={onChange} />);
    await user.clear(screen.getByLabelText('Phone'));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  // The guard on ruling 1: the GCC allow-list must never reach past its own
  // members. A country outside it (the UK, here) keeps a typed leading zero
  // untouched — stripping it for every country would silently turn a real
  // number into a different, still-valid one.
  it('does not strip a typed leading zero for a country outside the allow-list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText(/country/i), '+44');
    await user.type(screen.getByLabelText('Phone'), '0207946000');
    expect(onChange).toHaveBeenLastCalledWith('+440207946000');
  });
});
