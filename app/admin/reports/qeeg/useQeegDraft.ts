import { useCallback, useEffect, useRef, useState } from 'react';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import { QeegDraftResponse, ReportResponse } from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { requestBody, withServerParts } from './draftBody';
import { refusalSentence } from './refusals';

/**
 * A brain-map draft on screen, and when it is saved
 * (docs/SPEC/reports-qeeg.md section 15).
 *
 * **Saved at rest points, never per keystroke.** Each save writes a row to the
 * audit trail, so the form saves when she moves to another section, thirty
 * seconds after her last change, before a preview, a signature, an upload or
 * leaving, and when she presses Save. A rest point with nothing changed since
 * the last save sends nothing.
 *
 * **Every save says why** (`X-Reason`). The route refuses one that does not,
 * and the reason is what the trail records beside the row. Each rest point
 * has a fixed sentence of its own, so the trail says which it was.
 *
 * **A save over a newer one is refused, and she is told.** Every save names
 * the stamp of the save it was made over (`savedAt`). When another tab or
 * another person saved since, the route answers 409 and nothing is written.
 * The form stops saving on its own, says so plainly, and offers to load the
 * newer version. It never sends the save again over the top.
 *
 * **One save at a time.** A rest point reached while a save is on its way
 * waits for it, then saves only if something changed in the meantime, so two
 * saves never race each other to the stamp.
 *
 * The draft is created by its first save, as the other report editor's is:
 * starting a report and leaving it untouched writes nothing.
 */

export type RestPoint =
  'section' | 'idle' | 'button' | 'leave' | 'edition' | 'preview' | 'sign' | 'upload' | 'remove';

/** The reason each rest point writes to the trail. */
export const SAVE_REASONS: Readonly<Record<RestPoint, string>> = Object.freeze({
  section: 'Brain-map report saved on moving to another section',
  idle: 'Brain-map report saved thirty seconds after the last change',
  button: 'Brain-map report saved with the Save button',
  leave: 'Brain-map report saved on leaving the form',
  edition: 'Brain-map report saved after its edition was changed',
  preview: 'Brain-map report saved before a preview',
  sign: 'Brain-map report saved before signing',
  upload: 'Brain-map report saved before a brain map was uploaded',
  remove: 'Brain-map report saved before a brain map was removed',
});

/** How long after her last change the form saves on its own. */
export const IDLE_MS = 30_000;

export type QeegDraft = {
  content: QeegContent | null;
  /** The saved row's id, or null before the first save. */
  reportId: string | null;
  loading: boolean;
  saving: boolean;
  /** Something changed since the last save. */
  dirty: boolean;
  /** A newer version was saved elsewhere: the form no longer saves until it is reloaded. */
  stale: boolean;
  error: string | null;
  /** Change the draft on screen. Starts the thirty seconds again. */
  edit: (change: (content: QeegContent) => QeegContent) => void;
  /** Save now, at a rest point. True when what is on screen is saved. */
  save: (point: RestPoint) => Promise<boolean>;
  /** Load the version saved elsewhere, setting aside what is on screen. */
  reload: () => Promise<void>;
  /** Drop what is on screen unsaved: nothing is sent for it, not even on leaving. */
  discard: () => void;
  /**
   * Save at `point` when there is anything to save (or no draft yet), then
   * run `door` on the saved draft with no save beside it. `door` answers the
   * draft's new stamp, which the next save is made over, or null to keep the
   * one held; a change it makes to the draft (`edit`) is made before any save
   * waiting behind it runs. False only when the save before it failed and the
   * door never ran; what the door itself did, it tells its caller.
   */
  withSaved: (
    point: RestPoint,
    door: (reportId: string) => Promise<string | null>,
  ) => Promise<boolean>;
};

type Loaded = { content: QeegContent; savedAt: string | null } | null;

