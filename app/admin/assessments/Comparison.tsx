import type { Comparison as ComparisonValue, ComparisonSide } from '@domain/assessment';
import { Note } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { BAND_LABELS, NOT_A_DIAGNOSIS, UNIT_SHORT } from './copy';

/**
 * Two measurements side by side (docs/SPEC/assessment.md section 3.3).
 *
 * **A table, not a chart**, in the first version. The practice reads figures,
 * and a chart invites a shape to be over-read.
 *
 * **The earlier figure, the later figure, the difference, and nothing else.**
 * A band figure carries its band's hue from the design brief and no other
 * colour: nothing is red, nothing is shaded by how large it is, and nothing is
 * labelled high, low or abnormal. What a measurement means is the
 * practitioner's judgement, written in a report and signed by a person.
 *
 * **The age and sex each reference comparison was made against** are shown
 * above the figures, because a comparison made against a nine-year-old is not
 * the comparison made against a ten-year-old.
 *
 * **The fixed sentence sits beneath it, in both languages**, and its second
 * half is the consent's own wording, so the screen and the agreement can never
 * drift apart.
 */

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function on(iso: string): string {
  return dateFormat.format(new Date(iso));
}

function reference(side: ComparisonSide): string {
  if (side.referenceAgeYears === null && side.referenceSex === null) {
    return 'The software made no reference comparison.';
  }
  const age =
    side.referenceAgeYears === null ? 'an age it did not state' : `age ${side.referenceAgeYears}`;
  const sex =
    side.referenceSex === null || side.referenceSex === 'unknown'
      ? 'a sex it did not state'
      : side.referenceSex;
  return `Compared against ${age}, ${sex}.`;
}

/** A signed difference, written so the sign is never in doubt. */
function difference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function Side({ label, side }: { label: string; side: ComparisonSide }) {
  return (
    <div className="comparison__side">
      <span className="micro muted">{label}</span>
      <span className="numeric">{on(side.performedAt)}</span>
      <span className="small">{reference(side)}</span>
      <span className="small muted">
        {side.provenance.software} {side.provenance.softwareVersion}
      </span>
    </div>
  );
}

export function Comparison({ comparison }: { comparison: ComparisonValue }) {
  const columns: readonly Column<ComparisonValue['figures'][number]>[] = [
    {
      key: 'what',
      header: comparison.kind === 'brain-map' ? 'Site and band' : 'Figure',
      render: (row) =>
        row.band === null ? (
          <span>Total out of {comparison.maximum}</span>
        ) : (
          <span className="band">
            <span className={`band__swatch band__swatch--${row.band}`} aria-hidden="true" />
            {row.site} {BAND_LABELS[row.band]}
          </span>
        ),
    },
    { key: 'unit', header: 'In', render: (row) => UNIT_SHORT[row.unit] },
    {
      key: 'earlier',
      header: 'Earlier',
      numeric: true,
      align: 'end',
      render: (row) => row.earlier,
    },
    { key: 'later', header: 'Later', numeric: true, align: 'end', render: (row) => row.later },
    {
      key: 'difference',
      header: 'Difference',
      numeric: true,
      align: 'end',
      render: (row) => difference(row.difference),
    },
  ];

  return (
    <section className="assessments__section">
      <div className="comparison__against">
        <Side label="Earlier" side={comparison.earlier} />
        <Side label="Later" side={comparison.later} />
      </div>

      <Table
        caption="The earlier figure, the later figure and the difference"
        columns={columns}
        rows={comparison.figures}
        rowKey={(row) => row.key}
        empty={<Note>Nothing in these two recordings is measured the same way.</Note>}
      />

      {comparison.unpaired.length > 0 ? (
        <Note>
          {comparison.unpaired.length}{' '}
          {comparison.unpaired.length === 1 ? 'figure is' : 'figures are'} in one recording and not
          the other, so there is nothing to set beside them.
        </Note>
      ) : null}

      <div className="comparison__standing">
        {/* The console is English only (operator's decision of 7 September
            2026, docs/DESIGN-BRIEF.md section 10 item 4); both halves still go
            on anything printed from this screen, which a household reads. */}
        <p>{NOT_A_DIAGNOSIS.en}</p>
      </div>
    </section>
  );
}
