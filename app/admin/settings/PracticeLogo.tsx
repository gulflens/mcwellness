import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  PracticeLogoResponse,
  type LogoMimeType,
  type PracticeLogo as PracticeLogoRow,
} from '../../api/practice/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';

/**
 * Settings › Practice › Logo: the mark the practice's own documents will
 * carry (migration 909, `app/api/practice/logo.ts`,
 * `docs/CHANGE-REQUESTS/billing-04.md` request 5).
 *
 * The operator's decision of 2026-09-03: the invoice carries the practice's
 * logo, the wordmark "McWellness" set in the app's own type stands in until a
 * file is supplied, and the logo is a practice document this screen can
 * replace rather than a file committed to the repository. So this section is
 * three plain actions — choose, replace, remove — and one honest sentence
 * about where the file has got to.
 *
 * **What the copy may not claim.** The renderer that would draw the logo onto
 * an invoice is `domain/billing/document`, which is the billing stream's and
 * is unwritten (billing-04 request 5 says so in as many words). So nothing
 * here says the logo *is* printed on anything. It says what is true today: the
 * file is filed, and documents carry the wordmark until the renderer draws it.
 *
 * The image is shown through a **signed link that expires**, never a permanent
 * URL and never the bytes inline (docs/SEAMS.md). The route writes the read to
 * the trail before it signs, which is why the picture appearing here is a
 * recorded act rather than a free one — and why a link that has gone stale is
 * fetched again rather than kept alive.
 */

const ACCEPT = LOGO_MIME_TYPES.join(',');
/** 500,000 bytes, so the label and the server's own cap say the same number. */
const MAX_KILOBYTES = Math.floor(MAX_LOGO_BYTES / 1000);

const FILE_INPUT_ID = 'practice-logo-file';
const HINT_ID = 'practice-logo-hint';

const REFUSALS: Record<string, string> = {
  bytes_do_not_match_type: 'That file is not the kind of image it says it is. Choose another.',
  unsupported_type: 'The logo has to be a PNG or a JPEG.',
  logo_too_large: `That file is larger than ${MAX_KILOBYTES} KB. Choose a smaller one.`,
  payload_too_large: `That file is larger than ${MAX_KILOBYTES} KB. Choose a smaller one.`,
  storage_unavailable: 'The document store cannot be reached. Nothing was changed.',
  forbidden: 'The practice details are the owner’s and an admin’s to change.',
};
const GENERIC_ERROR = 'That did not save. Try again.';

type State =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'error' }
  | { kind: 'ready'; logo: PracticeLogoRow };

/** A chosen file as the route takes it: standard base64, and what it claims to be. */
async function readChosen(
  file: File,
): Promise<{ ok: true; mimeType: LogoMimeType; bytesBase64: string } | { ok: false; why: string }> {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, why: REFUSALS.unsupported_type ?? GENERIC_ERROR };
  }
  if (file.size === 0) {
    return { ok: false, why: 'That file is empty.' };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, why: REFUSALS.logo_too_large ?? GENERIC_ERROR };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // In chunks, because spreading half a million bytes into String.fromCharCode
  // at once overflows the argument list in every browser this has to run in.
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return { ok: true, mimeType: file.type as LogoMimeType, bytesBase64: btoa(binary) };
}

