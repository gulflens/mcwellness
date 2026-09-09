import type { PasswordProblemKey } from '@domain/shared';
import type { PasswordChangeReason } from '../shell/auth/types';
import { PasswordForm, type PasswordWords } from '../shell/components/PasswordForm';
import { useWords, type WordKey } from './i18n';

/**
 * A household changes their password in their own language (trunk round 41,
 * 2026-09-10; docs/SPEC/client-portal.md section 3.9). The form is the
 * shell's one `PasswordForm`, the same the console wears in English; every
 * word here comes from the dictionary, the rule's four sentences by key. A
 * session that has gone signs the person out inside the form, so `session`
 * never reaches the refusal table; `unknown` reads as the general failure.
 */
const PROBLEM: Record<PasswordProblemKey, WordKey> = {
  short: 'passwordShort',
  long: 'passwordLong',
  variety: 'passwordVariety',
  edges: 'passwordEdges',
};

const REFUSED: Record<PasswordChangeReason, WordKey> = {
  weak: 'passwordWeak',
  same: 'passwordSame',
  current: 'passwordCurrentWrong',
  session: 'passwordFailed',
  unknown: 'passwordFailed',
};

export function PasswordScreen() {
  const words = useWords();
  const passwordWords: PasswordWords = {
    current: words.t('passwordCurrent'),
    next: words.t('passwordNew'),
    again: words.t('passwordAgain'),
    hint: words.t('passwordHint'),
    currentFirst: words.t('passwordCurrentFirst'),
    mismatch: words.t('passwordMismatch'),
    noPassword: words.t('passwordNone'),
    failed: words.t('passwordFailed'),
    done: words.t('passwordDone'),
    submit: words.t('passwordChange'),
    back: words.t('back'),
    problem: (key) => words.t(PROBLEM[key]),
    refused: (reason) => words.t(REFUSED[reason]),
  };
  return (
    <>
      <h1>{words.t('password')}</h1>
      <PasswordForm
        words={passwordWords}
        classes={{ form: 'portal__form', actions: 'portal__actions' }}
      />
    </>
  );
}
