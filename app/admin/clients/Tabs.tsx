import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type Tab = { id: string; label: string };

/**
 * A real tab strip (task brief item 1): `role="tablist"`, arrow-key
 * movement between tabs (Home/End to the ends), automatic activation on
 * focus — the WAI-ARIA authoring practice, and the shell has no tab
 * component of its own yet to reuse (app/shell/components/Controls.tsx).
 */
export function Tabs({
  tabs,
  selected,
  onSelect,
  idPrefix,
}: {
  tabs: readonly Tab[];
  selected: string;
  onSelect: (id: string) => void;
  idPrefix: string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function move(from: number, delta: number) {
    const next = tabs[(from + delta + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(index, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = tabs[0];
      if (first) {
        onSelect(first.id);
        refs.current.get(first.id)?.focus();
      }
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = tabs[tabs.length - 1];
      if (last) {
        onSelect(last.id);
        refs.current.get(last.id)?.focus();
      }
    }
  }

  return (
    <div className="tabs" role="tablist" aria-label="Record sections">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            if (el) refs.current.set(tab.id, el);
            else refs.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          className={['tabs__tab', selected === tab.id ? 'tabs__tab--selected' : null]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(e) => onKeyDown(e, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  id,
  idPrefix,
  selected,
  children,
}: {
  id: string;
  idPrefix: string;
  selected: string;
  children: ReactNode;
}) {
  if (selected !== id) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
      className="tabs__panel"
    >
      {children}
    </div>
  );
}
