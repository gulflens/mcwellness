import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Note } from './components/Controls';

/**
 * The net under a screen that never arrives.
 *
 * Screens are fetched one at a time now (`app/shell/App.tsx`), which bought
 * every person a much smaller first download and introduced one failure the
 * app did not have before: a tab left open across a deploy asks for a file
 * whose name changed when the new version went out, the fetch fails, and
 * React unmounts the whole tree. Without this the person is left looking at a
 * blank page with nothing to press (the review of pull request 152, finding
 * 4). The practice runs on one or two people who have nobody to ask, so a
 * blank page is not an acceptable resting state.
 *
 * The recovery is a reload, and it is the right one rather than a convenient
 * one: the new page names the new files, so fetching it is precisely what
 * fixes the problem. The person is told that in those words rather than being
 * shown an error.
 *
 * This catches anything a screen throws while rendering, not only a failed
 * fetch, because the answer is the same either way and a second boundary
 * saying something subtler would be guessing at causes it cannot see.
 *
 * A class, because catching a render error is the one thing React still has
 * no hook for.
 *
 * English only, like the rest of the console (`tests/lint/console-is-english.test.ts`).
 * The household's portal is bilingual everywhere it speaks for itself, and
 * this is the one sentence that sits above the language it chose — a limit
 * worth naming rather than hiding, and worth revisiting if a household ever
 * meets it.
 */
export class ScreenBoundary extends Component<
  { children: ReactNode; reload?: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The message and the component stack, and nothing else: no person, no
    // record, nothing about a household (CLAUDE.md rule 5). It goes to the
    // browser's own console, which is where somebody helping would look, and
    // travels nowhere.
    console.error('A screen could not be shown.', error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    const reload = this.props.reload ?? (() => window.location.reload());
    return (
      <main className="plain">
        <Note tone="critical">This screen could not be loaded.</Note>
        <p>It usually means the app has been updated. Reload to get the new version.</p>
        <Button type="button" variant="primary" onClick={reload}>
          Reload
        </Button>
      </main>
    );
  }
}
