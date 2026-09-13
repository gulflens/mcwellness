// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from './DateField';
import { isoFromParts, todayParts } from './calendar';

// This suite carries vitest's own matchers and not jest-dom's (see
// tests/accounting/BooksPage.test.tsx), so a value is read off the input
// rather than asserted on with toHaveValue. Renders are also not
// auto-cleaned between tests here, so each one is torn down explicitly —
// which matters more now that the calendar renders into `document.body`
// through a portal rather than inside the render container.
afterEach(cleanup);

function Harness({
  onChange,
  min,
  max,
  initial = '',
}: {
  onChange?: (v: string) => void;
  min?: string;
  max?: string;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateField
        id="d"
        label="Date of birth"
        value={value}
        min={min}
        max={max}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <button type="button">Somewhere else</button>
    </>
  );
}

function box() {
  return screen.getByLabelText('Date of birth') as HTMLInputElement;
}

function calendarButton() {
  return screen.getByRole('button', { name: 'Date of birth: open the calendar' });
}

function focusedDayName() {
  return document.activeElement?.getAttribute('aria-label');
}

describe('DateField', () => {
  it('draws the slashes as the digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '12091988');
    expect(box().value).toBe('12/09/1988');
  });

  it('emits the stored ISO form only once the date is complete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(box(), '12091988');
    expect(onChange).toHaveBeenLastCalledWith('1988-09-12');
    expect(onChange).not.toHaveBeenCalledWith('1988-09-1');
  });

  it('refuses an impossible date and emits nothing for it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(box(), '31022026');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('shows a stored value in the typed form', () => {
    render(
      <DateField id="d" label="Date of birth" value="1988-09-12" onChange={() => undefined} />,
    );
    expect(box().value).toBe('12/09/1988');
  });

  // Finding 2(a): nothing above ever rerenders a mounted DateField with a
  // changed `value` prop — every harness starts at '' and only ever moves
  // forward from what the user typed. A record loading into an already
  // mounted field is a real path (an enrolment wizard's date-of-birth step
  // arriving after its record fetch resolves) and needs its own coverage.
  it('redraws the typed form when the value prop changes underneath it', () => {
    const { rerender } = render(
      <DateField id="d" label="Date of birth" value="" onChange={() => undefined} />,
    );
    expect(box().value).toBe('');
    rerender(
      <DateField id="d" label="Date of birth" value="1988-09-12" onChange={() => undefined} />,
    );
    expect(box().value).toBe('12/09/1988');
  });

  // Finding 2(b): the resync guard used to compare `isoFromDisplay(typed)`
  // (which is `null` for an incomplete date) against `value` (which is `''`
  // once `take` empties it), read those as different, and blanked the whole
  // box — an eight-digit date lost to one Backspace. Typing the full date,
  // deleting one digit, and expecting the partial text to survive is the
  // regression guard for that.
  it('keeps the partial text after a backspace off a complete date', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '12091988');
    expect(box().value).toBe('12/09/1988');
    await user.type(box(), '{Backspace}');
    expect(box().value).toBe('12/09/198');
  });

  // Finding 4: `min`/`max` only ever reached the hidden native input, so a
  // date typed directly into the text box could sit outside the bound the
  // caller asked for and still be emitted.
  it('refuses a complete date that falls after max', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} max="2020-01-01" />);
    await user.type(box(), '01012025');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  // Fix round 3, symptom A: `min`/`max` are legal as `''` — exactly what an
  // unset from/to range bound to component state holds before anything is
  // picked — and `''` is not `undefined`, so a definedness check ran the
  // bound comparison anyway. `iso > ''` is true for every ISO date, so an
  // empty-string `max` swallowed every typed date forever.
  it('does not swallow a typed date when max is an empty string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} max="" />);
    await user.type(box(), '12091988');
    expect(onChange).toHaveBeenLastCalledWith('1988-09-12');
  });

  // Fix round 3, symptom B: folding the bound check into the same `resolve`
  // the resync guard used meant a value loaded outside `min`/`max` and then
  // genuinely reset to `''` left the stale, out-of-bounds date on screen —
  // `resolve(typed)` was already `''` (out of bounds) and read as matching
  // the new, equally empty `value`, so the guard skipped the redraw.
  it('clears the box on a genuine reset even when the shown date is out of bounds', () => {
    const { rerender } = render(
      <DateField
        id="d"
        label="Date of birth"
        value="2026-08-01"
        max="2020-01-01"
        onChange={() => undefined}
      />,
    );
    expect(box().value).toBe('01/08/2026');
    rerender(
      <DateField
        id="d"
        label="Date of birth"
        value=""
        max="2020-01-01"
        onChange={() => undefined}
      />,
    );
    expect(box().value).toBe('');
  });
});

