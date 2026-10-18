/**
 * What a lazily loaded screen shows in the moment before it arrives
 * (DESIGN.md, States). The page's furniture, a heading line and a panel, so
 * the content column is never simply empty, and a sentence that says so to
 * anything reading the page aloud. No shimmer, no spinner.
 */
export function PageSkeleton() {
  return (
    <div className="page page-skeleton" aria-busy="true">
      <p className="visually-hidden">Loading the page.</p>
      <div aria-hidden="true">
        <span className="page-skeleton__heading" />
        <div className="page-skeleton__panel">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="page-skeleton__row" />
          ))}
        </div>
      </div>
    </div>
  );
}
