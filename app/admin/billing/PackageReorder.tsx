import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PackageRow } from '../../api/billing/ledger-schema';
import { formatFils } from './money';

/**
 * The packages' order, set by holding a package and carrying it to its place
 * (operator, 20 October 2026). It replaced a Move up and a Move down on every
 * tile: the order is set now and then, the tiles are used every day, so the
 * order has a board of its own behind one Reorder button.
 *
 * The board shows every package at once, small, in rows that wrap: on a phone
 * a sliding row would fight the finger that is carrying a package along it.
 * The others make way as the held one passes over them. Letting go saves the
 * whole order in one request (`POST /api/billing/packages/reorder`).
 *
 * A keyboard does the same with the arrow keys on a focused package, one
 * place a press, and the live region says where it landed.
 */
export function PackageReorder({
  rows,
  saving,
  onReorder,
}: {
  rows: readonly PackageRow[];
  saving: boolean;
  onReorder: (order: string[]) => void;
}) {
  // The order as the section has it, except while a package is in the hand:
  // then the board's own draft, which the others make way in. Letting go hands
  // the draft to the section, which shows it at once and saves it.
  const [held, setHeld] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const byId = new Map(rows.map((row) => [row.id, row]));
  const saved = rows.map((row) => row.id);
  const order = draft ?? saved;

  function moveTo(id: string, index: number, list: readonly string[]): string[] {
    const next = list.filter((other) => other !== id);
    next.splice(index, 0, id);
    return next;
  }

  function pickUp(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (saving || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraft(saved);
    setHeld(id);
  }

  function carry(event: PointerEvent<HTMLButtonElement>) {
    if (held === null) return;
    // The package under the pointer gives up its place; the held one is not
    // hit-tested against itself, so it stays put until it passes another.
    const under = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-reorder-id]');
    const target = under?.dataset.reorderId;
    if (!target || target === held) return;
    setDraft((current) => (current ? moveTo(held, current.indexOf(target), current) : current));
  }

  function letGo() {
    if (held === null) return;
    const name = byId.get(held)?.name ?? '';
    const landed = order.indexOf(held);
    setHeld(null);
    setDraft(null);
    if (order.join() !== saved.join()) {
      setAnnouncement(`${name} moved to position ${landed + 1} of ${order.length}.`);
      onReorder(order);
    }
  }

  function cancel() {
    if (held === null) return;
    setDraft(null);
    setHeld(null);
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (step === undefined || saving) return;
    event.preventDefault();
    const from = order.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= order.length) return;
    const next = moveTo(id, to, order);
    setAnnouncement(`${byId.get(id)?.name ?? ''} moved to position ${to + 1} of ${next.length}.`);
    onReorder(next);
    // The card is the same element in its new place; keep the focus on it.
    requestAnimationFrame(() => cards.current.get(id)?.focus());
  }

  return (
    <div className="reorder">
      <p className="small muted reorder__hint">
        Hold a package and drag it to its place. With a keyboard, use the arrow keys.
      </p>
      <ol className="reorder__board" aria-label="Packages order">
        {order.map((id, index) => {
          const row = byId.get(id);
          if (!row) return null;
          return (
            <li key={id}>
              <button
                type="button"
                ref={(element) => {
                  if (element) cards.current.set(id, element);
                  else cards.current.delete(id);
                }}
                className={`reorder__card${held === id ? ' reorder__card--held' : ''}`}
                data-reorder-id={id}
                aria-label={`${row.name}, position ${index + 1} of ${order.length}`}
                aria-disabled={saving || undefined}
                onPointerDown={(event) => pickUp(event, id)}
                onPointerMove={carry}
                onPointerUp={letGo}
                onPointerCancel={cancel}
                onKeyDown={(event) => nudge(event, id)}
              >
                <span className="reorder__grip" aria-hidden="true">
                  <GripIcon />
                </span>
                <span className="reorder__place numeric" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="reorder__name">{row.name}</span>
                {row.currentPrice ? (
                  <span className="small muted numeric reorder__price">
                    AED {formatFils(row.currentPrice.grossFils)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}

/** Six dots: the mark that says "this can be picked up". */
function GripIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      {[6, 10, 14].flatMap((y) => [
        <circle key={`l${y}`} cx="7.5" cy={y} r="1.25" />,
        <circle key={`r${y}`} cx="12.5" cy={y} r="1.25" />,
      ])}
    </svg>
  );
}
