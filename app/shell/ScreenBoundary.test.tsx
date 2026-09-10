// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenBoundary } from './ScreenBoundary';

/**
 * The net under a screen that never arrives.
 *
 * Since the screens are fetched one at a time (`app/shell/App.tsx`), a person
 * with the app open across a deploy can ask for a screen whose file the
 * server has already replaced. Before that change every tab held the whole
 * app it started with and this could not happen; now it can, and without this
 * the whole page would go blank with no way back (the review of pull request
 * 152, finding 4).
 */

afterEach(cleanup);

function Boom(): never {
  throw new Error('Failed to fetch dynamically imported module');
}

describe('ScreenBoundary', () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React writes the caught error to the console itself; the test's own
    // output stays clean without hiding a real failure, since the assertions
    // below are what decide the case.
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('shows what happened and the way out when a screen cannot be fetched', () => {
    render(
      <ScreenBoundary>
        <Boom />
      </ScreenBoundary>,
    );
    expect(screen.getByText('This screen could not be loaded.')).toBeTruthy();
    expect(
      screen.getByText('It usually means the app has been updated. Reload to get the new version.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('reloads the page when asked, which is what fetches the new version', () => {
    const reload = vi.fn();
    render(
      <ScreenBoundary reload={reload}>
        <Boom />
      </ScreenBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way when the screen arrives', () => {
    render(
      <ScreenBoundary>
        <p>The client list</p>
      </ScreenBoundary>,
    );
    expect(screen.getByText('The client list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});
