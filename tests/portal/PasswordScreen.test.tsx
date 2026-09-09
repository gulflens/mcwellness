// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordScreen } from '../../app/client/PasswordScreen';
import { PasswordChangeError } from '../../app/shell/auth/types';
import { HOME } from './fixtures';
import { forgetLanguage, json, mountPortal } from './harness';

/**
 * A household changes their password in their own language (trunk round 41,
 * 2026-09-10; docs/SPEC/client-portal.md section 3.9). The form is the
 * shell's one `PasswordForm`; what is under test here is that every word of
 * it comes from the portal's dictionary — the console's page proves the
 * mechanics in English (app/shell/pages/PasswordPage.test.tsx).
 */
const answers = {
  '/api/portal/home': () => json(HOME),
  '/api/me/password-changed': () => json({ ok: true }),
};

afterEach(() => {
  cleanup();
  forgetLanguage();
});

/** A provider that can change a password, as the Supabase one can. */
function canChange(updatePassword: (next: string, current: string) => Promise<void>) {
  return { kind: 'supabase' as const, currentEmail: async () => 'hazel@example.com', updatePassword };
}

const fill = (a: string, b: string, current = 'the old one, still right') => {
  fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'), { target: { value: a } });
  fireEvent.change(screen.getByLabelText('أعدها مرة أخرى'), { target: { value: b } });
  fireEvent.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }));
};

describe('the password screen, in Arabic', () => {
  it('refuses a short password and a mismatched pair in Arabic, before asking the provider', async () => {
    const update = vi.fn(async () => undefined);
    mountPortal(<PasswordScreen />, { answers, locale: 'ar', provider: canChange(update) });
    await screen.findByLabelText('كلمة المرور الجديدة');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('كلمة مرورك');
    fill('short', 'short');
    expect(await screen.findByText('قصيرة جدًا: اثنا عشر حرفًا على الأقل.')).toBeTruthy();
    fill('correct horse battery', 'correct horse battery staple');
    expect(await screen.findByText('الكلمتان غير متطابقتين.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('changes it through the provider with the current one as proof, records the act, and says so in Arabic', async () => {
    const update = vi.fn(async () => undefined);
    const { calls } = mountPortal(<PasswordScreen />, {
      answers,
      locale: 'ar',
      provider: canChange(update),
    });
    await screen.findByLabelText('كلمة المرور الجديدة');
    fill('correct horse battery staple', 'correct horse battery staple');
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('correct horse battery staple', 'the old one, still right'),
    );
    expect(
      await screen.findByText('تم التغيير. استخدم الجديدة من تسجيل دخولك القادم.'),
    ).toBeTruthy();
    expect(
      calls.some((call) => call.path === '/api/me/password-changed' && call.init?.method === 'POST'),
    ).toBe(true);
  });

  it("names the provider's refusal in Arabic, never in the provider's English", async () => {
    const update = vi.fn(async () => {
      throw new PasswordChangeError('current', 'The current password is not right.');
    });
    mountPortal(<PasswordScreen />, { answers, locale: 'ar', provider: canChange(update) });
    await screen.findByLabelText('كلمة المرور الجديدة');
    fill('correct horse battery staple', 'correct horse battery staple');
    expect(await screen.findByText('كلمة المرور الحالية غير صحيحة.')).toBeTruthy();
    expect(screen.queryByText('The current password is not right.')).toBeNull();
  });

  it('asks for the current password first', async () => {
    const update = vi.fn(async () => undefined);
    mountPortal(<PasswordScreen />, { answers, locale: 'ar', provider: canChange(update) });
    await screen.findByLabelText('كلمة المرور الجديدة');
    fill('correct horse battery staple', 'correct horse battery staple', '');
    expect(await screen.findByText('أدخل كلمة المرور الحالية أولًا.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('says so when the sign-in has no password to change', async () => {
    // The development door: no provider method, so the page says so rather
    // than pretending, in the person's language.
    mountPortal(<PasswordScreen />, { answers, locale: 'ar' });
    await screen.findByLabelText('كلمة المرور الجديدة');
    fill('correct horse battery staple', 'correct horse battery staple');
    expect(
      await screen.findByText('لا توجد كلمة مرور لتغييرها في طريقة الدخول هذه.'),
    ).toBeTruthy();
  });

  it('reads in English for a household that chose it', async () => {
    mountPortal(<PasswordScreen />, { answers, locale: 'en' });
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Your password');
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });
});
