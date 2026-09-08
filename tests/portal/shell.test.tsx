// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
  forgetLanguage();
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
    fireEvent.click(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(menu.getAttribute('aria-expanded')).toBe('false'));
  });

  it('names the menu in Arabic too, and mirrors the layout', async () => {
    mountPortal(<HomeScreen />, { answers, locale: 'ar' });
    const menu = await screen.findByRole('button', { name: 'القائمة' });
    expect(menu).toBeTruthy();
    expect(document.querySelector('.portal')?.getAttribute('dir')).toBe('rtl');
  });
});