/**
 * Round 48. The three tests that used to sit here drove the hidden native
 * input and its `showPicker()` — one that it was called, two that a press
 * still landed on `focus()` when it threw or was missing. There is no native
 * input and no `showPicker` any more (the operator, on Safari, got a picker
 * that opened off the outer edge of a right-docked drawer and was clipped),
 * so the coverage they carried — "the button opens something, by every route
 * in, and a press never falls through" — is carried by these instead.
 */
describe('DateField opens a calendar of its own', () => {
  it('opens the calendar when the button is pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(calendarButton());
    expect(screen.getByRole('dialog', { name: 'Date of birth: choose a date' })).toBeTruthy();
    expect(calendarButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('opens on Enter and on Space', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    calendarButton().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('puts focus on a day of the grid as it opens', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    expect(focusedDayName()).toBe('12 September 1988');
  });

  it('opens on the month of the day already stored', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    expect(screen.getByRole('grid', { name: 'September 1988' })).toBeTruthy();
  });

  it('marks the day already stored as the chosen one', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    const chosen = screen.getAllByRole('gridcell').filter((cell) => {
      return cell.getAttribute('aria-selected') === 'true';
    });
    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.textContent).toBe('12');
  });

  it('marks today with a hairline and marks nothing else', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(calendarButton());
    const marked = document.querySelectorAll('[aria-current="date"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.className).toContain('calendar__day--today');
    expect(marked[0]?.textContent).toBe(String(todayParts().day));
  });

  it('closes on Escape and gives the button its focus back', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(calendarButton());
  });

  it('closes when the press lands somewhere else on the page', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: 'Somewhere else' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes again when the same button is pressed a second time', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    await user.click(calendarButton());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when a day is chosen, and gives the button its focus back', async () => {
    const user = userEvent.setup();
    render(<Harness initial="1988-09-12" />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '20 September 1988' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(calendarButton());
  });
});

/**
 * The timezone trap this control was written around. The practice is in Dubai:
 * `new Date('1986-09-30')` parses as UTC midnight and `.toISOString()` on a
 * locally-built date crosses back over the UTC+4 boundary, so a day picked in
 * the evening arrives as the day before. Nothing in the calendar goes near
 * either, and these are what say so — 1 January and 31 December especially,
 * where the slip takes the year with it.
 */
describe('DateField emits exactly the day that was chosen', () => {
  it('emits the chosen day in the middle of a month', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="1988-09-12" />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '20 September 1988' }));
    expect(onChange).toHaveBeenLastCalledWith('1988-09-20');
    expect(box().value).toBe('20/09/1988');
  });

  it('emits the first of January as the first of January', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="2026-01-15" />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '1 January 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-01-01');
    expect(box().value).toBe('01/01/2026');
  });

  it('emits the last of December as the last of December', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="2026-12-15" />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '31 December 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31');
    expect(box().value).toBe('31/12/2026');
  });

  it('emits the 29th of a leap February', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="2024-02-01" />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '29 February 2024' }));
    expect(onChange).toHaveBeenLastCalledWith('2024-02-29');
  });
});

