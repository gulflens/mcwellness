import { useState } from 'react';
import { Button } from '../Controls';
import type { ColumnLayout, ControlledColumn } from './layout';
import { Popover } from './Popover';

/**
 * The table's Columns list: tick a column to show it, untick to hide it, drag
 * a row (or use its arrows) to change the order, Show all to bring every
 * column back, and Reset to return to the screen's own layout and widths.
 */
export function ColumnsPanel<Row>({
  anchor,
  columns,
  layout,
  onToggle,
  onShowAll,
  onMove,
  onReset,
  onClose,
}: {
  anchor: HTMLElement;
  columns: readonly ControlledColumn<Row>[];
  layout: ColumnLayout;
  onToggle: (key: string, show: boolean) => void;
  onShowAll: () => void;
  onMove: (key: string, toIndex: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = layout.order.map((k) => byKey.get(k)).filter((c) => c !== undefined);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const shownCount = ordered.filter((c) => !layout.hidden.includes(c.key)).length;

  return (
    <Popover anchor={anchor} label="Columns" onClose={onClose} className="columns-panel">
      <p className="column-menu__title">Columns</p>
      <ul className="columns-panel__list" aria-label="Columns, in order">
        {ordered.map((column, index) => {
          const shown = !layout.hidden.includes(column.key);
          const locked = column.hideable === false || (shown && shownCount === 1);
          return (
            <li
              key={column.key}
              className={[
                'columns-panel__row',
                dragging === column.key ? 'columns-panel__row--dragging' : null,
                over === column.key && dragging !== column.key ? 'columns-panel__row--over' : null,
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(event) => {
                setDragging(column.key);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', column.key);
              }}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                setOver(column.key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dragging !== column.key) onMove(dragging, index);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <span className="columns-panel__grip" aria-hidden="true">
                <svg width="12" height="20" viewBox="0 0 12 20" focusable="false">
                  <circle cx="4" cy="6" r="1.25" fill="currentColor" />
                  <circle cx="8" cy="6" r="1.25" fill="currentColor" />
                  <circle cx="4" cy="10" r="1.25" fill="currentColor" />
                  <circle cx="8" cy="10" r="1.25" fill="currentColor" />
                  <circle cx="4" cy="14" r="1.25" fill="currentColor" />
                  <circle cx="8" cy="14" r="1.25" fill="currentColor" />
                </svg>
              </span>
              <label className="columns-panel__label">
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={locked}
                  onChange={(event) => onToggle(column.key, event.target.checked)}
                />
                <span>{column.header}</span>
              </label>
              <span className="columns-panel__arrows">
                <button
                  type="button"
                  className="columns-panel__arrow"
                  disabled={index === 0}
                  aria-label={`Move ${column.header} up`}
                  onClick={() => onMove(column.key, index - 1)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M4 10l4-4 4 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="columns-panel__arrow"
                  disabled={index === ordered.length - 1}
                  aria-label={`Move ${column.header} down`}
                  onClick={() => onMove(column.key, index + 1)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M4 6l4 4 4-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="column-menu__apply">
        <Button variant="secondary" disabled={layout.hidden.length === 0} onClick={onShowAll}>
          Show all
        </Button>
        <Button variant="quiet" onClick={onReset}>
          Reset layout
        </Button>
      </div>
    </Popover>
  );
}
