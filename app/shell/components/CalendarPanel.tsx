import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronIcon } from './Icons';
import {
  isoFromParts,
  monthGrid,
  openingDay,
  outsideBounds,
  placeCalendarPanel,
  shiftDays,
  shiftMonths,
  weekdayIndex,
  type Box,
  type DateParts,
} from './calendar';

/**
 * The calendar `DateField` opens, drawn in the page rather than borrowed from
 * the browser.
 *
 * **Why it exists.** The field used to keep a hidden `<input type="date">` and
 * call `showPicker()` on it. On Safari that picker opened off the right edge
 * of a right-docked drawer and was clipped, and it was grey browser chrome
 * that looked nothing like the rest of the console. A native picker's panel
 * has no CSS surface in any browser — it cannot be styled, resized or moved —
 * so there was nothing to fix and it had to go (the operator, 2026-09-13:
 * "the calendar open inward towards the browser window and not outside and
 * being clipped").
 *
 * **Why a portal and `position: fixed`.** The panel must not be clipped by the
 * drawer body's own `overflow`, and `position: absolute` inside the field
 * cannot escape it. Fixed positioning does, but only while no ancestor makes
 * itself a containing block — and `.drawer` carries a `translate` for its
 * 160ms entrance, which is exactly that for as long as it runs. Rendering into
 * `document.body` puts the panel out of reach of both.
 *
 * **Why the coordinates are written to the node rather than held in state.**
 * Measuring needs the panel in the DOM, so the placement can only be known
 * after the render that mounts it; storing it would be a `setState` inside an
 * effect, which this repository's lint rule refuses. A layout effect measures
 * and writes `top`/`left` straight onto the node before the browser paints, so
 * there is nothing to see and nothing to store.
 *
 * Nothing here uses the Popover API or CSS anchor positioning: Safari is the
 * browser this has to work in and it is behind on both.
 */

/** English only, like every other word on a staff screen, and never the machine's locale. */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Monday first: the working week of the country the practice is in. */
const WEEKDAYS = [
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
  { short: 'Sun', long: 'Sunday' },
] as const;