describe('DateField honours min and max in the calendar', () => {
  const inRange = { min: '2026-09-10', max: '2026-09-20', initial: '2026-09-15' };

  it('marks a day before min as one that cannot be chosen', async () => {
    const user = userEvent.setup();
    render(<Harness {...inRange} />);
    await user.click(calendarButton());
    const early = screen.getByRole('button', { name: '5 September 2026' });
    expect(early.getAttribute('aria-disabled')).toBe('true');
  });

  it('emits nothing when a day outside the range is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness {...inRange} onChange={onChange} />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '25 September 2026' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('still lets a day inside the range through', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness {...inRange} onChange={onChange} />);
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '10 September 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-09-10');
  });

  it('opens on the nearest reachable day when the field is empty', async () => {
    const user = userEvent.setup();
    render(<Harness min="2030-04-05" />);
    await user.click(calendarButton());
    expect(focusedDayName()).toBe('5 April 2030');
  });
});

describe('DateField moves through the calendar from the keyboard', () => {
  async function open() {
    const user = userEvent.setup();
    render(<Harness initial="2026-09-15" />);
    await user.click(calendarButton());
    return user;
  }

  it('moves a day at a time with the left and right arrows', async () => {
    const user = await open();
    await user.keyboard('{ArrowRight}');
    expect(focusedDayName()).toBe('16 September 2026');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(focusedDayName()).toBe('14 September 2026');
  });

  it('moves a week at a time with the up and down arrows', async () => {
    const user = await open();
    await user.keyboard('{ArrowDown}');
    expect(focusedDayName()).toBe('22 September 2026');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(focusedDayName()).toBe('8 September 2026');
  });

  it('moves a month at a time with Page Up and Page Down', async () => {
    const user = await open();
    await user.keyboard('{PageDown}');
    expect(focusedDayName()).toBe('15 October 2026');
    await user.keyboard('{PageUp}{PageUp}');
    expect(focusedDayName()).toBe('15 August 2026');
  });

  it('goes to the ends of the week with Home and End', async () => {
    const user = await open();
    // 15 September 2026 is a Tuesday; the week runs Monday to Sunday.
    await user.keyboard('{Home}');
    expect(focusedDayName()).toBe('14 September 2026');
    await user.keyboard('{End}');
    expect(focusedDayName()).toBe('20 September 2026');
  });

  it('crosses into the next month when the arrow runs off the end of this one', async () => {
    const user = await open();
    await user.keyboard('{PageDown}');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(focusedDayName()).toBe('5 November 2026');
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeTruthy();
  });

  it('chooses the focused day with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="2026-09-15" />);
    await user.click(calendarButton());
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-09-16');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('chooses the focused day with Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="2026-09-15" />);
    await user.click(calendarButton());
    await user.keyboard('{ArrowLeft} ');
    expect(onChange).toHaveBeenLastCalledWith('2026-09-14');
  });

  it('keeps exactly one day in the tab order', async () => {
    const user = await open();
    const days = screen
      .getAllByRole('gridcell')
      .flatMap((cell) => Array.from(cell.querySelectorAll('button')));
    const reachable = days.filter((day) => day.tabIndex === 0);
    expect(days.length).toBeGreaterThan(27);
    expect(reachable).toHaveLength(1);
    expect(reachable[0]?.getAttribute('aria-label')).toBe('15 September 2026');
    await user.keyboard('{ArrowRight}');
    const moved = screen
      .getAllByRole('gridcell')
      .flatMap((cell) => Array.from(cell.querySelectorAll('button')))
      .filter((day) => day.tabIndex === 0);
    expect(moved[0]?.getAttribute('aria-label')).toBe('16 September 2026');
  });

  it('turns the month with the two month buttons without stealing the focus', async () => {
    const user = await open();
    const back = screen.getByRole('button', { name: 'Previous month' });
    await user.click(back);
    expect(screen.getByRole('grid', { name: 'August 2026' })).toBeTruthy();
    expect(document.activeElement).toBe(back);
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy();
  });
});

describe('DateField still keeps the calendar and the text box in step', () => {
  it('shows the day chosen from the calendar in the text box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '12091988');
    await user.click(calendarButton());
    await user.click(screen.getByRole('button', { name: '13 September 1988' }));
    expect(box().value).toBe('13/09/1988');
  });

  it('opens on today when nothing has been typed yet', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(calendarButton());
    expect(focusedDayName()).toBe(
      document.querySelector('[aria-current="date"]')?.getAttribute('aria-label'),
    );
    expect(isoFromParts(todayParts())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
