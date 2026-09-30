import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMap,
  mapRefusal,
  removeMap,
  whereStillNamed,
} from '../../../../domain/reports/qeeg/maps';
import type { Condition } from '../../../../domain/reports/qeeg/types';
import {
  FigureFiledResponse,
  FigureOut,
  FigureRemovedResponse,
} from '../../../api/reports/qeeg/figureSchema';
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
 * decoded, checked against the caps, trimmed, laid onto white, written as a
 * PNG, fingerprinted), so a picture over a cap, or a ninth, is refused before
 * anything is sent, with the domain's reason in the form's words. Only then
 * is the draft saved, if it has changed or was never saved (section 15: "before
 * an upload"), and the picture sent against it. The draft then names it, at
 * the end of the list, with the condition the door filed it under (a picture
 * the door already held is answered with the first filing's values, and the
 * form takes those, never its own guess).
 *
 * **Taking away.** She confirms inside the form. A map the page of what has
 * changed still shows is not taken out: the form says where it is used. The
 * draft is saved without the map first, because the door refuses to remove a
 * picture the saved draft still prints, and then the door removes it. If the
 * door refuses, the map goes back where it was and the form says why.
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

  useEffect(
    () => () => {
      for (const url of madeRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const { content, edit, withSaved } = draft;

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
        const prepared = await prepareFile(file);
        if (!prepared.ok) {
          setError(figureRefusalSentence(0, { code: prepared.refusal }));
          return;
        }
        setBusy('uploading');
        // What the door answered, written by its callback.
        const outcome: {
          filed: FigureFiledResponse | null;
          refused: string | null;
          handedBack: FigureOut | null;
        } = { filed: null, refused: null, handedBack: null };
        const query = new URLSearchParams();
        if (condition !== null) query.set('condition', condition);
        query.set('position', String(Object.keys(content.maps).length));
        const done = await withSaved('upload', async (reportId) => {
          const res = await apiFetch(`/api/reports/${reportId}/figures?${query.toString()}`, {
            method: 'PUT',
            headers: {
              'content-type': 'image/png',
              'x-sha256': prepared.sha256,
              'x-reason': MAP_REASONS.add,
            },
            body: prepared.png as Uint8Array<ArrayBuffer>,
          });
          const body: unknown = await res.json().catch(() => null);
          if (!res.ok) {
            outcome.refused = figureRefusalSentence(res.status, body);
            const figure = FigureOut.safeParse((body as { figure?: unknown } | null)?.figure);
            if (res.status === 409 && figure.success) outcome.handedBack = figure.data;
            return null;
          }
          outcome.filed = FigureFiledResponse.parse(body);
          return outcome.filed.savedAt;
        });
        const answer = outcome.filed;
        const sameAgain = outcome.handedBack;
        if (!done || answer === null) {
          // A picture the report already holds, which this draft does not
          // name (the form closed before its last save, say), is named now,
          // as it was filed, so it can be seen and removed.
          if (sameAgain !== null) {
            const figure: FigureOut = sameAgain;
            edit((was) => addMap(was, figure, figure.condition));
          }
          setError(
            outcome.refused ??
              'The draft could not be saved, so the map was not sent. The reason is beneath the form.',
          );
          return;
        }
        const { figure } = answer;
        if (Object.values(content.maps).some((entry) => entry.figureId === figure.figureId)) {
          setNotice('This picture is already on the report.');
          return;
        }
        edit((was) => addMap(was, figure, figure.condition));
        const url = thumbnailOf(prepared.png);
        if (url !== null) {
          madeRef.current.push(url);
          setThumbnails((was) => ({ ...was, [figure.figureId]: url }));
        }
      } finally {
        setBusy(null);
      }
    },
    [apiFetch, content, edit, withSaved],
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
      const kept = content.maps;
      edit((was) => removeMap(was, figureId));
      setBusy('removing');
      const outcome: { refused: string | null; gone: boolean } = { refused: null, gone: false };
      try {
        const done = await withSaved('remove', async (reportId) => {
          const res = await apiFetch(`/api/reports/${reportId}/figures/${figureId}`, {
            method: 'DELETE',
            headers: { 'x-reason': MAP_REASONS.remove },
          });
          const body: unknown = await res.json().catch(() => null);
          if (!res.ok) {
            outcome.refused = figureRefusalSentence(res.status, body);
            // Already gone from the report: the draft is right without it.
            outcome.gone = (body as { code?: unknown } | null)?.code === 'no_such_map';
            return null;
          }
          return FigureRemovedResponse.parse(body).savedAt;
        });
        if (!done) {
          if (!outcome.gone) {
            edit((was) =>
              Object.values(was.maps).some((entry) => entry.figureId === figureId)
                ? was
                : { ...was, maps: kept },
            );
          }
          setError(
            outcome.refused ??
              'The draft could not be saved, so the map was not removed. The reason is beneath the form.',
          );
          return;
        }
        setThumbnails((was) =>
          Object.fromEntries(Object.entries(was).filter(([id]) => id !== figureId)),
        );
      } finally {
        setBusy(null);
      }
    },
    [apiFetch, content, edit, withSaved],
  );

  return { busy, error, notice, thumbnails, add, remove };
}
