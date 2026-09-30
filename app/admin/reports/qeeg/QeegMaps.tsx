import { useEffect, useRef, useState } from 'react';
import {
  choosePair,
  labelMap,
  mapsInOrder,
  moveMap,
  placeMap,
  type ListedMap,
} from '../../../../domain/reports/qeeg/maps';
import { validateQeegContent } from '../../../../domain/reports/qeeg/shape';
import {
  CONDITIONS,
  LIMITS,
  type Condition,
  type FigureRef,
  type QeegContent,
  type QeegFollowUp,
} from '../../../../domain/reports/qeeg/types';
import { ReportResponse } from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { ArabicVersionField } from './atoms/ArabicVersionField';
import { Button, Note, Select } from '../../../shell/components/Controls';
import { DocumentLink } from '../../clients/DocumentLink';
import type { QeegMaps } from './useQeegMaps';

/**
 * The brain maps on the form: the report's own section of them, and the
 * before-and-after pairs on a follow-up's page of what has changed
 * (docs/SPEC/reports-qeeg.md sections 9, 10 and 15).
 *
 * **A table, because the maps are alike**: each row is one picture, its place,
 * what it was recorded with, and its size in pixels, with the actions at the
 * end (docs/DESIGN-BRIEF.md: tables for homogeneous data). A map chosen in
 * this sitting shows the pixels she chose; one saved before is opened on
 * request through the record's own document link, because opening it is a
 * read the trail records.
 *
 * **Placing is the content's**, through `domain/reports/qeeg/maps.ts`: the
 * condition, her own label where there is none, and the order the maps print
 * in. The door filed each picture with the condition and place it was sent
 * with, and never changes a filing; what prints is what the draft names.
 *
 * **Removing asks first, in the form**, never with the browser's own dialog:
 * the row says what will happen and offers to keep it.
 *
 * **The pairs name pictures and nothing else.** The before side offers the
 * maps of the report this one is compared with, read from that report; the
 * route borrows the one chosen when the draft is saved. The after side offers
 * this report's own. No figure is typed here, and none is read from a picture
 * (section 10, point 3).
 */

type Edit = (change: (content: QeegContent) => QeegContent) => void;

/** The console's own words for a condition: English, as every staff screen is. */
const CONDITION_LABELS: Readonly<Record<Condition, string>> = Object.freeze({
  eyes_closed: 'Eyes closed',
  eyes_open: 'Eyes open',
});

/** Closed first, as the practice lays a montage out. */
const CONDITION_ORDER: readonly Condition[] = ['eyes_closed', 'eyes_open'];

function conditionOf(value: string): Condition | null {
  return (CONDITIONS as readonly string[]).includes(value) ? (value as Condition) : null;
}

function sizeWords(widthPx: number, heightPx: number): string {
  return `${widthPx} × ${heightPx} pixels`;
}

/** A map as a choice in a list: its place, what it shows, its size. */
function mapWords({ entry }: ListedMap): string {
  const shows =
    entry.condition !== null
      ? CONDITION_LABELS[entry.condition].toLowerCase()
      : (entry.caption?.en ?? 'another view with no label yet');
  return `Map ${entry.position + 1}, ${shows}, ${sizeWords(entry.widthPx, entry.heightPx)}`;
}

/** Where focus goes once the form has drawn what a press changed. */
type FocusNext =
  | { to: 'file' }
  | { to: 'panel' }
  | { to: 'remove'; figureId: string }
  | { to: 'removed'; index: number }
  | { to: 'moved'; figureId: string; by: -1 | 1 };

/** The control that should hold focus after `next`, found in the section's own area. */
function focusTarget(
  next: FocusNext,
  area: HTMLElement | null,
  file: HTMLElement | null,
): HTMLElement | null {
  const find = (selector: string) => area?.querySelector<HTMLElement>(selector) ?? null;
  switch (next.to) {
    case 'file':
      return file;
    case 'panel':
      return find('[data-confirm]');
    case 'remove':
      return find(`[data-remove="${next.figureId}"]`);
    case 'removed': {
      const buttons = area ? Array.from(area.querySelectorAll<HTMLElement>('[data-remove]')) : [];
      return buttons[Math.min(next.index, buttons.length - 1)] ?? file;
    }
    case 'moved': {
      const same = find(`[data-move="${next.figureId}:${next.by}"]`);
      const other = find(`[data-move="${next.figureId}:${-next.by}"]`);
      return same instanceof HTMLButtonElement && !same.disabled ? same : other;
    }
    default: {
      const unknown: never = next;
      return unknown;
    }
  }
}

/** The console's words for a map with no condition: her label names it instead. */
const ANOTHER_VIEW = 'Another view, with a label';

