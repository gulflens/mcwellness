import { useRef, type ReactNode } from 'react';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from './useDrawer';

/**
 * A drawer that only shows something: an opened journal entry, an account's
 * ledger. Nothing in it is written, so it has a title, a close button and
 * whatever is being read, and no form.
 *
 * Both used to render beneath the whole table they were opened from — off
 * the screen on a journal of any length — so "Open" looked as if it did
 * nothing. The drawer opens at once, beside the table, whatever the read then
 * answers: what was asked for, or a line saying it could not be had.
 */
export function ViewDrawer({
  id,
  title,
  onClose,
  children,
}: {
  /** Prefix for the title's id; the drawer is named by its title. */
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">{children}</div>
    </aside>
  );
}
