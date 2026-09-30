import { useState } from 'react';
import { displayFromIso } from '@domain/shared';
import {
  BAND_IDS,
  CONNECTIVITY_IDS,
  type BandId,
  type ConnectivityId,
} from '../../../../domain/reports/qeeg/catalogue/ids';
import { isSessionCount } from '../../../../domain/reports/qeeg/choices';
import {
  stillOffered,
  takeChosen,
  takeCustom,
  takeRegions,
  type OfferedList,
} from '../../../../domain/reports/qeeg/offered';
import type { Offered } from '../../../../domain/reports/qeeg/prefill';
import { bandHeading } from '../../../../domain/reports/qeeg/sentences';
import { LIMITS, type QeegContent, type QeegFollowUp } from '../../../../domain/reports/qeeg/types';
import { phrase } from '../../../../domain/reports/qeeg/wording';
import { Button, Field } from '../../../shell/components/Controls';
import { wholeNumberIn } from './QeegFields';

/**
 * What a follow-up begun from an earlier report offers, and the number of
 * sessions completed (brief S; docs/SPEC/reports-qeeg.md sections 10 and 16,
 * point 7).
 *
 * **Offered, never ticked.** What she chose in the earlier report is listed
 * beside each list and each band, and nothing of it is in the report until
 * she takes it, one at a time, with its own button. What she takes, or
 * chooses herself, drops out of the suggestions (`stillOffered`). Taking one
 * is the domain's (`takeChosen`, `takeCustom`, `takeRegions`), so it changes
 * the report exactly as ticking would.
 *
 * **Sessions completed say where they came from.** Counted from the client's
 * visits between the two recordings, as the server counts them on every save;
 * or typed, when some were elsewhere; or left off the page. The figure on the
 * page says which (section 10).
 */

type Edit = (change: (content: QeegContent) => QeegContent) => void;

const en = (key: string) => phrase(key, 'follow-up', 'en');

/** A list's item by its name, in the report's own words. */
function itemLabel(list: OfferedList, id: string): string {
  switch (list) {
    case 'findings':
      return en(`finding.${id}`);
    case 'focus':
      return en(`focus.${id}`);
    case 'recommendations':
      return en(`recommendation.${id}.name`);
    case 'benefits':
      return en(`benefit.${id}`);
    default: {
      const unknown: never = list;
      return unknown;
    }
  }
}

function regionWords(regions: readonly string[]): string {
  return regions.map((region) => phrase(`region.${region}.label`, 'initial', 'en')).join(', ');
}

const INTRO =
  'Chosen in the earlier report. Nothing here is ticked for you: take any you want again.';

