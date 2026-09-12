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
    // The select is keyed and valued by ISO code (Fix round 1, finding 1) —
    // not by dialling code, which several countries share — so the assertion
    // reads the ISO the UAE resolves to, not '+971' itself.
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('AE');
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
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('AE');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('500001234');
  });

  it('rebuilds the value when the country changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="+971500001234" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText(/country/i), 'SA');
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
    await user.selectOptions(screen.getByLabelText(/country/i), 'GB');
    await user.type(screen.getByLabelText('Phone'), '0207946000');
    expect(onChange).toHaveBeenLastCalledWith('+440207946000');
  });

  // Fix round 1, finding 1: the select used to be keyed and valued by
  // dialling code, and a controlled `<select>` resolves a duplicate value to
  // the first matching option in document order (table order) — so a stored
  // `+44` number displayed Guernsey, and choosing "United Kingdom" snapped
  // straight back to it once the list closed. Four ISOs share `+44`
  // (GB, GG, IM, JE); this pins that the UK's own row is what shows.
  it('shows the intended country for a dialling code several countries share', () => {
    render(<Harness initial="+447700900123" />);
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('GB');
  });

  // Fix round 1, finding 3: the same three resync-guard regressions
  // DateField carries, pinning the exact bug shape that cost that control two
  // fix rounds — a caller-driven value change must redraw, a mid-edit
  // backspace must not wipe what's typed, and a genuine reset must clear
  // both halves even though nothing here can literally read `null` as `''`.
  it('redraws both halves when the value prop changes underneath it', () => {
    const { rerender } = render(
      <PhoneField id="p" label="Phone" value="" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('');
    rerender(<PhoneField id="p" label="Phone" value="+971500001234" onChange={() => undefined} />);
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('AE');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('500001234');
  });

  it('keeps the partial text after a backspace off a complete number', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Phone') as HTMLInputElement;
    await user.type(box, '0500001234');
    expect(box.value).toBe('0500001234');
    await user.type(box, '{Backspace}');
    expect(box.value).toBe('050000123');
  });

  it('clears both halves on a genuine reset', () => {
    const { rerender } = render(
      <PhoneField id="p" label="Phone" value="+971500001234" onChange={() => undefined} />,
    );
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('500001234');
    rerender(<PhoneField id="p" label="Phone" value="" onChange={() => undefined} />);
    expect((screen.getByLabelText(/country/i) as HTMLSelectElement).value).toBe('AE');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('');
  });

  // Fix round 1, finding 4: `typed` is stored unstripped for exactly this
  // reason — the trunk zero must survive a country switch mid-edit, stripped
  // only for the newly selected country, not baked into the box's own text.
  // `+390612345678` is the module's own standing Italian example
  // (domain/shared/phone.ts / phone.test.ts) — Italy is outside the GCC
  // allow-list, so its trunk zero is never stripped.
  it('keeps a typed leading zero across a country switch, judged by the new selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText(/country/i), 'AE');
    await user.type(screen.getByLabelText('Phone'), '0612345678');
    await user.selectOptions(screen.getByLabelText(/country/i), 'IT');
    expect(onChange).toHaveBeenLastCalledWith('+390612345678');
  });
});
