import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMap,
  mapRefusal,
  mapsInOrder,
  putBack,
  removeMap,
  whereStillNamed,
} from '../../../../domain/reports/qeeg/maps';
import type { Condition } from '../../../../domain/reports/qeeg/types';
import {
  FigureFiledResponse,
  FigureOut,
  FigureRemovedResponse,
} from '../../../api/reports/qeeg/figureSchema';
import { ReportResponse } from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { prepareFile } from './mapFile';
import { figureRefusalSentence } from './refusals';
import type { QeegDraft } from './useQeegDraft';

/**
 * Adding a brain map to a draft and taking one away, through the report's own
 * two doors (docs/SPEC/reports-qeeg.md sections 9 and 15;
 * app/api/reports/qeeg/figures.ts).
 *
 * **Adding.** The file is made ready in the browser first (`prepareFile`:
 * its bytes capped, decoded, checked against the caps, trimmed, laid onto
 * white, written as a PNG, fingerprinted), so a picture over a cap, or a
 * ninth, is refused before anything is sent, with the domain's reason in the
 * form's words. Only then is the draft saved, if it has changed or was never
 * saved (section 15: "before an upload"), and the picture alone sent against
 * it: where a map sits and what it shows are the draft's, never the link's
 * (review O, concern 5). The draft names the picture, at the end of the list
 * with the condition she chose, inside the door's own turn, so a save waiting
 * behind the door (leaving the form, say) already includes it.
 *
 * **Taking away.** She confirms inside the form. A map the page of what has
 * changed still shows is not taken out: the form says where it is used. The
 * draft is saved without the map first, because the door refuses to remove a
 * picture the saved draft still prints, and then the door removes it. If the
 * door refuses, that one map goes back where it was (`putBack`) and the form
 * says why.
 *
 * **Saying exactly what happened.** A refusal is its sentence and changes
 * nothing else. An answer that never came, or one the form cannot read, is
 * not a refusal: the door may have finished, so the form says so and reads
 * the draft's stamp again rather than guess it. A browser that cannot prepare
 * a picture at all is told apart from a picture that is refused. And "the
 * draft could not be saved" is said only when that is what happened.
 *
 * **A refusal changes nothing on screen** except the sentence. Both doors move
 * the draft's stamp; `withSaved` makes each answer's stamp the one the next
 * save is made over, and lets no save run beside a door.
 *
 * **Thumbnails** are the pixels she has just chosen, as the prepared PNG,
 * held in memory as a `blob:` address for as long as the form is open. A map
 * saved earlier has no pixels here: opening it is a document read, which the
 * record route logs, so it is opened when she asks and never fetched to fill a
 * list (`DocumentLink`).
 */

export type MapsBusy = 'preparing' | 'uploading' | 'removing' | null;

export type QeegMaps = {
  busy: MapsBusy;
  /** Why the last add or removal did not go through, in words. */
  error: string | null;
  /** Something she should know that is not a refusal. */
  notice: string | null;
  /** The pictures chosen in this sitting, by figure id, as addresses an image can show. */
  thumbnails: Readonly<Record<string, string>>;
  add: (file: File, condition: Condition | null) => Promise<void>;
  remove: (figureId: string) => Promise<void>;
};

/** What the trail records beside each door's rows. */
export const MAP_REASONS = Object.freeze({
  add: 'Brain map added to a brain-map report',
  remove: 'Brain map removed from a brain-map report',
});

function thumbnailOf(png: Uint8Array): string | null {
  try {
    return URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  } catch {
    return null;
  }
}

