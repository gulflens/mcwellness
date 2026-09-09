import { PASSWORD_PROBLEM_SENTENCES } from '@domain/shared';
import { PasswordForm, type PasswordWords } from '../components/PasswordForm';

/**
 * A new password for whoever is signed in to the console or the phone (trunk
 * round 40, 2026-09-10). A colleague arrives with a temporary password shown
 * once on Settings › Team; this is where they replace it. The form itself is
 * the shared `PasswordForm` (trunk round 41), worn here in the console's
 * English; a household changes theirs on the portal's own screen, in their
 * own language (app/client/PasswordScreen.tsx).
 */
const WORDS: PasswordWords = {
  current: 'Current password',
  next: 'New password',
  again: 'The same again',
  hint: 'At least twelve characters.',
  currentFirst: 'Your current password first.',
  mismatch: 'The two do not match.',
  noPassword: 'This sign-in has no password to change.',
  failed: 'The password could not be changed.',
  done: 'Changed. Use the new one from your next sign-in.',
  submit: 'Change password',
  back: 'Back',
  problem: (key) => PASSWORD_PROBLEM_SENTENCES[key],
  // The provider holds one English sentence per reason, and the console
  // reads it as written.
  refused: (_reason, sentence) => sentence,
};

export function PasswordPage() {
  return (
    <main className="plain">
      <h1>Change your password</h1>
      <PasswordForm words={WORDS} classes={{ form: 'signin__form', actions: 'team__actions' }} />
    </main>
  );
}