export function useQeegDraft({
  clientId,
  reportId,
  start,
}: {
  clientId: string;
  /** An existing draft to open, or null to start `start`. */
  reportId: string | null;
  /** What a new draft starts as. Read once. */
  start: QeegContent | null;
}): QeegDraft {
  const { apiFetch } = useAuth();
  const [content, setContent] = useState<QeegContent | null>(reportId === null ? start : null);
  const [savedId, setSavedId] = useState<string | null>(reportId);
  const [loading, setLoading] = useState(reportId !== null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the saves read. Written only in handlers and callbacks, never while
  // rendering: a save runs after the render that scheduled it.
  const contentRef = useRef<QeegContent | null>(reportId === null ? start : null);
  const idRef = useRef<string | null>(reportId);
  const savedAtRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const staleRef = useRef(false);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(point: RestPoint) => Promise<boolean>>(async () => false);
  /** The form is on screen. Once it is gone, a change arms no timer. */
  const aliveRef = useRef(true);
  /** She chose to leave without saving: nothing more is sent for this form. */
  const discardedRef = useRef(false);

  const read = useCallback(
    async (id: string): Promise<Loaded> => {
      try {
        const res = await apiFetch(`/api/reports/${id}`);
        if (!res.ok) return null;
        const body = ReportResponse.parse(await res.json());
        const checked = validateQeegContent(body.content);
        if (!checked.ok) return null;
        return { content: checked.content, savedAt: body.savedAt ?? null };
      } catch {
        return null;
      }
    },
    [apiFetch],
  );

  /** Takes a version read from the server as what is on screen, and as saved. */
  const settle = useCallback((loaded: NonNullable<Loaded>) => {
    contentRef.current = loaded.content;
    savedAtRef.current = loaded.savedAt;
    savedVersionRef.current = versionRef.current;
    staleRef.current = false;
    setContent(loaded.content);
    setDirty(false);
    setStale(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (reportId === null) return;
    let live = true;
    void read(reportId).then((loaded) => {
      if (!live) return;
      setLoading(false);
      if (loaded === null) {
        setError('That draft could not be opened.');
        return;
      }
      settle(loaded);
    });
    return () => {
      live = false;
    };
  }, [read, reportId, settle]);

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const send = useCallback(
    async (point: RestPoint): Promise<boolean> => {
      const now = contentRef.current;
      if (now === null) return false;
      const version = versionRef.current;
      const id = idRef.current;
      setSaving(true);
      try {
        const res = await apiFetch('/api/reports/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-reason': SAVE_REASONS[point] },
          body: JSON.stringify({
            ...(id === null ? { locale: 'en' } : { id, savedAt: savedAtRef.current }),
            clientId,
            kind: 'qeeg',
            content: requestBody(now),
          }),
        });
        if (!res.ok) {
          const body: unknown = await res.json().catch(() => null);
          const refusal = refusalSentence(res.status, body);
          const code =
            typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null;
          if (res.status === 409 && code === 'stale_draft') {
            staleRef.current = true;
            setStale(true);
            clearTimer();
          }
          setError(refusal);
          return false;
        }
        const saved = QeegDraftResponse.parse(await res.json());
        idRef.current = saved.report.id;
        savedAtRef.current = saved.savedAt;
        savedVersionRef.current = version;
        setSavedId(saved.report.id);
        const checked = validateQeegContent(saved.content);
        const current = contentRef.current;
        if (checked.ok && current !== null) {
          const merged = withServerParts(current, checked.content);
          contentRef.current = merged;
          setContent(merged);
        }
        setDirty(versionRef.current !== version);
        setError(null);
        return true;
      } catch {
        setError(refusalSentence(0, null));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [apiFetch, clientId],
  );

  const save = useCallback(
    async (point: RestPoint): Promise<boolean> => {
      // One at a time: wait for the save on its way, then ask again.
      while (inFlightRef.current !== null) await inFlightRef.current;
      if (staleRef.current || discardedRef.current) return false;
      const changed = versionRef.current !== savedVersionRef.current;
      // Nothing changed: nothing to write. The Save button still creates a
      // draft nobody has touched, because pressing it asks for one.
      if (!changed && (idRef.current !== null || point !== 'button')) return true;
      if (point !== 'idle') clearTimer();
      const saving = send(point);
      inFlightRef.current = saving;
      try {
        return await saving;
      } finally {
        inFlightRef.current = null;
      }
    },
    [send],
  );

  // A map's door moves the draft's stamp (brief L, "For PR 7"), so it runs as
  // a save does: after the save on its way, with none beside it, and its
  // answer becomes the stamp the next save is made over. A draft with changes
  // is saved first (section 15: "before an upload"), so the draft on the
  // server is the one the picture joins.
  const withSaved = useCallback(
    async (point: RestPoint, door: (reportId: string) => Promise<string | null>) => {
      while (inFlightRef.current !== null) await inFlightRef.current;
      if (staleRef.current) return false;
      const changed = versionRef.current !== savedVersionRef.current;
      if (changed || idRef.current === null) {
        clearTimer();
        const saving = send(point);
        inFlightRef.current = saving;
        try {
          if (!(await saving)) return false;
        } finally {
          inFlightRef.current = null;
        }
      }
      const id = idRef.current;
      if (id === null) return false;
      const running = door(id)
        .then((stamp) => {
          if (stamp !== null) savedAtRef.current = stamp;
          return true;
        })
        // The door ran, whatever it threw: it says what happened itself
        // (`useQeegMaps` catches its own faults and gives them a sentence).
        // Caught here only so a save waiting behind it is never left hanging.
        .catch(() => true);
      inFlightRef.current = running;
      try {
        return await running;
      } finally {
        inFlightRef.current = null;
      }
    },
    [send],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const edit = useCallback((change: (content: QeegContent) => QeegContent) => {
    const was = contentRef.current;
    if (was === null) return;
    const next = change(was);
    // A change that changes nothing is not one: no version, no timer.
    if (next === was) return;
    contentRef.current = next;
    versionRef.current += 1;
    setContent(next);
    setDirty(true);
    clearTimer();
    // A form that is gone saves once on leaving, or not at all, never on a
    // timer: a change landing after it closed (a door's answer) is picked up
    // by that leave save, which waits for the door.
    if (!staleRef.current && aliveRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void saveRef.current('idle');
      }, IDLE_MS);
    }
  }, []);

  const reload = useCallback(async () => {
    const id = idRef.current;
    if (id === null) return;
    const loaded = await read(id);
    if (loaded === null) {
      setError('The newer version could not be loaded. Try again.');
      return;
    }
    clearTimer();
    settle(loaded);
  }, [read, settle]);

  const discard = useCallback(() => {
    discardedRef.current = true;
    clearTimer();
    savedVersionRef.current = versionRef.current;
    setDirty(false);
  }, []);

  // Closing the browser tab with unsaved changes asks first; the browser
  // cannot wait for a save while it closes. `returnValue` is what older
  // Safari reads.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Leaving the form by any other way (the drawer closed, the tab changed)
  // is a rest point too.
  // A door on its way when the form closes may still change the draft (the
  // map it filed is named in it), so the leave save is asked for then too; it
  // waits for the door and sends only if something changed.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimer();
      const changed = versionRef.current !== savedVersionRef.current;
      if ((changed || inFlightRef.current !== null) && !staleRef.current && !discardedRef.current) {
        void saveRef.current('leave');
      }
    };
  }, []);

  return {
    content,
    reportId: savedId,
    loading,
    saving,
    dirty,
    stale,
    error,
    edit,
    save,
    reload,
    discard,
    withSaved,
  };
}