export function PracticeLogo() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  /** The link this section has already fetched again after it went stale. */
  const refetched = useRef<string | null>(null);
  const { apiFetch } = useAuth();

  const load = useCallback(async (): Promise<State> => {
    try {
      const res = await apiFetch('/api/practice/logo');
      if (res.status === 404) return { kind: 'none' };
      if (!res.ok) return { kind: 'error' };
      return { kind: 'ready', logo: PracticeLogoResponse.parse(await res.json()).logo };
    } catch {
      return { kind: 'error' };
    }
  }, [apiFetch]);

  useEffect(() => {
    let live = true;
    void load().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function refusalFrom(res: Response): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    return REFUSALS[body?.code ?? ''] ?? REFUSALS[body?.error ?? ''] ?? GENERIC_ERROR;
  }

  /**
   * The control keeps the file it was given, and choosing the same file twice
   * fires no change event — so a refusal a person then fixes on disk would be
   * unfixable without picking a different file. Cleared after every attempt,
   * refused or not.
   */
  function clearChooser(): void {
    if (chooser.current) chooser.current.value = '';
  }

  async function choose(file: File | null): Promise<void> {
    setNote(null);
    setError(null);
    if (!file) return;
    const prepared = await readChosen(file);
    if (!prepared.ok) {
      setError(prepared.why);
      clearChooser();
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/practice/logo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mimeType: prepared.mimeType,
          bytesBase64: prepared.bytesBase64,
        }),
      });
      if (!res.ok) {
        setError(await refusalFrom(res));
        return;
      }
      refetched.current = null;
      setState({ kind: 'ready', logo: PracticeLogoResponse.parse(await res.json()).logo });
      setNote('The logo is saved.');
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
      clearChooser();
    }
  }

  async function remove(): Promise<void> {
    setNote(null);
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch('/api/practice/logo', { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        setError(await refusalFrom(res));
        return;
      }
      refetched.current = null;
      setState({ kind: 'none' });
      setNote('The logo is removed. Documents carry the McWellness wordmark.');
      // The button that was pressed leaves the page with the logo it removed,
      // and focus would fall to the body. It goes to the control that replaces
      // it, which is the next thing a person would reach for.
      requestAnimationFrame(() => chooseButton.current?.focus());
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A signed link lives five minutes. A person who leaves this screen open
   * longer than that sees a broken image where the logo was, which reads as a
   * lost file rather than a stale link — so the link is fetched again, once,
   * and only once per link, so a genuinely missing object does not loop.
   */
  function relinkOnce(current: PracticeLogoRow): void {
    if (refetched.current === current.url) return;
    refetched.current = current.url;
    void load().then((next) => setState(next));
  }

  const logo = state.kind === 'ready' ? state.logo : null;
  const chooseLabel = logo ? 'Replace the logo' : 'Choose a logo file';

  return (
    <section className="practice__group">
      <h2 className="practice__heading">Logo</h2>

      {/*
        One status region, always in the document so a screen reader has
        something to announce into, and the page's own muted saved-note tone
        (PracticePage.tsx). A confirmation is not an attention state.
      */}
      <div role="status" className="practice__status">
        {note ? <Note>{note}</Note> : null}
      </div>
      {state.kind === 'loading' ? <Note>Loading the logo.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The logo could not be loaded. Try again.</Note>
      ) : null}
      {error ? <Note tone="critical">{error}</Note> : null}

      {logo ? (
        <p className="logo-preview">
          <img
            src={logo.url}
            alt="The practice’s logo, as it is filed"
            onError={() => relinkOnce(logo)}
          />
        </p>
      ) : state.kind === 'none' ? (
        <Note>
          No logo filed. Documents carry the McWellness wordmark, set in the app&rsquo;s own type,
          until the renderer draws one.
        </Note>
      ) : null}

      {/*
        The input itself is off the screen and reachable by keyboard: the
        browser's own "Choose File / No file chosen" chrome is the one control
        on this page whose words are the browser's rather than the practice's,
        and it cannot be translated or set in the console's own type. The
        button beside it opens the same dialogue and says what the practice
        would say.
      */}
      <div className="field">
        <label htmlFor={FILE_INPUT_ID} className="field__label">
          {chooseLabel}
        </label>
        <input
          ref={chooser}
          id={FILE_INPUT_ID}
          className="visually-hidden"
          type="file"
          accept={ACCEPT}
          disabled={busy}
          aria-describedby={HINT_ID}
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        />
        <div className="logo-actions">
          <Button
            ref={chooseButton}
            variant="secondary"
            disabled={busy}
            onClick={() => chooser.current?.click()}
          >
            {busy && !logo ? 'Filing…' : chooseLabel}
          </Button>
          {logo ? (
            <Button variant="quiet" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Working…' : 'Remove logo'}
            </Button>
          ) : null}
        </div>
        <p id={HINT_ID} className="field__hint small muted">
          A PNG or a JPEG, up to {MAX_KILOBYTES} KB. It is filed as the practice&rsquo;s own
          document, ready for the invoice and the receipt to draw, so supply the version meant for
          paper.
        </p>
      </div>
    </section>
  );
}