export function MapsSection({
  clientId,
  content,
  edit,
  maps,
}: {
  clientId: string;
  content: QeegContent;
  edit: Edit;
  maps: QeegMaps;
}) {
  const listed = mapsInOrder(content);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Where focus goes next, and a count that asks the effect below to move it.
  const focusNextRef = useRef<FocusNext | null>(null);
  const [focusAsked, setFocusAsked] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = maps.busy !== null;
  const setFocusNext = (next: FocusNext) => {
    focusNextRef.current = next;
    setFocusAsked((was) => was + 1);
  };

  // The draft's uploaded pictures are read each time the section opens: an
  // upload from another tab, or one left behind when a form closed, shows.
  const { refresh } = maps;
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Focus is moved once the change is drawn and the control is enabled
  // again: a button that has just gone, or just been disabled, drops focus to
  // the page, and she would have to find her place again.
  useEffect(() => {
    const next = focusNextRef.current;
    if (next === null || busy) return;
    focusNextRef.current = null;
    focusTarget(next, areaRef.current, fileRef.current)?.focus();
  }, [focusAsked, busy]);

  const status =
    maps.busy === 'preparing'
      ? 'Preparing the map.'
      : maps.busy === 'uploading'
        ? 'Uploading the map.'
        : maps.busy === 'removing'
          ? 'Removing the map.'
          : '';

  return (
    <div ref={areaRef}>
      <p className="small muted">
        Each map is prepared here before it is sent: a plain white border is trimmed and it is saved
        as a PNG without transparency. A map is never shrunk: one wider or taller than 4,096 pixels,
        over 12 million pixels or over 5 MB is refused. A report holds up to {LIMITS.maps}. A map is
        named on the page by the condition it was recorded under, or by your own label.
      </p>

      {listed.length > 0 ? (
        <div className="ledger__scroll">
          <table className="ledger qeeg-maps">
            <caption className="visually-hidden">Brain maps on this report</caption>
            <thead>
              <tr>
                <th scope="col">Map</th>
                <th scope="col">Recorded with</th>
                <th scope="col">Size</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((item, index) => {
                const { entry } = item;
                const n = index + 1;
                const thumbnail = maps.thumbnails[entry.figureId];
                return (
                  <tr key={item.key}>
                    <td>
                      <p className="qeeg-maps__place">Map {n}</p>
                      {thumbnail ? (
                        <img
                          className="qeeg-maps__thumb"
                          src={thumbnail}
                          alt={`Map ${n}, as chosen`}
                        />
                      ) : (
                        <DocumentLink
                          clientId={clientId}
                          documentId={entry.figureId}
                          label={`Open map ${n}`}
                        />
                      )}
                    </td>
                    <td>
                      <select
                        className="field__input"
                        aria-label={`Recorded with, map ${n}`}
                        value={entry.condition ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          const next = conditionOf(event.currentTarget.value);
                          edit((was) => placeMap(was, entry.figureId, next, entry.caption));
                        }}
                      >
                        {CONDITION_ORDER.map((value) => (
                          <option key={value} value={value}>
                            {CONDITION_LABELS[value]}
                          </option>
                        ))}
                        <option value="">{ANOTHER_VIEW}</option>
                      </select>
                      {entry.condition === null ? (
                        <input
                          className="field__input"
                          aria-label={`Label, map ${n}`}
                          maxLength={LIMITS.caption}
                          value={entry.caption?.en ?? ''}
                          onChange={(event) => {
                            const text = event.currentTarget.value;
                            edit((was) => labelMap(was, entry.figureId, text));
                          }}
                        />
                      ) : null}
                      {entry.condition === null && entry.caption !== null ? (
                        <ArabicVersionField
                          id={`qeeg-map-${entry.figureId}-label-ar`}
                          of={`the label of map ${n}`}
                          value={entry.caption.ar}
                          most={LIMITS.caption}
                          onChange={(ar) =>
                            edit((was) => {
                              const at = Object.values(was.maps).find(
                                (each) => each.figureId === entry.figureId,
                              );
                              if (!at || at.caption === null) return was;
                              return placeMap(was, entry.figureId, at.condition, {
                                ...at.caption,
                                ar,
                              });
                            })
                          }
                        />
                      ) : null}
                    </td>
                    <td className="numeric">{sizeWords(entry.widthPx, entry.heightPx)}</td>
                    <td>
                      <div className="qeeg-maps__actions">
                        <Button
                          variant="quiet"
                          disabled={busy || index === 0}
                          aria-label={`Move map ${n} earlier`}
                          data-move={`${entry.figureId}:-1`}
                          onClick={() => {
                            edit((was) => moveMap(was, entry.figureId, -1));
                            setFocusNext({ to: 'moved', figureId: entry.figureId, by: -1 });
                          }}
                        >
                          Earlier
                        </Button>
                        <Button
                          variant="quiet"
                          disabled={busy || index === listed.length - 1}
                          aria-label={`Move map ${n} later`}
                          data-move={`${entry.figureId}:1`}
                          onClick={() => {
                            edit((was) => moveMap(was, entry.figureId, 1));
                            setFocusNext({ to: 'moved', figureId: entry.figureId, by: 1 });
                          }}
                        >
                          Later
                        </Button>
                        <Button
                          variant="quiet"
                          disabled={busy}
                          aria-label={`Remove map ${n}`}
                          data-remove={entry.figureId}
                          onClick={() => {
                            setConfirming(entry.figureId);
                            setFocusNext({ to: 'panel' });
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      {confirming === entry.figureId ? (
                        <ConfirmRemove
                          question={`Remove map ${n} from the report? The draft is saved without it, and the picture is deleted.`}
                          busy={busy}
                          onRemove={() => {
                            setConfirming(null);
                            void maps
                              .remove(entry.figureId)
                              .then(() => setFocusNext({ to: 'removed', index }));
                          }}
                          onKeep={() => {
                            setConfirming(null);
                            setFocusNext({ to: 'remove', figureId: entry.figureId });
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {maps.unplaced.length > 0 ? (
        <div className="ledger__scroll">
          <table className="ledger qeeg-maps">
            <caption className="visually-hidden">Uploaded, not on the report</caption>
            <thead>
              <tr>
                <th scope="col">Uploaded, not on the report</th>
                <th scope="col">Size</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {maps.unplaced.map((link, index) => {
                const n = index + 1;
                return (
                  <tr key={link.figureId}>
                    <td>
                      <p className="qeeg-maps__place">Uploaded picture {n}</p>
                      <DocumentLink
                        clientId={clientId}
                        documentId={link.figureId}
                        label={`Open uploaded picture ${n}`}
                      />
                    </td>
                    <td className="numeric">{sizeWords(link.widthPx, link.heightPx)}</td>
                    <td>
                      <div className="qeeg-maps__actions">
                        <Button
                          variant="quiet"
                          disabled={busy || listed.length >= LIMITS.maps}
                          aria-label={`Place uploaded picture ${n}`}
                          onClick={() => {
                            maps.place(link.figureId, condition);
                            setFocusNext({ to: 'removed', index });
                          }}
                        >
                          Place
                        </Button>
                        <Button
                          variant="quiet"
                          disabled={busy}
                          aria-label={`Remove uploaded picture ${n}`}
                          data-remove={link.figureId}
                          onClick={() => {
                            setConfirming(link.figureId);
                            setFocusNext({ to: 'panel' });
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      {confirming === link.figureId ? (
                        <ConfirmRemove
                          question={`Remove uploaded picture ${n}? It is not on the report, and the picture is deleted.`}
                          busy={busy}
                          onRemove={() => {
                            setConfirming(null);
                            void maps
                              .remove(link.figureId)
                              .then(() => setFocusNext({ to: 'removed', index }));
                          }}
                          onKeep={() => {
                            setConfirming(null);
                            setFocusNext({ to: 'remove', figureId: link.figureId });
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            These were uploaded to this draft and are not on the report. Each counts toward the{' '}
            {LIMITS.maps} a report holds until it is placed or removed. Place puts it at the end of
            the maps, recorded with what is chosen under Add a map.
          </p>
        </div>
      ) : null}
      {maps.listError ? <Note tone="critical">{maps.listError}</Note> : null}

      <fieldset className="qeeg-item">
        <legend className="qeeg-item__title">Add a map</legend>
        <Select
          id="qeeg-map-condition"
          label="Recorded with"
          value={condition ?? ''}
          disabled={busy}
          onChange={(event) => setCondition(conditionOf(event.currentTarget.value))}
        >
          {CONDITION_ORDER.map((value) => (
            <option key={value} value={value}>
              {CONDITION_LABELS[value]}
            </option>
          ))}
          <option value="">{ANOTHER_VIEW}</option>
        </Select>
        <div className="field">
          <label className="field__label" htmlFor="qeeg-map-file">
            Choose a brain map
          </label>
          <input
            ref={fileRef}
            id="qeeg-map-file"
            className="field__input"
            type="file"
            accept={MAP_FILE_TYPES}
            disabled={busy}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              // Emptied, so the same file can be chosen again.
              input.value = '';
              if (file) void maps.add(file, condition).then(() => setFocusNext({ to: 'file' }));
            }}
          />
        </div>
      </fieldset>

      {/* Always here, so what it says is announced when it changes. */}
      <p id="qeeg-maps-status" className="small" role="status">
        {status}
      </p>
      {maps.error ? (
        <div role="alert">
          <Note tone="critical">{maps.error}</Note>
        </div>
      ) : null}
      {maps.notice ? <p className="small">{maps.notice}</p> : null}
    </div>
  );
}

/** Asking inside the form before a picture is deleted, never with the browser's own dialog. */
function ConfirmRemove({
  question,
  busy,
  onRemove,
  onKeep,
}: {
  question: string;
  busy: boolean;
  onRemove: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="qeeg-maps__confirm"
      role="group"
      aria-label="Remove a map"
      tabIndex={-1}
      data-confirm
    >
      <p>{question}</p>
      <div className="report-editor__actions">
        <Button variant="primary" disabled={busy} onClick={onRemove}>
          Remove the map
        </Button>
        <Button variant="quiet" onClick={onKeep}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/** What the file control offers: the kinds the `undecodable` sentence names. */
const MAP_FILE_TYPES = 'image/png,image/jpeg,image/bmp';

// ---------------------------------------------------------------------------
// A follow-up's pairs
// ---------------------------------------------------------------------------

type Earlier = { state: 'loading' } | { state: 'ready'; maps: ListedMap[] } | { state: 'failed' };

/** The maps of the report a follow-up is compared with, read from that report. */
function useEarlierMaps(reportId: string): Earlier {
  const { apiFetch } = useAuth();
  // Kept with the report it was read for, so choosing another shows loading
  // until that one is read, with no state set inside the effect itself.
  const [read, setRead] = useState<{ reportId: string; earlier: Earlier } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      let earlier: Earlier;
      try {
        const res = await apiFetch(`/api/reports/${reportId}`);
        if (!res.ok) throw new Error('not read');
        const checked = validateQeegContent(ReportResponse.parse(await res.json()).content);
        if (!checked.ok) throw new Error('not a brain map');
        earlier = { state: 'ready', maps: mapsInOrder(checked.content) };
      } catch {
        earlier = { state: 'failed' };
      }
      if (live) setRead({ reportId, earlier });
    })();
    return () => {
      live = false;
    };
  }, [apiFetch, reportId]);
  return read !== null && read.reportId === reportId ? read.earlier : { state: 'loading' };
}

function refOf({ entry }: ListedMap): FigureRef {
  return {
    figureId: entry.figureId,
    sha256: entry.sha256,
    widthPx: entry.widthPx,
    heightPx: entry.heightPx,
  };
}

export function PairsField({ content, edit }: { content: QeegFollowUp; edit: Edit }) {
  const earlier = useEarlierMaps(content.comparedWith.reportId);
  const own = mapsInOrder(content);
  const earlierMaps = earlier.state === 'ready' ? earlier.maps : [];

  const side = (
    condition: Condition,
    which: 'earlier' | 'later',
    options: readonly ListedMap[],
  ) => {
    const chosen = content.change.pairs[condition][which];
    const known =
      chosen === null || options.some(({ entry }) => entry.figureId === chosen.figureId);
    return (
      <Select
        id={`qeeg-pair-${condition}-${which}`}
        label={`${CONDITION_LABELS[condition]}, ${which === 'earlier' ? 'before' : 'after'}`}
        value={chosen?.figureId ?? ''}
        onChange={(event) => {
          const id = event.currentTarget.value;
          const picked = options.find(({ entry }) => entry.figureId === id);
          edit((was) => choosePair(was, condition, which, picked ? refOf(picked) : null));
        }}
      >
        <option value="">None</option>
        {options.map((item) => (
          <option key={item.entry.figureId} value={item.entry.figureId}>
            {mapWords(item)}
          </option>
        ))}
        {known || chosen === null ? null : (
          <option value={chosen.figureId}>
            A map no longer offered, {sizeWords(chosen.widthPx, chosen.heightPx)}
          </option>
        )}
      </Select>
    );
  };

  return (
    <fieldset className="qeeg-item">
      <legend className="qeeg-item__title">Before and after</legend>
      <p className="small muted">
        Before is a map of the report this one is compared with. After is one of this report’s own
        maps, added under Brain maps. Either may be left empty.
      </p>
      {earlier.state === 'loading' ? (
        <p className="small muted">Reading the earlier maps.</p>
      ) : null}
      {earlier.state === 'failed' ? (
        <Note tone="critical">The earlier report’s maps could not be read. Try again later.</Note>
      ) : null}
      {earlier.state === 'ready' && earlierMaps.length === 0 ? (
        <p className="small muted">The earlier report holds no maps.</p>
      ) : null}
      {CONDITION_ORDER.map((condition) => (
        <div key={condition} className="qeeg-measure__figures">
          {side(condition, 'earlier', earlierMaps)}
          {side(condition, 'later', own)}
        </div>
      ))}
    </fieldset>
  );
}
