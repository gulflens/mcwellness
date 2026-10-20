/**
 * Finding one row in a book that keeps growing: a search field, then a row of
 * chips that narrows the book to one kind of row (operator, 20 October 2026).
 * The invoice book and the receipt book share it, so the two read alike.
 *
 * The chips are toggle buttons in a labelled group, "All" first: one chosen
 * at a time, because "visits and statements" is not a question anybody at the
 * practice asks.
 */

export type Choice<T extends string> = { value: T; label: string };

export function LedgerSearch<T extends string>({
  label,
  placeholder,
  search,
  onSearch,
  groupLabel,
  choices,
  chosen,
  onChoose,
}: {
  label: string;
  placeholder: string;
  search: string;
  onSearch: (next: string) => void;
  groupLabel: string;
  choices: readonly Choice<T>[];
  chosen: T | null;
  onChoose: (next: T | null) => void;
}) {
  return (
    <div className="ledger-search">
      <label className="ledger-search__field">
        <span className="visually-hidden">{label}</span>
        <SearchIcon />
        <input
          type="search"
          value={search}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <div className="ledger-search__chips" role="group" aria-label={groupLabel}>
        <button
          type="button"
          className="chip"
          aria-pressed={chosen === null}
          onClick={() => onChoose(null)}
        >
          All
        </button>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="chip"
            aria-pressed={chosen === choice.value}
            onClick={() => onChoose(chosen === choice.value ? null : choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="M14 14l4 4" />
    </svg>
  );
}

/**
 * Rows in the order they came, gathered under the key each belongs to. The
 * book arrives newest first, so the groups do too.
 */
export function groupBy<Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => { key: string; label: string },
): { key: string; label: string; items: Row[] }[] {
  const groups: { key: string; label: string; items: Row[] }[] = [];
  for (const row of rows) {
    const { key, label } = keyOf(row);
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(row);
    else groups.push({ key, label, items: [row] });
  }
  return groups;
}

const monthFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  month: 'long',
  year: 'numeric',
});

/** "October 2026", for a calendar date the API sends as YYYY-MM-DD. */
export function monthOf(isoDate: string): { key: string; label: string } {
  return {
    key: isoDate.slice(0, 7),
    label: monthFormat.format(new Date(`${isoDate.slice(0, 7)}-01T00:00:00+04:00`)),
  };
}

const weekdayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  weekday: 'long',
});
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'long',
});
const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * "Today, 20 October", "Yesterday, 19 October" or "Wednesday, 8 October", for
 * an instant, by the practice's own calendar. `now` is passed in so the words
 * are the same in a test as they are on the day.
 */
export function dayOf(instant: string, now: Date): { key: string; label: string } {
  const at = new Date(instant);
  const key = dayKey.format(at);
  const day =
    key === dayKey.format(now)
      ? 'Today'
      : key === dayKey.format(new Date(now.getTime() - 86_400_000))
        ? 'Yesterday'
        : weekdayFormat.format(at);
  return { key, label: `${day}, ${dateFormat.format(at)}` };
}
