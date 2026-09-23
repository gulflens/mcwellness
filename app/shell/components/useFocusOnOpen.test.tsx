// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusOnOpen } from './useFocusOnOpen';

// This suite carries vitest's own matchers and not jest-dom's (see
// app/shell/components/DateField.test.tsx), so focus is read off
// `document.activeElement` rather than asserted on with `toHaveFocus`, and a
// value is read off the input rather than asserted on with `toHaveValue`.
// Renders are also not auto-cleaned between tests here, so each one is torn
// down explicitly.
afterEach(cleanup);

function Panel() {
  const heading = useFocusOnOpen<HTMLHeadingElement>();
  const [text, setText] = useState('');
  return (
    <section>
      <h3 ref={heading} tabIndex={-1}>
        Section
      </h3>
      <label>
        Name
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
    </section>
  );
}

describe('useFocusOnOpen', () => {
  it('focuses the element once when the panel appears', () => {
    render(<Panel />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Section' }));
  });

  it('does not take focus back after a re-render', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    // Typed key by key, not set with `fireEvent.change`, so each keystroke
    // re-renders the panel the way a person typing their name would — the
    // exact re-render an inline `ref={(node) => node?.focus()}` callback used
    // to answer by moving focus back to the heading (round 63).
    await user.type(input, 'ab');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('ab');
  });
});
