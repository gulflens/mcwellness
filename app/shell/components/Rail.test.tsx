// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as freshBuild from '../freshBuild';
import { resetFreshBuildForTests, watchForNewBuild } from '../freshBuild';
import { Rail } from './Rail';

afterEach(() => {
  cleanup();
  resetFreshBuildForTests();
});

describe('Rail', () => {
  it('links every section, lists none as arriving, and signs out', () => {
    const onSignOut = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={onSignOut}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/clients'),
    );
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/schedule'),
    );
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
    expect(screen.getByRole('link', { name: 'Books' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/books'),
    );
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/audit'),
    );
    // Every section is a real destination: the last placeholder, Sessions,
    // went in trunk round 41 (2026-09-10) rather than standing as a dead entry.
    expect(screen.queryByText('Arriving')).toBeNull();
    expect(screen.queryByText('Sessions')).toBeNull();
    for (const item of document.querySelectorAll('.rail__item')) {
      expect(item.tagName).toBe('A');
      expect(item.getAttribute('aria-disabled')).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('offers a control that says whether the sections are shown', () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={onToggle}
        />
      </MemoryRouter>,
    );
    const control = screen.getByRole('button', { name: 'Sections' });
    expect(control.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(control);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps every section reachable by name when it is closed', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open={false}
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Sections' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.getByRole('link', { name: 'Clients' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Billing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it("shows the practice's mark without announcing it a second time", () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    const logo = document.querySelector('.rail__logo');
    expect(logo?.getAttribute('src')).toBe('/brand/mark.png');
    // The name is in text beside it, so the image is decorative and silent.
    expect(logo?.getAttribute('alt')).toBe('');
    expect(screen.getByText('McWellness')).toBeTruthy();
  });

  it('offers no pin on a desk, where the rail is already a column', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Keep sections open' })).toBeNull();
  });

  it('hides the pin on the strip, where there is room for one control', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open={false}
          onToggle={vi.fn()}
          onTogglePin={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Keep sections open' })).toBeNull();
  });

  it('says whether it is pinned, and offers to change it', () => {
    const onTogglePin = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
          pinned
          onTogglePin={onTogglePin}
        />
      </MemoryRouter>,
    );
    const pin = screen.getByRole('button', { name: 'Keep sections open' });
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pin);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('tells the layout when a section is chosen, so it may put itself away', () => {
    const onChoose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
          onChoose={onChoose}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Billing' }));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('moves within the app while the window runs the build the site serves', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    // `fireEvent` answers false when something called preventDefault: the
    // router took the click and the browser loads nothing.
    expect(fireEvent.click(screen.getByRole('link', { name: 'Billing' }))).toBe(false);
  });

  it('leaves the click to the browser once a newer build is live, so the document loads afresh', async () => {
    const newer =
      '<html><head><script type="module" crossorigin src="/assets/index-NEW.js"></script></head></html>';
    const watch = watchForNewBuild({
      running: 'index-OLD.js',
      fetchImpl: vi.fn(async () => new Response(newer)),
      now: () => 0,
    });
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    await act(async () => {
      await watch.check();
    });
    // Not prevented: an ordinary link, and an ordinary page load behind it.
    expect(fireEvent.click(screen.getByRole('link', { name: 'Billing' }))).toBe(true);
    expect(fireEvent.click(screen.getByRole('link', { name: 'Password' }))).toBe(true);
    // Still a link to the same place: nothing about where it goes has changed.
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
  });

  it('reloads for a row of the page you are already on, where a link alone would only move within it', async () => {
    const reloadAt = vi.spyOn(freshBuild, 'reloadAt').mockImplementation(() => undefined);
    const newer =
      '<html><head><script type="module" crossorigin src="/assets/index-NEW.js"></script></head></html>';
    const watch = watchForNewBuild({
      running: 'index-OLD.js',
      fetchImpl: vi.fn(async () => new Response(newer)),
      now: () => 0,
    });
    render(
      <MemoryRouter initialEntries={['/admin/billing']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Same build: a move within the page, which the page itself follows.
    fireEvent.click(screen.getByRole('link', { name: 'Packages' }));
    expect(reloadAt).not.toHaveBeenCalled();

    await act(async () => {
      await watch.check();
    });
    // `/admin/billing#invoices` from `/admin/billing` is a fragment move, and a
    // fragment move loads nothing however ordinary the link is.
    fireEvent.click(screen.getByRole('link', { name: 'Invoices' }));
    expect(reloadAt).toHaveBeenCalledWith('/admin/billing#invoices');
    reloadAt.mockRestore();
  });

  it('closes on Escape while it is covering the page', () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={onToggle}
          covering
        />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape alone when it is a column beside the page', () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={onToggle}
        />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps the mark on the strip, where it is the only thing naming the place', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open={false}
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(document.querySelector('.rail__logo')).toBeTruthy();
  });

  it('lists the pages of the section you are on, and of no other', () => {
    // The operator's instruction of 2026-09-12: the submenu expands under the
    // section you choose. It is the address that decides, so nothing is
    // remembered and the rail cannot disagree with the page beside it.
    render(
      <MemoryRouter initialEntries={['/admin/billing']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Prices' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing#prices'),
    );
    expect(screen.getByRole('link', { name: 'Receipts' })).toBeTruthy();
    // Schedule's own pages belong to Schedule, and it is not the section open.
    expect(screen.queryByRole('link', { name: 'Week' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Day map' })).toBeNull();
  });

  it('marks the page the address names, and the first when it names none', () => {
    render(
      <MemoryRouter initialEntries={['/admin/billing#invoices']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Prices' }).getAttribute('aria-current')).toBeNull();
    cleanup();
    // No hash: BillingPage opens on its first section, so the rail says so too
    // rather than marking nothing at all.
    render(
      <MemoryRouter initialEntries={['/admin/billing']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Prices' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps the day from being marked on the week, and leaves the map an anchor', () => {
    render(
      <MemoryRouter initialEntries={['/admin/schedule/week']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Week' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Day' }).getAttribute('aria-current')).toBeNull();
    // The map is served as its own document with the wider policy a browser
    // map needs, so it is a plain anchor: a client-side navigation would carry
    // this screen's stricter policy into it.
    const map = screen.getByRole('link', { name: 'Day map' });
    expect(map.getAttribute('href')).toBe('/admin/schedule/map');
    expect(map.getAttribute('aria-current')).toBeNull();
  });

  it('tells the layout when a page is chosen, so a covering rail puts itself away', () => {
    const onChoose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/billing']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
          onChoose={onChoose}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Receipts' }));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("brings a section's pages into view when they open, where the browser can", () => {
    // With a section open the rail can be taller than the window, so the pages
    // that just appeared may be below the fold (the operator, 2026-09-12).
    // jsdom implements no scrolling at all, so the call is stubbed here and
    // made optional in the component — a gap in the test environment rather
    // than anything a browser lacks.
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    render(
      <MemoryRouter initialEntries={['/admin/billing#receipts']}>
        <Rail
          person={{ name: 'Owner', roles: 'Owner' }}
          onSignOut={vi.fn()}
          open
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    try {
      // `nearest`: move the least that will do, so a rail with room does not jump.
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      // Even when the assertion fails: a stub left on the prototype would
      // follow every later test in this worker.
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
