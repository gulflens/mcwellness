import { useId, useMemo, useState } from 'react';
import { Button, Field } from '../Controls';
import { DateField } from '../DateField';
import {
  BLANK,
  cleanFilter,
  distinctValues,
  type ColumnFilter,
  type ControlledColumn,
} from './layout';
import { Popover } from './Popover';

/**
 * One column's menu, opened from its header (the spreadsheet's drop-down):
 * the filter that column offers, then moving it and hiding it. A filter is
 * applied with Apply and taken off with Clear; nothing changes the table
 * while the person is still choosing.
 */
export function ColumnMenu<Row>({
  anchor,
  column,
  rows,
  filter,
  onApply,
  canHide,
  onHide,
  canMoveBack,
  canMoveForward,
  onMove,
  onResize,
  onClose,
}: {
  anchor: HTMLElement;
  column: ControlledColumn<Row>;
  /** The rows the other columns' filters leave, so the checklist lists what is there. */
  rows: readonly Row[];
  filter: ColumnFilter | undefined;
  onApply: (filter: ColumnFilter | null) => void;
  canHide: boolean;
  onHide: () => void;
  canMoveBack: boolean;
  canMoveForward: boolean;
  /** -1 towards the start of the row, +1 towards the end. */
  onMove: (step: -1 | 1) => void;
  /** Pixels narrower (negative) or wider; 0 fits the column to what it holds. */
  onResize: (by: number) => void;
  onClose: () => void;
}) {
  return (
    <Popover
      anchor={anchor}
      label={`${column.header} column`}
      onClose={onClose}
      className="column-menu"
    >
      <p className="column-menu__title">{column.header}</p>
      {column.filter && column.value ? (
        <FilterEditor
          column={column}
          rows={rows}
          filter={filter}
          onApply={(next) => {
            onApply(next);
            onClose();
          }}
        />
      ) : null}
      <div className="column-menu__actions" role="group" aria-label="Width">
        <Button variant="quiet" onClick={() => onResize(-32)}>
          Narrower
        </Button>
        <Button variant="quiet" onClick={() => onResize(32)}>
          Wider
        </Button>
        <Button variant="quiet" onClick={() => onResize(0)}>
          Fit to contents
        </Button>
      </div>
      <div className="column-menu__actions">
        <Button variant="quiet" disabled={!canMoveBack} onClick={() => onMove(-1)}>
          Move back
        </Button>
        <Button variant="quiet" disabled={!canMoveForward} onClick={() => onMove(1)}>
          Move forward
        </Button>
        {canHide ? (
          <Button
            variant="quiet"
            onClick={() => {
              onHide();
              onClose();
            }}
          >
            Hide column
          </Button>
        ) : null}
      </div>
    </Popover>
  );
}

function FilterEditor<Row>({
  column,
  rows,
  filter,
  onApply,
}: {
  column: ControlledColumn<Row>;
  rows: readonly Row[];
  filter: ColumnFilter | undefined;
  onApply: (filter: ColumnFilter | null) => void;
}) {
  const id = useId();
  const kind = column.filter;
  const [contains, setContains] = useState(filter?.kind === 'text' ? filter.contains : '');
  const [min, setMin] = useState(
    filter?.kind === 'range' && filter.min !== undefined ? String(filter.min) : '',
  );
  const [max, setMax] = useState(
    filter?.kind === 'range' && filter.max !== undefined ? String(filter.max) : '',
  );
  const [from, setFrom] = useState(filter?.kind === 'dates' ? (filter.from ?? '') : '');
  const [to, setTo] = useState(filter?.kind === 'dates' ? (filter.to ?? '') : '');
  const all = useMemo(() => distinctValues(rows, column), [rows, column]);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(filter?.kind === 'values' ? filter.values : all),
  );
  const [search, setSearch] = useState('');
  const shown = all.filter((v) => v.toLowerCase().includes(search.trim().toLowerCase()));

  function build(): ColumnFilter | null {
    if (kind === 'values') {
      // Everything ticked keeps everything: no filter at all.
      if (all.every((v) => ticked.has(v))) return null;
      return { kind: 'values', values: all.filter((v) => ticked.has(v)) };
    }
    if (kind === 'text') return cleanFilter({ kind: 'text', contains }, column);
    if (kind === 'number') {
      const n = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));
      return cleanFilter({ kind: 'range', min: n(min), max: n(max) }, column);
    }
    return cleanFilter({ kind: 'dates', from: from || undefined, to: to || undefined }, column);
  }

  return (
    <form
      className="column-menu__filter"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(build());
      }}
    >
      {kind === 'values' ? (
        <>
          {all.length > 8 ? (
            <Field
              id={`${id}-search`}
              label="Find a value"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}
          <fieldset className="column-menu__values">
            <legend className="visually-hidden">Show rows whose {column.header} is</legend>
            <label className="column-menu__value column-menu__value--all">
              <input
                type="checkbox"
                checked={all.every((v) => ticked.has(v))}
                ref={(el) => {
                  if (el) el.indeterminate = ticked.size > 0 && !all.every((v) => ticked.has(v));
                }}
                onChange={(e) => setTicked(new Set(e.target.checked ? all : []))}
              />
              <span>Select all</span>
            </label>
            <div className="column-menu__list">
              {shown.map((value) => (
                <label key={value} className="column-menu__value">
                  <input
                    type="checkbox"
                    checked={ticked.has(value)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(value);
                      else next.delete(value);
                      setTicked(next);
                    }}
                  />
                  <span className={value === BLANK ? 'muted' : undefined}>{value}</span>
                </label>
              ))}
              {shown.length === 0 ? <p className="small muted">No value matches.</p> : null}
            </div>
          </fieldset>
        </>
      ) : null}
      {kind === 'text' ? (
        <Field
          id={`${id}-contains`}
          label="Contains"
          value={contains}
          autoComplete="off"
          onChange={(e) => setContains(e.target.value)}
        />
      ) : null}
      {kind === 'number' ? (
        <div className="column-menu__pair">
          <Field
            id={`${id}-min`}
            label="At least"
            inputMode="decimal"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <Field
            id={`${id}-max`}
            label="At most"
            inputMode="decimal"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </div>
      ) : null}
      {kind === 'date' ? (
        <div className="column-menu__pair">
          <DateField id={`${id}-from`} label="From" value={from} onChange={setFrom} />
          <DateField id={`${id}-to`} label="To" value={to} onChange={setTo} />
        </div>
      ) : null}
      <div className="column-menu__apply">
        <Button variant="primary" type="submit" disabled={kind === 'values' && ticked.size === 0}>
          Apply
        </Button>
        <Button variant="secondary" type="button" disabled={!filter} onClick={() => onApply(null)}>
          Clear filter
        </Button>
      </div>
    </form>
  );
}
