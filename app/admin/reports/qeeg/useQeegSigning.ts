import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edition, Locale, Missing } from '../../../../domain/reports/qeeg/types';
import {
  IssueResponse,
  QeegLayoutNotes,
  ReportResponse,
  SupersedeResponse,
  TwinResponse,
  type ReportRow,
} from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import {
  issueRefusalSentence,
  previewRefusalSentence,
  supersedeRefusalSentence,
  twinRefusalSentence,
} from './refusals';
import type { QeegDraft } from './useQeegDraft';

/**
 * The preview, the signature and the correction of a brain-map report, as the
 * form asks for them (docs/SPEC/reports-qeeg.md sections 12, 14 and 15).
 *
 * **Saved first, every time** (section 15: "before a preview, a signing").
 * Both run through the draft's own `withSaved`, which saves what is on screen
 * when anything changed, then runs the door on that saved draft with no save
 * beside it. What is previewed and what is signed is what she sees.
 *
 * **The preview opens in a new tab** (section 12, "Rendered on the server";
 * the security policy refuses a document inside a frame). The file is fetched
 * with her credentials, held as an object URL and opened. `window.open` with
 * `noopener` answers null whether or not a tab opened, and a browser may hold
 * back a tab opened after the awaits before it, so the form claims neither:
 * it says the preview is ready and offers a link, which a person's click
 * always opens (plan N12; review of brief P, finding 5). What the pages told the editor comes back on the same answer, in its
 * `x-report-layout` header, and on a refusal in its body.
 *
 * **Signing names the save it is made over**, so a version saved since in
 * another tab is not signed unseen. A refusal is kept whole: the list of what
 * is left to fill is shown as a list, beside the sentence. Once signed, the
 * form saves nothing more: the draft is no longer one.
 *
 * **Correcting starts a new draft from what was signed**, with a reason, and
 * hands its id back so the form opens on it.
 *
 * **Either language is previewed** (section 12, "in either language"), each
 * from its own button, and what each preview found is kept apart, so the
 * English pages' notes are never read as the Arabic's.
 *
 * **"Sign the other language"** starts the second-language report of a signed
 * one as a draft (`POST /api/reports/:id/twin`, section 8) and hands its id
 * back, as a correction does, so the form opens on it.
 */

/** The reason the trail records beside the signature. */
export const SIGN_REASON = 'Brain-map report signed from the form';

/** The reason the trail records beside the start of the other language. */
export const TWIN_REASON = 'Other language of a signed brain-map report started from the form';

export const LOCALES: readonly Locale[] = Object.freeze(['en', 'ar']);

type ByLocale<T> = Readonly<Record<Locale, T>>;

function both<T>(value: T): ByLocale<T> {
  return { en: value, ar: value };
}

export type Signing = {
  /** The language a preview is being made in, or null. */
  previewing: Locale | null;
  /** What the pages told the editor, per language, from its last preview or its refusal. */
  notes: ByLocale<QeegLayoutNotes | null>;
  /** Each language's last preview, to open again; null before one or after a refusal. */
  previewUrl: ByLocale<string | null>;
  previewError: ByLocale<string | null>;
  confirming: boolean;
  signing: boolean;
  signError: string | null;
  /** What is left to fill, when a signature was refused for it. */
  missing: readonly Missing[];
  /** The report once signed. */
  signed: ReportRow | null;
  correcting: boolean;
  correctError: string | null;
  opening: boolean;
  openError: string | null;
  /** The signed file's short-lived link, once asked for, to open by a click. */
  signedUrl: string | null;
  twinning: boolean;
  twinError: string | null;
  preview: (locale: Locale) => Promise<void>;
  askToSign: () => void;
  notYet: () => void;
  sign: () => Promise<void>;
  openSigned: () => Promise<void>;
  askToCorrect: () => void;
  notNow: () => void;
  correct: (reason: string) => Promise<string | null>;
  /** Start the other language of the signed report; its draft's id, or null when refused. */
  startTwin: () => Promise<string | null>;
};

async function bodyOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function codeOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

/** The edition on screen, whose headings a refusal names. */
function editionOf(draft: QeegDraft): Edition {
  return draft.content?.edition ?? 'initial';
}