/** How a day reads aloud: the practice's own order, day before month. */
function dayName(parts: DateParts): string {
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export function CalendarPanel({
  label,
  value,
  today,
  min,
  max,
  field,
  trigger,
  onChoose,
  onDismiss,
}: {
  /** The field's own label, so the dialog says which date it is choosing. */
  label: string;
  /** The chosen day as stored, `YYYY-MM-DD`, or `''`. */
  value: string;
  /** Today, read from the clock when the calendar was opened. */
  today: DateParts;
  /** Bounds already checked to be real days; either may be `''`. */
  min: string;
  max: string;
  /** The field's box, for the inline edge the panel lines up with. */
  field: RefObject<HTMLElement | null>;
  /** The calendar button's box, for the row the panel opens from. */
  trigger: RefObject<HTMLElement | null>;
  onChoose: (iso: string) => void;
  /** Shuts the calendar; `true` puts focus back on the button that opened it. */
  onDismiss: (returnFocus: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<DateParts>(() => openingDay(value, today, min, max));

  // Set whenever a *keystroke* moved the focused day, so the roving tabindex
  // follows the keyboard into the grid without snatching focus away from the
  // month buttons when they are clicked with a mouse. True to begin with:
  // opening the calendar is what puts focus inside it.
  const wantsFocus = useRef(true);
  // Read off the node at placement time rather than guessed, and reused by the
  // arrow keys so left and right stay "previous day" and "next day" in Arabic.
  const inlineDirection = useRef<'ltr' | 'rtl'>('ltr');

  // Plain functions, deliberately not wrapped in useCallback: they read
  // `ref.current`, and the React Compiler refuses a manual memo whose inferred
  // dependency is a ref's contents rather than the ref itself
  // (react-hooks/preserve-manual-memoization). The effects below therefore
  // carry no dependency list and re-register their listeners on each render,
  // which is what keeps them from closing over a stale one.
  function measure(): Box | null {
    const fieldNode = field.current;
    const triggerNode = trigger.current;
    if (fieldNode === null || triggerNode === null) return null;
    const fieldBox = fieldNode.getBoundingClientRect();
    const triggerBox = triggerNode.getBoundingClientRect();
    // Inline edges from the field, block edges from the button: the field's
    // box runs from above its label to below its hint line, and the panel
    // should open from the input's own row.
    return {
      top: triggerBox.top,
      bottom: triggerBox.bottom,
      left: fieldBox.left,
      right: fieldBox.right,
    };
  }

  function place() {
    const node = panel.current;
    const anchor = measure();
    if (node === null || anchor === null) return;
    inlineDirection.current = getComputedStyle(node).direction === 'rtl' ? 'rtl' : 'ltr';
    const placed = placeCalendarPanel({
      anchor,
      panel: { width: node.offsetWidth, height: node.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      direction: inlineDirection.current,
    });
    node.style.top = `${placed.top}px`;
    node.style.left = `${placed.left}px`;
    node.dataset.side = placed.side;
  }

  // The panel changes height when the month it shows needs a sixth row, so it
  // is re-placed after every render. Two rect reads and two style writes,
  // before paint.
  useLayoutEffect(() => {
    place();
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    panel.current?.querySelector<HTMLElement>('[data-calendar-focus="true"]')?.focus();
  });

  // Re-placed rather than closed. The drawer body scrolls, and shutting the
  // calendar on every pixel of that would be hostile; the placement clamps the
  // panel inside the viewport, so re-measuring always leaves it whole and on
  // screen. Capture phase, because a scroll inside the drawer does not bubble
  // to the window.
  useEffect(() => {
    function reposition() {
      place();
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  });

  // A press anywhere else shuts it, without taking focus back — the person is
  // already on their way somewhere. The button itself is excluded so its own
  // click can toggle rather than close and reopen. Both events are listened
  // for: `pointerdown` is what a modern browser sends first, `mousedown` is
  // the floor under it, and shutting an already-shut calendar costs nothing.
  useEffect(() => {
    function onPressElsewhere(event: Event) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      onDismiss(false);
    }
    document.addEventListener('pointerdown', onPressElsewhere, true);
    document.addEventListener('mousedown', onPressElsewhere, true);
    return () => {
      document.removeEventListener('pointerdown', onPressElsewhere, true);
      document.removeEventListener('mousedown', onPressElsewhere, true);
    };
  });

  function moveFocus(next: DateParts) {
    wantsFocus.current = true;
    setFocused(next);
  }

  function choose(parts: DateParts) {
    const iso = isoFromParts(parts);
    if (outsideBounds(iso, min, max)) return;
    onChoose(iso);
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const back = inlineDirection.current === 'rtl' ? 1 : -1;
    const byDays: Record<string, number> = {
      ArrowLeft: back,
      ArrowRight: -back,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const days = byDays[event.key];
    if (days !== undefined) {
      event.preventDefault();
      moveFocus(shiftDays(focused, days));
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      moveFocus(shiftMonths(focused, event.key === 'PageUp' ? -1 : 1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const weekday = weekdayIndex(focused);
      moveFocus(shiftDays(focused, event.key === 'Home' ? -weekday : 6 - weekday));
    }
  }

  const monthLabel = `${MONTHS[focused.month - 1]} ${focused.year}`;
  const todayIso = isoFromParts(today);

  return createPortal(
    <div
      ref={panel}
      className="calendar"
      role="dialog"
      aria-label={`${label}: choose a date`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onDismiss(true);
      }}
    >
      <div className="calendar__head">
        <button
          type="button"
          className="calendar__step"
          aria-label="Previous month"
          onClick={() => setFocused(shiftMonths(focused, -1))}
        >
          <ChevronIcon className="calendar__chevron calendar__chevron--back" />
        </button>
        <div className="calendar__month">{monthLabel}</div>
        <button
          type="button"
          className="calendar__step"
          aria-label="Next month"
          onClick={() => setFocused(shiftMonths(focused, 1))}
        >
          <ChevronIcon className="calendar__chevron calendar__chevron--forward" />
        </button>
      </div>
      <div className="calendar__grid" role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown}>
        <div className="calendar__week" role="row">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday.long}
              role="columnheader"
              aria-label={weekday.long}
              className="calendar__weekday"
            >
              {weekday.short}
            </div>
          ))}
        </div>
        {monthGrid(focused.year, focused.month).map((week, index) => (
          <div className="calendar__week" role="row" key={`${monthLabel} week ${index + 1}`}>
            {week.map((day, position) => {
              if (day === null) {
                return (
                  <div
                    key={`${monthLabel} blank ${index}-${position}`}
                    role="gridcell"
                    className="calendar__cell"
                  />
                );
              }
              const parts = { year: focused.year, month: focused.month, day };
              const iso = isoFromParts(parts);
              const chosen = iso === value;
              const unreachable = outsideBounds(iso, min, max);
              return (
                <div key={iso} role="gridcell" aria-selected={chosen} className="calendar__cell">
                  <button
                    type="button"
                    className={[
                      'calendar__day',
                      chosen ? 'calendar__day--chosen' : '',
                      iso === todayIso ? 'calendar__day--today' : '',
                      unreachable ? 'calendar__day--unreachable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={dayName(parts)}
                    aria-disabled={unreachable ? true : undefined}
                    aria-current={iso === todayIso ? 'date' : undefined}
                    tabIndex={day === focused.day ? 0 : -1}
                    data-calendar-focus={day === focused.day ? 'true' : undefined}
                    onClick={() => choose(parts)}
                  >
                    {day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
