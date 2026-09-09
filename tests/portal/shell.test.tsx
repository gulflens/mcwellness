// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeScreen } from '../../app/client/HomeScreen';
import { HOME } from './fixtures';
import { forgetLanguage, json, mountPortal } from './harness';

/**
 * The shell around every portal screen (docs/SPEC/portal-app-shell.md).
 *
 * It became an application shell on 8 September 2026, replacing a header of
 * two wrapping rows that on a 390px screen broke onto four lines and spent
 * most of the first view before a household saw anything of their own record.
 * These tests are about the shell itself; `screens.test.tsx` covers what the
 * screens put inside it.
 */
const answers = { '/api/portal/home': () => json(HOME) };

/**
 * jsdom opens at 1024, which is the tablet tier: there the sidebar is a column
 * beside the page and covers nothing, so none of the covering behaviour
 * applies. A test about a phone has to say so.
 */
function onAPhone(): void {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

afterEach(() => {
  cleanup();
  forgetLanguage();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
});

describe('the portal shell', () => {
  it('lists every screen in the sidebar, not in a wrapping row', async () => {
    mountPortal(<HomeScreen />, { answers });
    await waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
    const sidebar = screen.getByRole('navigation');
    const inTheSidebar = [...sidebar.querySelectorAll('a')].map((link) => link.textContent);
    expect(inTheSidebar).toEqual(['Home', 'Visits', 'Money', 'Reports', 'Family', 'Agreements']);
    // And nowhere else: the row across the top is gone, not merely restyled.
    expect(document.querySelector('.portal__nav')).toBeNull();
  });

  it('keeps who you are, your language and the way out inside the sidebar', async () => {
    // These three are what used to wrap across the top. Holding them in the
    // sidebar's foot is what removes the wrapping by construction rather than
    // by tuning a width.
    mountPortal(<HomeScreen />, { answers });
    await waitFor(() => expect(screen.getByRole('navigation')).toBeTruthy());
    const foot = document.querySelector('.portal__foot');
    expect(foot).toBeTruthy();
    expect(foot?.querySelector('.portal__languages')).toBeTruthy();
    expect(foot?.textContent).toContain('Sign out');
  });

  it('offers a way to open the menu, and says whether it is open', async () => {
    mountPortal(<HomeScreen />, { answers });
    const menu = await screen.findByRole('button', { name: 'Menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes behind you when a screen is chosen', async () => {
    mountPortal(<HomeScreen />, { answers });
    const menu = await screen.findByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Visits' }));
    // One press goes and clears the view, rather than leaving the record
    // hidden behind a menu the person must then close themselves.
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape while it is covering the record', async () => {
    mountPortal(<HomeScreen />, { answers });
    const menu = await screen.findByRole('button', { name: 'Menu' });
    onAPhone();
    fireEvent.click(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(menu.getAttribute('aria-expanded')).toBe('false'));
  });

  it('takes the parked sidebar out of the tab order, and puts it back', async () => {
    // `inert` rather than `visibility: hidden`: a hidden element cannot take
    // focus, so the focus call on opening landed on nothing and the person was
    // left on the body. Found by driving the real browser on 9 September 2026;
    // jsdom does not reject focus on hidden elements, so only this assertion
    // keeps it fixed.
    mountPortal(<HomeScreen />, { answers });
    await screen.findByRole('button', { name: 'Menu' });
    const rail = document.querySelector('.portal__rail');
    // A tablet: the sidebar is a column and is never parked.
    expect(rail?.hasAttribute('inert')).toBe(false);
    onAPhone();
    expect(rail?.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(rail?.hasAttribute('inert')).toBe(false);
  });

  it('never parks the sidebar or covers the page above the compact tier', () => {
    mountPortal(<HomeScreen />, { answers });
    const rail = document.querySelector('.portal__rail');
    expect(rail?.hasAttribute('inert')).toBe(false);
    // No scrim at this width, whatever the menu button says.
    expect(document.querySelector('.portal__scrim')).toBeNull();
  });

  it('names the menu in Arabic too, and mirrors the layout', async () => {
    mountPortal(<HomeScreen />, { answers, locale: 'ar' });
    const menu = await screen.findByRole('button', { name: 'القائمة' });
    expect(menu).toBeTruthy();
    expect(document.querySelector('.portal')?.getAttribute('dir')).toBe('rtl');
  });
});