export function useQeegSigning(draft: QeegDraft): Signing {
  const { apiFetch } = useAuth();
  const [previewing, setPreviewing] = useState<Locale | null>(null);
  const [notes, setNotes] = useState<ByLocale<QeegLayoutNotes | null>>(both(null));
  const [previewUrl, setPreviewUrl] = useState<ByLocale<string | null>>(both(null));
  const [previewError, setPreviewError] = useState<ByLocale<string | null>>(both(null));
  const [twinning, setTwinning] = useState(false);
  const [twinError, setTwinError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [missing, setMissing] = useState<readonly Missing[]>([]);
  const [signed, setSigned] = useState<ReportRow | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  // A preview carries a household's own figures: its object URL lives until
  // the next preview or until the form closes, and no longer.
  const urlRef = useRef<Record<Locale, string | null>>({ en: null, ar: null });
  const forget = useCallback((locale: Locale) => {
    const url = urlRef.current[locale];
    if (url !== null) URL.revokeObjectURL(url);
    urlRef.current[locale] = null;
  }, []);
  useEffect(
    () => () => {
      for (const locale of LOCALES) forget(locale);
    },
    [forget],
  );

  const preview = useCallback(
    async (locale: Locale) => {
      const put = <T>(set: (fn: (was: ByLocale<T>) => ByLocale<T>) => void, value: T) =>
        set((was) => ({ ...was, [locale]: value }));
      setPreviewing(locale);
      put(setPreviewError, null);
      try {
        const saved = await draft.withSaved('preview', async (reportId) => {
          try {
            const res = await apiFetch(`/api/reports/${reportId}/preview?locale=${locale}`);
            if (!res.ok) {
              const body = await bodyOf(res);
              const layout = QeegLayoutNotes.safeParse(
                typeof body === 'object' && body !== null
                  ? (body as { layout?: unknown }).layout
                  : null,
              );
              put(setNotes, layout.success ? layout.data : null);
              forget(locale);
              put(setPreviewUrl, null);
              put(
                setPreviewError,
                previewRefusalSentence(res.status, body, { edition: editionOf(draft) }),
              );
              return null;
            }
            const header = res.headers.get('x-report-layout');
            const parsed = header === null ? null : QeegLayoutNotes.safeParse(JSON.parse(header));
            put(setNotes, parsed?.success ? parsed.data : null);
            forget(locale);
            const url = URL.createObjectURL(await res.blob());
            urlRef.current[locale] = url;
            put(setPreviewUrl, url);
            // Null with `noopener` whether or not a tab opened: not a refusal.
            window.open(url, '_blank', 'noopener,noreferrer');
          } catch {
            put(setPreviewError, previewRefusalSentence(0, null));
          }
          return null;
        });
        if (!saved) put(setPreviewError, 'The draft could not be saved, so no preview was made.');
      } finally {
        setPreviewing(null);
      }
    },
    [apiFetch, draft, forget],
  );

  const sign = useCallback(async () => {
    setSigning(true);
    setSignError(null);
    setMissing([]);
    try {
      const saved = await draft.withSaved('sign', async (reportId) => {
        try {
          const res = await apiFetch(`/api/reports/${reportId}/issue`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-reason': SIGN_REASON },
            body: JSON.stringify({ savedAt: draft.stamp() }),
          });
          if (!res.ok) {
            const body = await bodyOf(res);
            if (codeOf(body) === 'incomplete') {
              const list = (body as { missing?: unknown }).missing;
              setMissing(Array.isArray(list) ? (list as Missing[]) : []);
            }
            if (codeOf(body) === 'overrun') {
              const layout = QeegLayoutNotes.safeParse((body as { layout?: unknown }).layout);
              const own = draft.row?.locale ?? 'en';
              if (layout.success) setNotes((was) => ({ ...was, [own]: layout.data }));
            }
            setSignError(issueRefusalSentence(res.status, body, { edition: editionOf(draft) }));
            return null;
          }
          const answer = IssueResponse.parse(await res.json());
          // No longer a draft: nothing more is saved from this form.
          draft.discard();
          setConfirming(false);
          setSigned(answer.report);
        } catch {
          setSignError(issueRefusalSentence(0, null));
        }
        return null;
      });
      if (!saved) setSignError('The draft could not be saved, so nothing was signed.');
    } finally {
      setSigning(false);
    }
  }, [apiFetch, draft]);

  const openSigned = useCallback(async () => {
    if (signed === null) return;
    setOpening(true);
    setOpenError(null);
    try {
      const res = await apiFetch(`/api/reports/${signed.id}`);
      if (!res.ok) {
        // The repair path names a map that is gone in a sentence of its own
        // (app/api/reports/get.ts, spec 9.6); anything else is the plain one.
        const body = await bodyOf(res);
        const sentence =
          typeof body === 'object' && body !== null
            ? (body as { sentence?: unknown }).sentence
            : null;
        setOpenError(
          typeof sentence === 'string'
            ? sentence
            : 'The signed report could not be opened. Try again.',
        );
        return;
      }
      const body = ReportResponse.parse(await res.json());
      if (body.url === null) {
        setOpenError('The signed report’s file is not ready yet. Try again in a moment.');
        return;
      }
      setSignedUrl(body.url);
      // Null with `noopener` whether or not a tab opened, and a browser may
      // hold back a tab opened after an await: the link below is the sure way.
      window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch {
      setOpenError('The signed report could not be opened. Try again.');
    } finally {
      setOpening(false);
    }
  }, [apiFetch, signed]);

  const correct = useCallback(
    async (reason: string): Promise<string | null> => {
      if (signed === null) return null;
      setCorrectError(null);
      try {
        const res = await apiFetch(`/api/reports/${signed.id}/supersede`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          setCorrectError(supersedeRefusalSentence(res.status, await bodyOf(res)));
          return null;
        }
        const answer = SupersedeResponse.parse(await res.json());
        setCorrecting(false);
        return answer.report.id;
      } catch {
        setCorrectError(supersedeRefusalSentence(0, null));
        return null;
      }
    },
    [apiFetch, signed],
  );

  const startTwin = useCallback(async (): Promise<string | null> => {
    if (signed === null) return null;
    setTwinning(true);
    setTwinError(null);
    try {
      const res = await apiFetch(`/api/reports/${signed.id}/twin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': TWIN_REASON },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setTwinError(twinRefusalSentence(res.status, await bodyOf(res)));
        return null;
      }
      return TwinResponse.parse(await res.json()).report.id;
    } catch {
      setTwinError(twinRefusalSentence(0, null));
      return null;
    } finally {
      setTwinning(false);
    }
  }, [apiFetch, signed]);

  return {
    previewing,
    notes,
    previewUrl,
    previewError,
    confirming,
    signing,
    signError,
    missing,
    signed,
    correcting,
    correctError,
    opening,
    openError,
    signedUrl,
    twinning,
    twinError,
    preview,
    askToSign: () => {
      setSignError(null);
      setMissing([]);
      setConfirming(true);
    },
    notYet: () => setConfirming(false),
    sign,
    openSigned,
    askToCorrect: () => {
      setCorrectError(null);
      setCorrecting(true);
    },
    notNow: () => setCorrecting(false),
    correct,
    startTwin,
  };
}
