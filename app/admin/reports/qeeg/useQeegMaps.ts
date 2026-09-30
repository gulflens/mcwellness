import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addMap,
  mapRefusal,
  mapsInOrder,
  putBack,
  removeMap,
  whereStillNamed,
} from '../../../../domain/reports/qeeg/maps';
import type { Condition, FigureRef } from '../../../../domain/reports/qeeg/types';
import {
  FigureFiledResponse,
  FigureListResponse,
  FigureRemovedResponse,
  type FigureListed,
} from '../../../api/reports/qeeg/figureSchema';
import { ReportResponse } from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { prepareFile } from './mapFile';
import { figureRefusalSentence, listRefusalSentence } from './refusals';
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
 * **Pictures uploaded and not on the report** are read from the draft's own
 * list (`GET /api/reports/:id/figures`) when the section opens and after any
 * answer that never came: a link neither named by the saved draft, nor by
 * the draft on screen, nor borrowed. She places or removes each. They count
 * toward the eight as the door counts them, and the eighth-map refusal says
 * how many could make room (review O, concern 3). The same list settles an
 * answer that never came: a picture listed was filed and is placed; one not
 * listed was not; a map still listed was not removed and goes back.
 *
 * **The draft alone places a map.** A link holds no condition or place (fix
 * round 3 of the server): the condition is the one she chose, the place is
 * the end of the list, and the door's answer is read for the picture only.
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
  /** Why the list of the draft's pictures could not be read, in words. */
  listError: string | null;
  /** The pictures chosen in this sitting, by figure id, as addresses an image can show. */
  thumbnails: Readonly<Record<string, string>>;
  /** Pictures uploaded to the draft that it does not place, in filing order. */
  unplaced: readonly FigureListed[];
  add: (file: File, condition: Condition | null) => Promise<void>;
  remove: (figureId: string) => Promise<void>;
  /** An uploaded picture put at the end of the list of maps. */
  place: (figureId: string, condition: Condition | null) => void;
  /** Read the list of the draft's pictures again. */
  refresh: () => Promise<void>;
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

function refOf(link: FigureListed): FigureRef {
  return {
    figureId: link.figureId,
    sha256: link.sha256,
    widthPx: link.widthPx,
    heightPx: link.heightPx,
  };
}

type Listed = { ok: true; figures: FigureListed[] } | { ok: false; said: string };

