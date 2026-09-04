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
 * Settings › Practice › Logo: the mark at the top of every document the
 * practice issues (migration 909, `app/api/practice/logo.ts`,
 * `docs/CHANGE-REQUESTS/billing-04.md` request 5).
 *
 * The operator's decision of 2026-09-03: the invoice carries the practice's
 * logo, the wordmark "McWellness" set in the app's own type stands in until a
 * file is supplied, and the logo is a practice document this screen can
 * replace rather than a file committed to the repository. So this section is
 * three plain actions — choose, replace, remove — and one honest sentence
 * about what is on the documents today.
 *
 * The image is shown through a **signed link that expires**, never a
 * permanent URL and never the bytes inline (docs/SEAMS.md). The route writes
 * the read to the trail before it signs, which is why the picture appearing
 * here is a recorded act rather than a free one.
 */

const ACCEPT = LOGO_MIME_TYPES.join(',');
const MAX_KILOBYTES = Math.floor(MAX_LOGO_BYTES / 1024);

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
  // In chunks, because spreading a 512 KB array into String.fromCharCode at
  // once overflows the argument list in every browser this has to run in.
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

  async function choose(file: File | null): Promise<void> {
    setNote(null);
    setError(null);
    if (!file) return;
    const prepared = await readChosen(file);
    if (!prepared.ok) {
      setError(prepared.why);
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
      setState({ kind: 'ready', logo: PracticeLogoResponse.parse(await res.json()).logo });
      setNote('The logo is saved. Documents issued from now on carry it.');
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
      // The same file chosen twice in a row fires no change event unless the
      // control is cleared between.
      if (chooser.current) chooser.current.value = '';
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
      setState({ kind: 'none' });
      setNote('The logo is removed. Documents carry the McWellness wordmark again.');
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const logo = state.kind === 'ready' ? state.logo : null;

  return (
    <section className="practice__group">
      <h2 className="practice__heading">Logo</h2>

      <div role="status">{note ? <Note tone="attention">{note}</Note> : null}</div>
      {state.kind === 'loading' ? <Note>Loading the logo.</Note> : null}
      {state.kind === 'error' ? (
        <Note tone="critical">The logo could not be loaded. Try again.</Note>
      ) : null}
      {error ? <Note tone="critical">{error}</Note> : null}

      {logo ? (
        <p className="logo-preview">
          {/* The link is short-lived and the read behind it is on the trail. */}
          <img src={logo.url} alt="The practice’s logo, as documents carry it" />
        </p>
      ) : state.kind === 'none' ? (
        <Note>
          No logo yet. Documents carry the McWellness wordmark, set in the app&rsquo;s own type,
          until one is supplied.
        </Note>
      ) : null}

      <div className="field">
        <label htmlFor="practice-logo-file" className="field__label">
          {logo ? 'Replace the logo' : 'The logo file'}
        </label>
        <input
          ref={chooser}
          id="practice-logo-file"
          className="field__input"
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        />
        <p className="small muted">
          A PNG or a JPEG, up to {MAX_KILOBYTES} KB. It is printed at the top of every invoice and
          receipt the practice issues, so supply the version meant for paper.
        </p>
      </div>

      {logo ? (
        <div className="drawer__actions">
          <Button variant="secondary" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Working…' : 'Remove logo'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
