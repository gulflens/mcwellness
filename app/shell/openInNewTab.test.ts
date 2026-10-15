// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInNewTab } from './openInNewTab';

/**
 * Opening a page in a new tab and knowing whether it opened
 * (docs/CHANGE-REQUESTS/docfix-02.md).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A browser as the HTML standard has it: "noopener" makes window.open answer null, opened or not. */
function standardBrowser(tab: Window | null) {
  return vi.fn((_url?: string | URL, _target?: string, features?: string) =>
    features?.includes('noopener') ? null : tab,
  );
}

describe('openInNewTab', () => {
  it('answers true when the tab opened, and cuts the tab off from the console', () => {
    const tab = { opener: {} } as unknown as Window;
    const open = standardBrowser(tab);
    vi.stubGlobal('open', open);
    expect(openInNewTab('https://example.com/file')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/file', '_blank');
    expect(tab.opener).toBeNull();
  });

  it('answers false when the browser blocked the tab', () => {
    vi.stubGlobal('open', standardBrowser(null));
    expect(openInNewTab('https://example.com/file')).toBe(false);
  });
});
