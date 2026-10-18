import { useEffect, useRef, type ReactNode } from 'react';
import { CheckIcon } from './Icons';

/**
 * The end of a high-stakes action (DESIGN.md, States; ADR 0004): what
 * happened, as a heading; the key figure at display size where there is one;
 * the sentence the screen used to show as a note; and what can be done next.
 * Not a Note line: a sale, a payment, a signature and a finished visit are
 * the moments people remember the product by.
 *
 * It takes the focus when it appears, on its heading, so a keyboard or
 * screen-reader user who has just pressed the button in a drawer that closed
 * lands on the outcome rather than at the top of the page. It is also a
 * polite status region, so the outcome is announced where focus cannot move.
 *
 * No identifier of an erased client ever goes into one (DESIGN.md, States).
 */
export type Outcome = {
  /** What happened, short: "Invoice INV-000004 issued". */
  title: string;
  /** The figure the action was about, already formatted: "AED 735.00". */
  figure?: string;
  /** Small, above the figure: "Total", "Received". */
  figureLabel?: string;
};

export function Confirmation({
  outcome,
  children,
  actions,
}: {
  outcome: Outcome;
  /** The sentence: what was done, to whom, and the reference to quote. */
  children?: ReactNode;
  /** Buttons or links for what comes next; the first is the likely one. */
  actions?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [outcome.title]);
  return (
    <section className="confirmation" role="status" aria-live="polite">
      <div className="confirmation__mark" aria-hidden="true">
        <CheckIcon />
      </div>
      <div className="confirmation__body">
        <h2 ref={heading} tabIndex={-1} className="confirmation__title">
          {outcome.title}
        </h2>
        {outcome.figure ? (
          <div className="confirmation__figure-block">
            {outcome.figureLabel ? (
              <p className="confirmation__figure-label small">{outcome.figureLabel}</p>
            ) : null}
            <p className="confirmation__figure numeric">{outcome.figure}</p>
          </div>
        ) : null}
        {children ? <div className="confirmation__text">{children}</div> : null}
        {actions ? <div className="confirmation__actions">{actions}</div> : null}
      </div>
    </section>
  );
}