export function useQeegMaps(draft: QeegDraft): QeegMaps {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState<MapsBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [links, setLinks] = useState<FigureListed[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const madeRef = useRef<string[]>([]);
  const aliveRef = useRef(true);
  /**
   * Counts the list reads and the changes made to the list here. Only the
   * newest is applied: a slow read that set out before a removal must not
   * bring the removed picture back.
   */
  const listSeqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    const made = madeRef.current;
    return () => {
      aliveRef.current = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, []);

  const { content, edit, withSaved, reportId } = draft;

  const placedIds = new Set(Object.values(content?.maps ?? {}).map((entry) => entry.figureId));
  const unplaced = links.filter(
    (link) => !link.named && !link.borrowed && !placedIds.has(link.figureId),
  );

  /** The draft's pictures as the server lists them, or why they could not be read. */
  const listOf = useCallback(
    async (id: string): Promise<Listed> => {
      try {
        const res = await apiFetch(`/api/reports/${id}/figures`);
        const body: unknown = await res.json().catch(() => undefined);
        if (!res.ok) return { ok: false, said: listRefusalSentence(res.status, body) };
        const parsed = FigureListResponse.safeParse(body);
        if (!parsed.success) return { ok: false, said: listRefusalSentence(0, null) };
        return { ok: true, figures: parsed.data.figures };
      } catch {
        return { ok: false, said: listRefusalSentence(0, null) };
      }
    },
    [apiFetch],
  );

  /** Reads the list, and shows it unless a newer read or change came after it set out. */
  const readList = useCallback(
    async (id: string): Promise<Listed> => {
      listSeqRef.current += 1;
      const mine = listSeqRef.current;
      const listed = await listOf(id);
      if (aliveRef.current && mine === listSeqRef.current) {
        if (listed.ok) {
          setLinks(listed.figures);
          setListError(null);
        } else {
          setListError(listed.said);
        }
      }
      return listed;
    },
    [listOf],
  );

  const refresh = useCallback(async () => {
    if (reportId === null) return;
    await readList(reportId);
  }, [readList, reportId]);

  /**
   * The draft's stamp as the server holds it now, after a door whose answer
   * never came: the door may have moved it, and guessing either way would
   * make her next save refused as stale, or made over a stamp that is not.
   */
  const stampOf = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        const res = await apiFetch(`/api/reports/${id}`);
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
      const full = mapRefusal(content, unplaced.length);
      if (full !== null) {
        setError(figureRefusalSentence(0, { code: full }, { unplaced: unplaced.length }));
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
        const { png, sha256 } = prepared;
        setBusy('uploading');
        const named = (figureId: string) =>
          Object.values(content.maps).some((entry) => entry.figureId === figureId);
        // What the door did, written by its callback.
        const outcome: {
          said: string | null;
          told: string | null;
          filed: FigureRef | null;
          again: boolean;
        } = { said: null, told: null, filed: null, again: false };

        /** After an answer that never came: the list says whether it was filed. */
        const settle = async (id: string): Promise<string | null> => {
          const listed = await readList(id);
          if (!listed.ok) {
            outcome.said = figureRefusalSentence(0, { code: 'unknown_outcome' });
          } else {
            // Her own upload: a borrowed picture with the same bytes is the
            // earlier report's, and placing it would leave hers behind.
            const link = listed.figures.find((each) => each.sha256 === sha256 && !each.borrowed);
            if (link === undefined) {
              outcome.said = figureRefusalSentence(0, { code: 'not_kept' });
            } else {
              const ref = refOf(link);
              outcome.filed = ref;
              outcome.again = named(ref.figureId);
              // "Kept, and now on the report" only when this places it.
              if (!outcome.again) {
                outcome.told = figureRefusalSentence(0, { code: 'kept_after_all' });
                edit((was) => addMap(was, ref, condition));
              }
            }
          }
          return stampOf(id);
        };

        const ran = await withSaved('upload', async (id) => {
          try {
            let res: Response;
            try {
              // The picture only: where it sits and what it shows are the draft's.
              res = await apiFetch(`/api/reports/${id}/figures`, {
                method: 'PUT',
                headers: {
                  'content-type': 'image/png',
                  'x-sha256': sha256,
                  'x-reason': MAP_REASONS.add,
                },
                body: png as Uint8Array<ArrayBuffer>,
              });
            } catch {
              return settle(id);
            }
            const body: unknown = await res.json().catch(() => undefined);
            if (!res.ok) {
              const storeDown =
                (body as { error?: unknown } | undefined)?.error === 'storage_unavailable';
              if (res.status >= 500 && !storeDown) {
                // A gateway's timeout, or a fault after the commit: it may be filed.
                return settle(id);
              }
              const code = (body as { code?: unknown } | undefined)?.code;
              if (code === 'too_many_maps') {
                // Another tab, or pictures this form had not seen: the list says which.
                const listed = await readList(id);
                const more = listed.ok
                  ? listed.figures.filter(
                      (link) => !link.named && !link.borrowed && !named(link.figureId),
                    ).length
                  : 0;
                outcome.said = figureRefusalSentence(res.status, body, { unplaced: more });
                return null;
              }
              outcome.said = figureRefusalSentence(res.status, body);
              return null;
            }
            const parsed = FigureFiledResponse.safeParse(body);
            if (!parsed.success) return settle(id);
            const figure: FigureRef = {
              figureId: parsed.data.figure.figureId,
              sha256: parsed.data.figure.sha256,
              widthPx: parsed.data.figure.widthPx,
              heightPx: parsed.data.figure.heightPx,
            };
            // A 200 is a picture the report already held: placed, unless the
            // draft already places it.
            outcome.again = named(figure.figureId);
            outcome.filed = figure;
            // Named in the draft before any save waiting behind the door runs,
            // so leaving now still saves it.
            edit((was) => addMap(was, figure, condition));
            return parsed.data.savedAt;
          } catch {
            // A fault of the form's own, not an answer: said as such, and the
            // stamp read again, since the door may have run.
            outcome.said = figureRefusalSentence(0, { code: 'unexpected' });
            return stampOf(id);
          }
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
        if (outcome.told !== null) setNotice(outcome.told);
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
    [apiFetch, content, edit, readList, stampOf, unplaced.length, withSaved],
  );

  const place = useCallback(
    (figureId: string, condition: Condition | null) => {
      const link = links.find((each) => each.figureId === figureId);
      if (link === undefined) return;
      setError(null);
      setNotice(null);
      edit((was) => addMap(was, refOf(link), condition));
    },
    [edit, links],
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
      // A map on the report is taken off the draft first; an uploaded picture
      // not on it has nothing to take off.
      const taken = mapsInOrder(content).find(({ entry }) => entry.figureId === figureId);
      if (taken !== undefined) edit((was) => removeMap(was, figureId));
      const back = () => {
        if (taken !== undefined) edit((was) => putBack(was, taken));
      };
      setBusy('removing');
      const outcome: { said: string | null; told: string | null; gone: boolean } = {
        said: null,
        told: null,
        gone: false,
      };

      /** After an answer that never came: the list says whether it went. */
      const settle = async (id: string): Promise<string | null> => {
        const listed = await readList(id);
        if (!listed.ok) {
          outcome.said = figureRefusalSentence(0, { code: 'unknown_removal' });
        } else if (listed.figures.some((link) => link.figureId === figureId)) {
          back();
          outcome.said = figureRefusalSentence(0, { code: 'not_removed' });
        } else {
          outcome.gone = true;
          outcome.told = figureRefusalSentence(0, { code: 'removed_after_all' });
        }
        return stampOf(id);
      };

      try {
        const ran = await withSaved('remove', async (id) => {
          try {
            let res: Response;
            try {
              res = await apiFetch(`/api/reports/${id}/figures/${figureId}`, {
                method: 'DELETE',
                headers: { 'x-reason': MAP_REASONS.remove },
              });
            } catch {
              return settle(id);
            }
            const body: unknown = await res.json().catch(() => undefined);
            if (!res.ok) {
              const storeDown =
                (body as { error?: unknown } | undefined)?.error === 'storage_unavailable';
              if (res.status >= 500 && !storeDown) return settle(id);
              outcome.said = figureRefusalSentence(res.status, body);
              // Already gone from the report: the draft is right without it.
              // Otherwise only this map goes back; one added meanwhile stays.
              if ((body as { code?: unknown } | undefined)?.code === 'no_such_map') {
                outcome.gone = true;
              } else {
                back();
              }
              return null;
            }
            const parsed = FigureRemovedResponse.safeParse(body);
            if (!parsed.success) return settle(id);
            outcome.gone = true;
            return parsed.data.savedAt;
          } catch {
            // A fault of the form's own, not an answer: said as such, and the
            // stamp read again, since the door may have run.
            outcome.said = figureRefusalSentence(0, { code: 'unexpected_removal' });
            return stampOf(id);
          }
        });
        if (!ran) {
          back();
          setError(
            'The draft could not be saved, so the map was not removed. The reason is beneath the form.',
          );
          return;
        }
        if (outcome.gone) {
          // Newer than any read still on its way.
          listSeqRef.current += 1;
          setLinks((was) => was.filter((link) => link.figureId !== figureId));
          setThumbnails((was) =>
            Object.fromEntries(Object.entries(was).filter(([id]) => id !== figureId)),
          );
        }
        if (outcome.told !== null) setNotice(outcome.told);
        if (outcome.said !== null) setError(outcome.said);
      } finally {
        setBusy(null);
      }
    },
    [apiFetch, content, edit, readList, stampOf, withSaved],
  );

  return {
    busy,
    error,
    notice,
    listError,
    thumbnails,
    unplaced,
    add,
    remove,
    place,
    refresh,
  };
}
