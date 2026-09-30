import { useCallback, useEffect, useRef, useState } from 'react';
import type { Missing } from '../../../../domain/reports/qeeg/types';
import {
  IssueResponse,
  QeegLayoutNotes,
  ReportResponse,
  SupersedeResponse,
  type ReportRow,
} from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { issueRefusalSentence, previewRefusalSentence, supersedeRefusalSentence } from './refusals';
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
 * `noopener` answers null whether or not a tab opened, so null is not read as
 * "blocked" (the older editor's fault, plan N12): the form says the preview
 * was opened and keeps a link to open it again, which a person's click always
 * opens. What the pages told the editor comes back on the same answer, in its
 * `x-report-layout` header, and on a refusal in its body.
 *
 * **Signing names the save it is made over**, so a version saved since in
 * another tab is not signed unseen. A refusal is kept whole: the list of what
 * is left to fill is shown as a list, beside the sentence. Once signed, the
 * form saves nothing more: the draft is no longer one.
 *
 * **Correcting starts a new draft from what was signed**, with a reason, and
 * hands its id back so the form opens on it.
 */

/** The reason the trail records beside the signature. */
export const SIGN_REASON = 'Brain-map report signed from the form';

export type Signing = {
  previewing: boolean;
  /** What the pages told the editor, from the last preview or its refusal. */
  notes: QeegLayoutNotes | null;
  /** The last preview, to open again; null before one or after a refusal. */
  previewUrl: string | null;
  previewError: string | null;
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
  preview: () => Promise<void>;
  askToSign: () => void;
  notYet: () => void;
  sign: () => Promise<void>;
  openSigned: () => Promise<void>;
  askToCorrect: () => void;
  notNow: () => void;
  correct: (reason: string) => Promise<string | null>;
};

async function bodyOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

function codeOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export function useQeegSigning(draft: QeegDraft): Signing {
  const { apiFetch } = useAuth();
  const [previewing, setPreviewing] = useState(false);
  const [notes, setNotes] = useState<QeegLayoutNotes | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [missing, setMissing] = useState<readonly Missing[]>([]);
  const [signed, setSigned] = useState<ReportRow | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // A preview carries a household's own figures: its object URL lives until
  // the next preview or until the form closes, and no longer.
  const urlRef = useRef<string | null>(null);
  const forget = useCallback(() => {
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);
  useEffect(() => forget, [forget]);

  const preview = useCallback(async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const saved = await draft.withSaved('preview', async (reportId) => {
        try {
          const res = await apiFetch(`/api/reports/${reportId}/preview?locale=en`);
          if (!res.ok) {
            const body = await bodyOf(res);
            const layout = QeegLayoutNotes.safeParse(
              typeof body === 'object' && body !== null
                ? (body as { layout?: unknown }).layout
                : null,
            );
            setNotes(layout.success ? layout.data : null);
            forget();
            setPreviewUrl(null);
            setPreviewError(previewRefusalSentence(res.status, body));
            return null;
          }
          const header = res.headers.get('x-report-layout');
          const parsed = header === null ? null : QeegLayoutNotes.safeParse(JSON.parse(header));
          setNotes(parsed?.success ? parsed.data : null);
          forget();
          const url = URL.createObjectURL(await res.blob());
          urlRef.current = url;
          setPreviewUrl(url);
          // Null with `noopener` whether or not a tab opened: not a refusal.
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch {
          setPreviewError(previewRefusalSentence(0, null));
        }
        return null;
      });
      if (!saved) setPreviewError('The draft could not be saved, so no preview was made.');
    } finally {
      setPreviewing(false);
    }
  }, [apiFetch, draft, forget]);

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
              if (layout.success) setNotes(layout.data);
            }
            setSignError(issueRefusalSentence(res.status, body));
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
        setOpenError('The signed report could not be opened. Try again.');
        return;
      }
      const body = ReportResponse.parse(await res.json());
      if (body.url === null) {
        setOpenError('The signed report’s file is not ready yet. Try again in a moment.');
        return;
      }
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
  };
}