export function useQeegMaps(draft: QeegDraft): QeegMaps {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState<MapsBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const madeRef = useRef<string[]>([]);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const made = madeRef.current;
    return () => {
      aliveRef.current = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, []);

  const { content, edit, withSaved } = draft;

  /**
   * The draft's stamp as the server holds it now, after a door whose answer
   * never came: the door may have moved it, and guessing either way would
   * make her next save refused as stale, or made over a stamp that is not.
   */
  const stampOf = useCallback(
    async (reportId: string): Promise<string | null> => {
      try {
        const res = await apiFetch(`/api/reports/${reportId}`);
        if (!res.ok) return null;
        return ReportResponse.parse(await res.json()).savedAt ?? null;
      } catch {
        return null;
      }
    },
    [apiFetch],
  );

  const add = useCallback(
    async (file: File, condition: Condition | null) => {
      if (content === null) return;
      setError(null);
      setNotice(null);
      const full = mapRefusal(content);
      if (full !== null) {
        setError(figureRefusalSentence(0, { code: full }));
        return;
      }
      setBusy('preparing');
      try {
        let prepared: Awaited<ReturnType<typeof prepareFile>>;
        try {
          prepared = await prepareFile(file);
        } catch {
          setError(figureRefusalSentence(0, { code: 'cannot_prepare' }));
          return;
        }
        if (!prepared.ok) {
          setError(figureRefusalSentence(0, { code: prepared.refusal }));
          return;
        }
        const png = prepared.png;
        setBusy('uploading');
        const named = (figureId: string) =>
          Object.values(content.maps).some((entry) => entry.figureId === figureId);
        // What the door did, written by its callback.
        const outcome: { said: string | null; filed: FigureOut | null; again: boolean } = {
          said: null,
          filed: null,
          again: false,
        };
        const ran = await withSaved('upload', async (reportId) => {
          let res: Response;
          try {
            // The picture only: where it sits and what it shows are the draft's.
            res = await apiFetch(`/api/reports/${reportId}/figures`, {
              method: 'PUT',
              headers: {
                'content-type': 'image/png',
                'x-sha256': prepared.sha256,
                'x-reason': MAP_REASONS.add,
              },
              body: png as Uint8Array<ArrayBuffer>,
            });
          } catch {
            outcome.said = figureRefusalSentence(0, { code: 'unknown_outcome' });
            return stampOf(reportId);
          }
          const body: unknown = await res.json().catch(() => undefined);
          if (!res.ok) {
            const code = (body as { code?: unknown; error?: unknown } | undefined)?.code;
            const storeDown =
              (body as { error?: unknown } | undefined)?.error === 'storage_unavailable';
            if (res.status >= 500 && !storeDown) {
              // A gateway's timeout, or a fault after the commit: it may be filed.
              outcome.said = figureRefusalSentence(0, { code: 'unknown_outcome' });
              return stampOf(reportId);
            }
            outcome.said = figureRefusalSentence(res.status, body);
            // A picture the report already holds and the draft does not
            // name (the form closed before its last save, say) is named now,
            // so it can be seen and removed.
            const figure = FigureOut.safeParse((body as { figure?: unknown } | undefined)?.figure);
            if (res.status === 409 && code === 'already_on_report' && figure.success) {
              const held = figure.data;
              edit((was) => addMap(was, held, held.condition ?? condition));
            }
            return null;
          }
          const parsed = FigureFiledResponse.safeParse(body);
          if (!parsed.success) {
            outcome.said = figureRefusalSentence(0, { code: 'unknown_outcome' });
            return stampOf(reportId);
          }
          const { figure } = parsed.data;
          outcome.again = named(figure.figureId);
          outcome.filed = figure;
          // Named in the draft before any save waiting behind the door runs,
          // so leaving now still saves it.
          edit((was) => addMap(was, figure, condition));
          return parsed.data.savedAt;
        });
        if (!ran) {
          setError(
            'The draft could not be saved, so the map was not sent. The reason is beneath the form.',
          );
          return;
        }
        if (outcome.said !== null) {
          setError(outcome.said);
          return;
        }
        const filed = outcome.filed;
        if (filed === null) return;
        if (outcome.again) {
          setNotice('This picture is already on the report.');
          return;
        }
        if (!aliveRef.current) return;
        const url = thumbnailOf(png);
        if (url !== null) {
          madeRef.current.push(url);
          setThumbnails((was) => ({ ...was, [filed.figureId]: url }));
        }
      } finally {
        setBusy(null);
      }
    },
    [apiFetch, content, edit, stampOf, withSaved],
  );

  const remove = useCallback(
    async (figureId: string) => {
      if (content === null) return;
      setError(null);
      setNotice(null);
      const where = whereStillNamed(content, figureId);
      if (where[0] !== undefined) {
        setError(figureRefusalSentence(409, { code: 'figure_in_use', field: where[0] }));
        return;
      }
      const taken = mapsInOrder(content).find(({ entry }) => entry.figureId === figureId);
      if (taken === undefined) return;
      edit((was) => removeMap(was, figureId));
      setBusy('removing');
      const outcome: { said: string | null } = { said: null };
      try {
        const ran = await withSaved('remove', async (reportId) => {
          let res: Response;
          try {
            res = await apiFetch(`/api/reports/${reportId}/figures/${figureId}`, {
              method: 'DELETE',
              headers: { 'x-reason': MAP_REASONS.remove },
            });
          } catch {
            // It may be gone. The draft, already saved without it, stays so.
            outcome.said = figureRefusalSentence(0, { code: 'unknown_removal' });
            return stampOf(reportId);
          }
          const body: unknown = await res.json().catch(() => undefined);
          if (!res.ok) {
            const code = (body as { code?: unknown } | undefined)?.code;
            const storeDown =
              (body as { error?: unknown } | undefined)?.error === 'storage_unavailable';
            if (res.status >= 500 && !storeDown) {
              outcome.said = figureRefusalSentence(0, { code: 'unknown_removal' });
              return stampOf(reportId);
            }
            outcome.said = figureRefusalSentence(res.status, body);
            // Already gone from the report: the draft is right without it.
            // Otherwise only this map goes back; one added meanwhile stays.
            if (code !== 'no_such_map') edit((was) => putBack(was, taken));
            return null;
          }
          const parsed = FigureRemovedResponse.safeParse(body);
          if (!parsed.success) {
            outcome.said = figureRefusalSentence(0, { code: 'unknown_removal' });
            return stampOf(reportId);
          }
          return parsed.data.savedAt;
        });
        if (!ran) {
          edit((was) => putBack(was, taken));
          setError(
            'The draft could not be saved, so the map was not removed. The reason is beneath the form.',
          );
          return;
        }
        if (outcome.said !== null) {
          setError(outcome.said);
          return;
        }
        setThumbnails((was) =>
          Object.fromEntries(Object.entries(was).filter(([id]) => id !== figureId)),
        );
      } finally {
        setBusy(null);
      }
    },
    [apiFetch, content, edit, stampOf, withSaved],
  );

  return { busy, error, notice, thumbnails, add, remove };
}
