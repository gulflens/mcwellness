// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Confirmation, type Outcome } from './Confirmation';

afterEach(cleanup);

describe('Confirmation', () => {
  it('names the outcome as a heading, shows the figure, and takes the focus', () => {
    const outcome: Outcome = {
      title: 'Payment recorded',
      figure: 'AED 700.00',
      figureLabel: 'Received',
    };
    render(
      <Confirmation outcome={outcome}>
        <p>AED 700.00 recorded.</p>
      </Confirmation>,
    );
    const heading = screen.getByRole('heading', { name: 'Payment recorded' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('AED 700.00')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Payment recorded' })).toBeTruthy();
  });

  it('takes the focus again for a new outcome with the same words, and not on a re-render', () => {
    const first: Outcome = { title: 'Payment recorded' };
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <Confirmation outcome={first} />
      </>,
    );
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <Confirmation outcome={first} />
      </>,
    );
    expect(document.activeElement).toBe(elsewhere);
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <Confirmation outcome={{ title: 'Payment recorded' }} />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Payment recorded' }));
  });

  it('is not a live region, so the outcome is read once, by the focus', () => {
    render(<Confirmation outcome={{ title: 'Consent recorded' }} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