/** What was chosen in one list last time, still to be taken. */
export function OfferedItems({
  list,
  content,
  offered,
  edit,
}: {
  list: OfferedList;
  content: QeegFollowUp;
  offered: Offered;
  edit: Edit;
}) {
  const left = stillOffered(content, offered)[list];
  const custom = Object.entries(left.custom).sort(([, a], [, b]) => a.position - b.position);
  if (left.chosen.length === 0 && custom.length === 0) return null;
  const take = (change: (was: QeegFollowUp) => QeegFollowUp) =>
    edit((was) => (was.edition === 'follow-up' ? change(was) : was));
  return (
    <div className="qeeg-offered" role="group" aria-label="Chosen in the earlier report">
      <p className="small muted">{INTRO}</p>
      <ul className="qeeg-offered__list">
        {left.chosen.map((id) => {
          const label = itemLabel(list, id);
          return (
            <li key={id}>
              <span>{label}</span>
              <Button
                variant="quiet"
                aria-label={`Take ${label}`}
                onClick={() => take((was) => takeChosen(was, list, id))}
              >
                Take
              </Button>
            </li>
          );
        })}
        {custom.map(([key, item]) => (
          <li key={key}>
            <span>{item.label.en}</span>
            <Button
              variant="quiet"
              aria-label={`Take ${item.label.en}`}
              onClick={() => take((was) => takeCustom(was, list, key, offered))}
            >
              Take
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The regions named last time, band by band or link by link, still to be taken. */
export function OfferedRegions({
  kind,
  content,
  offered,
  edit,
}: {
  kind: 'bands' | 'connectivity';
  content: QeegFollowUp;
  offered: Offered;
  edit: Edit;
}) {
  const left = stillOffered(content, offered).regions;
  const rows: { id: BandId | ConnectivityId; title: string; regions: readonly string[] }[] =
    kind === 'bands'
      ? BAND_IDS.map((id) => ({ id, title: bandHeading(id, 'en'), regions: left.bands[id] }))
      : CONNECTIVITY_IDS.map((id) => ({
          id,
          title: en(`connectivity.${id}.title`),
          regions: left.connectivity[id],
        }));
  const shown = rows.filter((row) => row.regions.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="qeeg-offered" role="group" aria-label="Regions named in the earlier report">
      <p className="small muted">
        Regions named in the earlier report. Nothing here is chosen for you: take any you want
        again.
      </p>
      <ul className="qeeg-offered__list">
        {shown.map((row) => (
          <li key={row.id}>
            <span>
              {row.title}: {regionWords(row.regions)}
            </span>
            <Button
              variant="quiet"
              aria-label={`Take the earlier regions of ${row.title}`}
              onClick={() =>
                edit((was) =>
                  was.edition === 'follow-up' ? takeRegions(was, kind, row.id, offered) : was,
                )
              }
            >
              Take
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Pick = 'counted' | 'typed' | 'none';

/**
 * The number of sessions completed: counted from the visits, typed, or left
 * off. `counted` is the last count the server gave (the prefill's, or the
 * figure a save wrote back), so she can go back to it after typing another.
 */
export function SessionsCompletedField({
  content,
  counted,
  edit,
}: {
  content: QeegFollowUp;
  /** The last count the server gave, or null when it gave none this time. */
  counted: number | null;
  edit: Edit;
}) {
  const figure = content.change.sessionsCompleted;
  const [typing, setTyping] = useState(figure?.source === 'typed');
  const [typed, setTyped] = useState(figure?.source === 'typed' ? String(figure.count) : '');
  const pick: Pick = figure?.source === 'gathered' ? 'counted' : typing ? 'typed' : 'none';
  const lastCounted = figure?.source === 'gathered' ? figure.count : counted;
  const typedValid = isSessionCount(wholeNumberIn(typed));

  const setFigure = (next: QeegFollowUp['change']['sessionsCompleted']) =>
    edit((was) =>
      was.edition === 'follow-up'
        ? { ...was, change: { ...was.change, sessionsCompleted: next } }
        : was,
    );

  const choose = (next: Pick) => {
    setTyping(next === 'typed');
    if (next === 'counted') {
      setFigure(
        lastCounted !== null && lastCounted >= 1
          ? { count: lastCounted, source: 'gathered' }
          : null,
      );
    } else if (next === 'typed') {
      const n = wholeNumberIn(typed);
      setFigure(isSessionCount(n) ? { count: n, source: 'typed' } : null);
    } else {
      setFigure(null);
    }
  };

  const after = content.comparedWith.recordedOn;
  const before = content.recording.recordedOn;
  const between = `after the earlier recording${after ? ` on ${displayFromIso(after)}` : ''} and ${
    before
      ? `before this one on ${displayFromIso(before)}`
      : 'up to today, as this recording has no date yet'
  }`;
  const mayCount = lastCounted !== null && lastCounted >= 1;
  const options: { value: Pick; label: string; disabled?: boolean }[] = [
    { value: 'counted', label: 'Counted from the client’s visits', disabled: !mayCount },
    { value: 'typed', label: 'Typed, because some were elsewhere' },
    { value: 'none', label: 'Not shown on the page' },
  ];

  return (
    <fieldset className="qeeg-item">
      <legend className="qeeg-item__title">{en('tile.sessions_completed')}</legend>
      <div className="qeeg-choices" role="radiogroup" aria-label={en('tile.sessions_completed')}>
        {options.map((option) => (
          <label key={option.value} className="checkbox">
            <input
              type="radio"
              name="qeeg-sessions-completed"
              checked={pick === option.value}
              disabled={option.disabled}
              onChange={() => choose(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {pick === 'counted' && figure !== null ? (
        <p className="small" role="status">
          {figure.count} completed {figure.count === 1 ? 'session' : 'sessions'}, counted from the
          client’s visits {between}. It is counted again each time the draft is saved.
        </p>
      ) : null}
      {!mayCount && pick !== 'typed' ? (
        <p className="small muted">
          No completed visit is recorded {between}. If some sessions were elsewhere, type the
          number.
        </p>
      ) : null}
      {pick === 'typed' ? (
        <Field
          id="qeeg-sessions-completed"
          label="Number of sessions completed"
          inputMode="numeric"
          value={typed}
          hint="The page will say the number was typed."
          error={
            typed.trim() !== '' && !typedValid
              ? `A whole number from 1 to ${LIMITS.sessionsMost}.`
              : undefined
          }
          onChange={(event) => {
            const text = event.currentTarget.value;
            setTyped(text);
            const n = wholeNumberIn(text);
            setFigure(isSessionCount(n) ? { count: n, source: 'typed' } : null);
          }}
        />
      ) : null}
    </fieldset>
  );
}
