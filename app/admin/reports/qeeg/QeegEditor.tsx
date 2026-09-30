import { useState, type ReactNode } from 'react';
import { displayFromIso } from '@domain/shared';
import {
  APPROACH_IDS,
  BAND_CHANGES,
  BAND_IDS,
  BENEFIT_IDS,
  CONNECTIVITY_CHANGES,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  INITIAL_BAND_LEVELS,
  INITIAL_CONNECTIVITY_LEVELS,
  MEASURE_IDS,
  MEASURE_RANGES,
  NEXT_STAGE_IDS,
  QEEG_ONLY,
  RECOMMENDATION_IDS,
  SESSION_OPTIONS,
  type ConnectivityId,
  type MeasureId,
} from '../../../../domain/reports/qeeg/catalogue/ids';
import {
  chooseSessions,
  figureText,
  isSessionCount,
} from '../../../../domain/reports/qeeg/choices';
import {
  bandHeading,
  paragraph,
  programmeAgreed,
  sessionLabel,
} from '../../../../domain/reports/qeeg/sentences';
import { compareWith } from '../../../../domain/reports/qeeg/maps';
import { toFollowUp, toInitial } from '../../../../domain/reports/qeeg/switchEdition';
import { spansOf } from '../../../../domain/reports/qeeg/text';
import {
  EYES,
  HANDEDNESS,
  LIMITS,
  type ChangeRow,
  type Edition,
  type QeegContent,
  type QeegFollowUp,
  type QeegInitial,
  type TypedFigure,
} from '../../../../domain/reports/qeeg/types';
import { fill, phrase } from '../../../../domain/reports/qeeg/wording';
import type { ReportRow } from '../../../api/reports/schema';
import { Button, Field, Note, Select } from '../../../shell/components/Controls';
import { DateField } from '../../../shell/components/DateField';
import { Textarea } from '../../clients/FormAtoms';
import { comparableReports, comparedFromRow, earlierLabel } from './earlier';
import {
  Choice,
  FigureField,
  PickedList,
  RegionPicker,
  RichField,
  wholeNumberIn,
} from './QeegFields';
import { MapsSection, PairsField } from './QeegMaps';
import {
  SECTION_TITLES,
  leftBySection,
  missingWords,
  sectionsFor,
  setAsideWords,
  type SectionId,
} from './sections';
import { useQeegDraft } from './useQeegDraft';
import { useQeegMaps } from './useQeegMaps';
import './qeeg.css';

/**
 * The brain-map (qEEG) report's form, in English (docs/SPEC/reports-qeeg.md
 * section 15).
 *
 * **The report's sections, in its order, one open at a time** unless she
 * opens them all. Each says how much of it is left to fill, from the domain's
 * own list of what a signature needs (`missingForIssue`, grouped by
 * `sections.ts`), so the count on the screen and the refusal at signing
 * cannot disagree. A follow-up adds what it is compared with at the top and
 * the page of what has changed at the end.
 *
 * **Saved at rest points** (`useQeegDraft`): moving to another section, thirty
 * seconds after the last change, leaving, changing the edition, and the Save
 * button. Moving is read two ways, because Safari does not focus a button it
 * clicks: opening a section, and focus entering a different one.
 *
 * **Nothing here decides a rule.** What is left comes from `missingForIssue`;
 * switching edition is `toFollowUp`/`toInitial`, and what they set aside is
 * shown before she confirms; the brain-map-only choice clears the approach
 * because the shape refuses the two together, and the count then drops
 * because `missingForIssue` asks for no approach beside it. The server
 * gathers the client and what a follow-up is compared with; the form shows
 * them and never sends them.
 *
 * **The brain maps** are a section of their own, and a follow-up's
 * before-and-after pictures sit on its page of what has changed
 * (`QeegMaps.tsx`, `useQeegMaps.ts`): a picture goes through the report's own
 * door, and the draft is saved before it does.
 *
 * **Not here yet**, each with its own piece of work: the Arabic version of
 * what she typed (the one component allowed to show Arabic on a staff screen),
 * preview and signing, bringing in a past record, and filling a follow-up
 * from the report before it.
 */

type Props = {
  clientId: string;
  /** An existing draft, or null to start `start`. */
  reportId: string | null;
  start: QeegContent | null;
  /** The client's reports, for what a follow-up may be compared with. */
  reports: readonly ReportRow[];
  onDone: () => void;
};

type Switching = { to: 'follow-up'; earlierId: string } | { to: 'initial' };

const en = (key: string, edition: Edition) => phrase(key, edition, 'en');

/** Left to fill, in words. */
function leftWords(count: number): string {
  return count === 0 ? 'Nothing left to fill' : `${count} left to fill`;
}

export function QeegEditor({ clientId, reportId, start, reports, onDone }: Props) {
  const draft = useQeegDraft({ clientId, reportId, start });
  const maps = useQeegMaps(draft);
  const [open, setOpen] = useState<SectionId | null>(null);
  const [all, setAll] = useState(false);
  const [entered, setEntered] = useState<SectionId | null>(null);
  const [switching, setSwitching] = useState<Switching | null>(null);
  /** Bumped when the draft is replaced whole, so every field starts from it afresh. */
  const [generation, setGeneration] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const candidates = comparableReports(reports);
  const { content } = draft;

  if (draft.loading) return <Note>Loading.</Note>;
  if (content === null) {
    return (
      <div className="report-editor">
        <Note tone="critical">{draft.error ?? 'That draft could not be opened.'}</Note>
        <div className="report-editor__actions">
          <Button onClick={onDone}>Back</Button>
        </div>
      </div>
    );
  }

  const edition = content.edition;
  const left = leftBySection(content);
  const sections = sectionsFor(edition);

  /** A section entered is a rest point for the one left. */
  function enter(section: SectionId): void {
    if (entered !== null && entered !== section) void draft.save('section');
    setEntered(section);
  }

  function toggle(section: SectionId): void {
    if (all) {
      setAll(false);
      setOpen(section);
    } else {
      setOpen((was) => (was === section ? null : section));
    }
    enter(section);
  }

  async function leave(): Promise<void> {
    if (await draft.save('leave')) {
      onDone();
      return;
    }
    setLeaving(true);
  }

  function confirmSwitch(): void {
    if (switching === null) return;
    const next = switched(content as QeegContent, switching, candidates);
    if (next === null) return;
    draft.edit(() => next.content);
    setSwitching(null);
    setGeneration((was) => was + 1);
    void draft.save('edition');
  }

  const body: Record<SectionId, () => ReactNode> = {
    compared: () =>
      content.edition === 'follow-up' ? (
        <ComparedSection content={content} candidates={candidates} edit={draft.edit} />
      ) : null,
    client: () => (
      <ClientSection content={content} saved={draft.reportId !== null} edit={draft.edit} />
    ),
    overview: () => <Paragraph text={paragraph('text.overview', content, 'en')} />,
    findings: () => (
      <PickedList
        id="qeeg-findings"
        ids={FINDING_IDS}
        labelOf={(id) => en(`finding.${id}`, edition)}
        picked={content.findings}
        onChange={(findings) => draft.edit((was) => ({ ...was, findings }))}
      />
    ),
    maps: () => <MapsSection clientId={clientId} content={content} edit={draft.edit} maps={maps} />,
    focus: () => (
      <PickedList
        id="qeeg-focus"
        ids={FOCUS_IDS}
        labelOf={(id) => en(`focus.${id}`, edition)}
        picked={content.focus}
        onChange={(focus) => draft.edit((was) => ({ ...was, focus }))}
      />
    ),
    bands: () => <BandsSection content={content} edit={draft.edit} />,
    connectivity: () => <ConnectivitySection content={content} edit={draft.edit} />,
    dashboard: () => <DashboardSection content={content} edit={draft.edit} />,
    recommendations: () => (
      <PickedList
        id="qeeg-recommendations"
        ids={RECOMMENDATION_IDS}
        labelOf={(id) => en(`recommendation.${id}.name`, edition)}
        picked={content.recommendations}
        withNote
        onChange={(recommendations) => draft.edit((was) => ({ ...was, recommendations }))}
      />
    ),
    summary: () => (
      <RichField
        id="qeeg-summary"
        label="Summary"
        value={content.summary.en}
        most={LIMITS.summaryTyped}
        onChange={(text) =>
          draft.edit((was) => ({ ...was, summary: { ...was.summary, en: text } }))
        }
      />
    ),
    benefits: () => (
      <PickedList
        id="qeeg-benefits"
        ids={BENEFIT_IDS}
        labelOf={(id) => en(`benefit.${id}`, edition)}
        picked={content.benefits}
        onChange={(benefits) => draft.edit((was) => ({ ...was, benefits }))}
      />
    ),
    programme: () => <ProgrammeSection content={content} edit={draft.edit} />,
    change: () =>
      content.edition === 'follow-up' ? (
        <ChangeSection content={content} edit={draft.edit} />
      ) : null,
  };

  return (
    <div className="report-editor qeeg-editor" key={generation}>
      <header className="qeeg-editor__head">
        <h3 className="report-editor__heading">
          Brain-map report, {edition === 'initial' ? 'first report' : 'follow-up'}
        </h3>
        <p className="small muted" role="status">
          {draft.saving
            ? 'Saving.'
            : draft.error
              ? 'Not saved. The reason is beneath the form.'
              : draft.dirty
                ? 'Changes not saved yet.'
                : draft.reportId === null
                  ? 'Not saved yet.'
                  : 'Saved.'}
        </p>
        <div className="report-editor__actions">
          <Button
            variant="quiet"
            onClick={() =>
              setSwitching(
                edition === 'initial'
                  ? { to: 'follow-up', earlierId: candidates[0]?.id ?? '' }
                  : { to: 'initial' },
              )
            }
          >
            {edition === 'initial' ? 'Make this a follow-up' : 'Make this a first report'}
          </Button>
          <Button variant="quiet" onClick={() => setAll((was) => !was)}>
            {all ? 'Show one section at a time' : 'Open every section'}
          </Button>
        </div>
      </header>

      {switching !== null ? (
        <SwitchPanel
          content={content}
          switching={switching}
          candidates={candidates}
          onChoose={(earlierId) => setSwitching({ to: 'follow-up', earlierId })}
          onConfirm={confirmSwitch}
          onCancel={() => setSwitching(null)}
        />
      ) : null}

      <div className="qeeg-sections">
        {sections.map((section) => {
          const expanded = all || open === section;
          const missing = left[section];
          return (
            <section
              key={section}
              className="qeeg-section"
              aria-labelledby={`qeeg-${section}-title`}
              onFocus={() => enter(section)}
            >
              <h4 className="qeeg-section__heading">
                <button
                  type="button"
                  id={`qeeg-${section}-title`}
                  className="qeeg-section__toggle"
                  aria-expanded={expanded}
                  aria-controls={expanded ? `qeeg-${section}-body` : undefined}
                  onClick={() => toggle(section)}
                >
                  <span>{SECTION_TITLES[section]}</span>
                  <span className="qeeg-section__left small">{leftWords(missing.length)}</span>
                </button>
              </h4>
              {expanded ? (
                <div id={`qeeg-${section}-body`} className="qeeg-section__body">
                  {missing.length > 0 ? (
                    <p className="small muted">
                      Still needed: {missing.map((each) => missingWords(each, edition)).join(', ')}.
                    </p>
                  ) : null}
                  {body[section]()}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {/* Beside the Save button, where she looks when a save is refused. */}
      {draft.stale ? (
        <div className="report-editor__sign">
          <Note tone="critical">{draft.error}</Note>
          <p>
            Loading the newer version replaces what is on this screen. Anything you changed here
            since your last save is not kept.
          </p>
          <div className="report-editor__actions">
            <Button
              variant="primary"
              onClick={() => {
                void draft.reload().then(() => setGeneration((was) => was + 1));
              }}
            >
              Load the newer version
            </Button>
          </div>
        </div>
      ) : draft.error ? (
        <Note tone="critical">{draft.error}</Note>
      ) : null}

      <div className="report-editor__actions">
        <Button
          variant="primary"
          disabled={draft.saving || draft.stale}
          onClick={() => void draft.save('button')}
        >
          Save the draft
        </Button>
        <Button variant="quiet" disabled={draft.saving} onClick={() => void leave()}>
          Back
        </Button>
        {leaving && draft.error ? (
          <Button
            variant="quiet"
            onClick={() => {
              draft.discard();
              onDone();
            }}
          >
            Leave without saving
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The edition
// ---------------------------------------------------------------------------

type Switched = { content: QeegContent; setAside: { at: string; was: string }[] };

/** The draft as the other edition, and what that clears. The domain's, shown. */
function switched(
  content: QeegContent,
  switching: Switching,
  candidates: readonly ReportRow[],
): Switched | null {
  if (switching.to === 'initial') {
    return content.edition === 'follow-up' ? toInitial(content) : null;
  }
  if (content.edition !== 'initial') return null;
  const earlier = candidates.find((row) => row.id === switching.earlierId);
  if (!earlier) return null;
  const result = toFollowUp(content, comparedFromRow(earlier), 'follow_up');
  return result.ok ? { content: result.content, setAside: result.setAside } : null;
}

function SwitchPanel({
  content,
  switching,
  candidates,
  onChoose,
  onConfirm,
  onCancel,
}: {
  content: QeegContent;
  switching: Switching;
  candidates: readonly ReportRow[];
  onChoose: (earlierId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const toFollow = switching.to === 'follow-up';
  const noEarlier = toFollow && candidates.length === 0;
  const result = noEarlier ? null : switched(content, switching, candidates);
  return (
    <div className="report-editor__sign" role="group" aria-label="Change the edition">
      <p>
        {toFollow
          ? 'A follow-up says what has changed since an earlier report, so it chooses from lists of its own.'
          : 'A first report says what was seen, so it chooses from lists of its own.'}{' '}
        Nothing is carried from one list to the other.
      </p>
      {toFollow ? (
        noEarlier ? (
          <Note>
            This client has no signed brain-map report and no kept past record, so there is nothing
            for a follow-up to be compared with.
          </Note>
        ) : (
          <Select
            id="qeeg-switch-earlier"
            label="Compared with"
            value={switching.earlierId}
            onChange={(event) => onChoose(event.currentTarget.value)}
          >
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {earlierLabel(row)}
              </option>
            ))}
          </Select>
        )
      ) : null}
      {result === null ? null : result.setAside.length === 0 ? (
        <p>Nothing you chose is cleared.</p>
      ) : (
        <>
          <p>These choices are cleared, and you choose them again:</p>
          <ul className="qeeg-set-aside">
            {result.setAside.map((item) => (
              <li key={item.at}>{setAsideWords(item, content.edition)}</li>
            ))}
          </ul>
        </>
      )}
      {!toFollow ? (
        <p>
          What it is compared with, the page of what has changed and the earlier scores are not
          kept.
        </p>
      ) : null}
      <p className="small muted">
        Regions, scores, lists, the summary and everything else are kept.
      </p>
      <div className="report-editor__actions">
        <Button variant="primary" disabled={result === null} onClick={onConfirm}>
          Change the edition
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Keep it as it is
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type Edit = (change: (content: QeegContent) => QeegContent) => void;

/** A fixed paragraph of the report, with its bold. */
function Paragraph({ text }: { text: string }) {
  return (
    <p className="qeeg-fixed">
      {spansOf(text).map((span, index) =>
        span.bold ? <strong key={index}>{span.text}</strong> : <span key={index}>{span.text}</span>,
      )}
    </p>
  );
}

function ComparedSection({
  content,
  candidates,
  edit,
}: {
  content: QeegFollowUp;
  candidates: readonly ReportRow[];
  edit: Edit;
}) {
  const { comparedWith } = content;
  const inList = candidates.some((row) => row.id === comparedWith.reportId);
  return (
    <>
      <dl className="report-editor__figures">
        <dt>Report</dt>
        <dd>{comparedWith.reference ?? 'Past record'}</dd>
        <dt>Recorded on</dt>
        <dd>
          {comparedWith.recordedOn
            ? displayFromIso(comparedWith.recordedOn)
            : 'Read from that report when the draft is saved'}
        </dd>
      </dl>
      {inList ? (
        <Select
          id="qeeg-compared"
          label="Compare with"
          value={comparedWith.reportId}
          onChange={(event) => {
            const row = candidates.find((each) => each.id === event.currentTarget.value);
            if (!row) return;
            // The earlier side of each pair was the other report's picture.
            edit((was) => compareWith(was, comparedFromRow(row)));
          }}
        >
          {candidates.map((row) => (
            <option key={row.id} value={row.id}>
              {earlierLabel(row)}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        id="qeeg-stage"
        label="This report is"
        value={content.stage}
        onChange={(event) => {
          const stage = event.currentTarget.value === 'final' ? 'final' : 'follow_up';
          edit((was) => (was.edition === 'follow-up' ? { ...was, stage } : was));
        }}
      >
        <option value="follow_up">{en('value.stage.follow_up', 'follow-up')}</option>
        <option value="final">{en('value.stage.final', 'follow-up')}</option>
      </Select>
    </>
  );
}

function ClientSection({
  content,
  saved,
  edit,
}: {
  content: QeegContent;
  saved: boolean;
  edit: Edit;
}) {
  const { edition, recording, subject } = content;
  const fromRecord = saved
    ? 'Not on the client’s record'
    : 'Read from the record at the first save';
  return (
    <>
      <DateField
        id="qeeg-recorded-on"
        label="Date of the recording"
        value={recording.recordedOn ?? ''}
        onChange={(next) =>
          edit((was) => ({
            ...was,
            recording: { ...was.recording, recordedOn: next === '' ? null : next },
          }))
        }
      />
      <Choice
        id="qeeg-eyes"
        label={en('label.eyes', edition)}
        value={recording.eyes}
        options={EYES.map((value) => ({ value, label: en(`value.eyes.${value}`, edition) }))}
        onChange={(eyes) => edit((was) => ({ ...was, recording: { ...was.recording, eyes } }))}
      />
      <Choice
        id="qeeg-handedness"
        label={en('label.handedness', edition)}
        value={recording.handedness}
        options={HANDEDNESS.map((value) => ({
          value,
          label: en(`value.handedness.${value}`, edition),
        }))}
        onChange={(handedness) =>
          edit((was) => ({ ...was, recording: { ...was.recording, handedness } }))
        }
      />
      <dl className="report-editor__figures">
        <dt>{en('label.age', edition)}</dt>
        <dd>{subject.ageYears ?? fromRecord}</dd>
        <dt>{en('label.sex', edition)}</dt>
        <dd>{subject.sex ? en(`value.sex.${subject.sex}`, edition) : fromRecord}</dd>
      </dl>
      <p className="small muted">
        The name, age and sex are read from the client’s record each time the draft is saved. To
        correct them, correct the record.
      </p>
    </>
  );
}

function BandsSection({ content, edit }: { content: QeegContent; edit: Edit }) {
  return (
    <>
      {BAND_IDS.map((band) => (
        <fieldset key={band} className="qeeg-item">
          <legend className="qeeg-item__title">{bandHeading(band, 'en')}</legend>
          {content.edition === 'initial' ? (
            <Choice
              id={`qeeg-band-${band}`}
              label="Level"
              value={content.bands[band].level}
              options={INITIAL_BAND_LEVELS.map((value) => ({
                value,
                label: en(`level.band.${value}.label`, 'initial'),
              }))}
              onChange={(level) =>
                edit((was) =>
                  was.edition === 'initial'
                    ? { ...was, bands: { ...was.bands, [band]: { ...was.bands[band], level } } }
                    : was,
                )
              }
            />
          ) : (
            <Choice
              id={`qeeg-band-${band}`}
              label="Change"
              value={content.bands[band].change}
              options={BAND_CHANGES.map((value) => ({
                value,
                label: en(`change.band.${value}.label`, 'follow-up'),
              }))}
              onChange={(change) =>
                edit((was) =>
                  was.edition === 'follow-up'
                    ? { ...was, bands: { ...was.bands, [band]: { ...was.bands[band], change } } }
                    : was,
                )
              }
            />
          )}
          <RegionPicker
            id={`qeeg-band-${band}-regions`}
            regions={content.bands[band].regions}
            onChange={(regions) =>
              edit((was) =>
                was.edition === 'initial'
                  ? { ...was, bands: { ...was.bands, [band]: { ...was.bands[band], regions } } }
                  : { ...was, bands: { ...was.bands, [band]: { ...was.bands[band], regions } } },
              )
            }
          />
        </fieldset>
      ))}
    </>
  );
}

function initialLevelOptions(id: ConnectivityId) {
  return INITIAL_CONNECTIVITY_LEVELS[id].map((value) => ({
    value: value as string,
    label: en(`level.${id}.${value}.label`, 'initial'),
  }));
}

function ConnectivitySection({ content, edit }: { content: QeegContent; edit: Edit }) {
  return (
    <>
      {CONNECTIVITY_IDS.map((id) => (
        <fieldset key={id} className="qeeg-item">
          <legend className="qeeg-item__title">
            {en(`connectivity.${id}.title`, content.edition)}
          </legend>
          <p className="small muted">{en(`connectivity.${id}.description`, content.edition)}</p>
          {content.edition === 'initial' ? (
            <Choice
              id={`qeeg-connectivity-${id}`}
              label="Level"
              value={content.connectivity[id].level as string | null}
              options={initialLevelOptions(id)}
              onChange={(level) =>
                edit((was) =>
                  was.edition === 'initial'
                    ? ({
                        ...was,
                        connectivity: {
                          ...was.connectivity,
                          [id]: { ...was.connectivity[id], level },
                        },
                      } as QeegInitial)
                    : was,
                )
              }
            />
          ) : (
            <Choice
              id={`qeeg-connectivity-${id}`}
              label="Change"
              value={content.connectivity[id].change}
              options={CONNECTIVITY_CHANGES.map((value) => ({
                value,
                label: en(`change.${id}.${value}.label`, 'follow-up'),
              }))}
              onChange={(change) =>
                edit((was) =>
                  was.edition === 'follow-up'
                    ? {
                        ...was,
                        connectivity: {
                          ...was.connectivity,
                          [id]: { ...was.connectivity[id], change },
                        },
                      }
                    : was,
                )
              }
            />
          )}
          <RegionPicker
            id={`qeeg-connectivity-${id}-regions`}
            regions={content.connectivity[id].regions}
            onChange={(regions) =>
              edit(
                (was) =>
                  ({
                    ...was,
                    connectivity: {
                      ...was.connectivity,
                      [id]: { ...was.connectivity[id], regions },
                    },
                  }) as QeegContent,
              )
            }
          />
        </fieldset>
      ))}
    </>
  );
}

const SCORES = Array.from({ length: 11 }, (_, score) => score);

function DashboardSection({ content, edit }: { content: QeegContent; edit: Edit }) {
  return (
    <>
      {DIMENSION_IDS.map((dimension) => {
        const entry = content.dashboard[dimension];
        const earlier =
          content.edition === 'follow-up' ? content.dashboard[dimension].earlierScore : null;
        return (
          <fieldset key={dimension} className="qeeg-item">
            <legend className="qeeg-item__title">
              {en(`dimension.${dimension}.title`, content.edition)}
            </legend>
            <Select
              id={`qeeg-score-${dimension}`}
              label="Score out of 10"
              value={entry.score === null ? '' : String(entry.score)}
              onChange={(event) => {
                const typed = event.currentTarget.value;
                const score = typed === '' ? null : Number(typed);
                edit(
                  (was) =>
                    ({
                      ...was,
                      dashboard: {
                        ...was.dashboard,
                        [dimension]: { ...was.dashboard[dimension], score },
                      },
                    }) as QeegContent,
                );
              }}
            >
              <option value="">Not scored</option>
              {SCORES.map((score) => (
                <option key={score} value={String(score)}>
                  {score}
                </option>
              ))}
            </Select>
            {earlier !== null ? (
              <p className="small muted">
                Earlier report: {fill(en('label.earlier_score', 'follow-up'), { score: earlier })}
              </p>
            ) : null}
            <Textarea
              id={`qeeg-evidence-${dimension}`}
              label={`${en('label.evidence', content.edition)}, if you want to give it`}
              maxLength={LIMITS.evidence}
              value={entry.evidence?.en ?? ''}
              onChange={(event) => {
                const text = event.currentTarget.value;
                edit(
                  (was) =>
                    ({
                      ...was,
                      dashboard: {
                        ...was.dashboard,
                        [dimension]: {
                          ...was.dashboard[dimension],
                          evidence:
                            text === '' && !was.dashboard[dimension].evidence?.ar
                              ? null
                              : { en: text, ar: was.dashboard[dimension].evidence?.ar ?? null },
                        },
                      },
                    }) as QeegContent,
                );
              }}
            />
          </fieldset>
        );
      })}
    </>
  );
}

type SessionsPick = number | 'other' | typeof QEEG_ONLY | null;

function sessionsPick(sessions: number | typeof QEEG_ONLY | null): SessionsPick {
  if (sessions === null || sessions === QEEG_ONLY) return sessions;
  return (SESSION_OPTIONS as readonly number[]).includes(sessions) ? sessions : 'other';
}

function ProgrammeSection({ content, edit }: { content: QeegContent; edit: Edit }) {
  const sessions = content.plan.sessions;
  const [pick, setPick] = useState<SessionsPick>(() => sessionsPick(sessions));
  const [other, setOther] = useState(() =>
    typeof sessions === 'number' && sessionsPick(sessions) === 'other' ? String(sessions) : '',
  );
  const otherNumber = wholeNumberIn(other);
  const otherValid = isSessionCount(otherNumber);

  // What the choice clears is the domain's (`chooseSessions`).
  const setSessions = (next: number | typeof QEEG_ONLY | null) =>
    edit((was) => chooseSessions(was, next));

  const choose = (next: SessionsPick) => {
    setPick(next);
    if (next === 'other') setSessions(otherValid ? otherNumber : null);
    else setSessions(next);
  };

  const options: { value: SessionsPick; label: string }[] = [
    ...SESSION_OPTIONS.map((count) => ({ value: count, label: sessionLabel(count, 'en') })),
    { value: 'other', label: 'Another number' },
    ...(content.edition === 'initial'
      ? [{ value: QEEG_ONLY as SessionsPick, label: en('label.qeeg_only', 'initial') }]
      : []),
  ];

  return (
    <>
      <fieldset className="qeeg-item">
        <legend className="qeeg-item__title">{en('label.sessions', content.edition)}</legend>
        <div
          className="qeeg-choices"
          role="radiogroup"
          aria-label={en('label.sessions', content.edition)}
        >
          {options.map((option) => (
            <label key={String(option.value)} className="checkbox">
              <input
                type="radio"
                name="qeeg-sessions"
                checked={pick === option.value}
                onChange={() => choose(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {pick === 'other' ? (
          <Field
            id="qeeg-sessions-other"
            label="Number of sessions"
            inputMode="numeric"
            value={other}
            error={
              other.trim() !== '' && !otherValid
                ? `A whole number from 1 to ${LIMITS.sessionsMost}.`
                : undefined
            }
            onChange={(event) => {
              const typed = event.currentTarget.value;
              setOther(typed);
              const n = wholeNumberIn(typed);
              setSessions(isSessionCount(n) ? n : null);
            }}
          />
        ) : null}
      </fieldset>
      {content.edition === 'initial' ? (
        !programmeAgreed(content) ? (
          <p className="small muted">
            No programme has been agreed, so the report prints neither the programme length nor the
            training approach.
          </p>
        ) : (
          <Choice
            id="qeeg-approach"
            label={en('heading.approach', 'initial')}
            value={content.plan.approach}
            options={APPROACH_IDS.map((value) => ({
              value,
              label: en(`approach.${value}.label`, 'initial'),
            }))}
            onChange={(approach) =>
              edit((was) =>
                was.edition === 'initial' ? { ...was, plan: { ...was.plan, approach } } : was,
              )
            }
          />
        )
      ) : (
        <Choice
          id="qeeg-next"
          label={en('heading.approach', 'follow-up')}
          value={content.plan.next}
          options={NEXT_STAGE_IDS.map((value) => ({
            value,
            label: en(`next.${value}.label`, 'follow-up'),
          }))}
          onChange={(next) =>
            edit((was) =>
              was.edition === 'follow-up' ? { ...was, plan: { ...was.plan, next } } : was,
            )
          }
        />
      )}
    </>
  );
}

function measureName(measure: MeasureId): string {
  const { from, to } = MEASURE_RANGES[measure];
  return fill(en('measure.with_range', 'follow-up'), {
    name: en(`measure.${measure}`, 'follow-up'),
    from,
    to,
  });
}

/** The rows chosen, placed in the list's order from 0, as the shape requires. */
function placed(table: QeegFollowUp['change']['table']): Partial<Record<MeasureId, ChangeRow>> {
  const rows: Partial<Record<MeasureId, ChangeRow>> = {};
  let position = 0;
  for (const measure of MEASURE_IDS) {
    const row = table[measure];
    if (row) {
      rows[measure] = { ...row, position };
      position += 1;
    }
  }
  return rows;
}

function ChangeSection({ content, edit }: { content: QeegFollowUp; edit: Edit }) {
  const { change } = content;
  const setChange = (next: (was: QeegFollowUp['change']) => QeegFollowUp['change']) =>
    edit((was) => (was.edition === 'follow-up' ? { ...was, change: next(was.change) } : was));
  const tiles = Object.entries(change.tiles).sort(([, a], [, b]) => a.position - b.position);
  const [sessionsText, setSessionsText] = useState(() =>
    change.sessionsCompleted ? String(change.sessionsCompleted.count) : '',
  );
  const sessionsValid = isSessionCount(wholeNumberIn(sessionsText));

  return (
    <>
      <p className="small muted">
        Every figure on this page is optional, and is your own estimate. A row or a headline left
        empty is not printed.
      </p>

      <PairsField content={content} edit={edit} />

      <fieldset className="qeeg-item">
        <legend className="qeeg-item__title">Headlines</legend>
        {tiles.map(([key, tile]) => (
          <div key={key} className="qeeg-own">
            <p>
              {tile.caption.en}: {figureText(tile.figure, 'en')}
            </p>
            <Button
              variant="quiet"
              onClick={() =>
                setChange((was) => ({
                  ...was,
                  tiles: Object.fromEntries(
                    Object.entries(was.tiles)
                      .filter(([each]) => each !== key)
                      .sort(([, a], [, b]) => a.position - b.position)
                      .map(([each, item], position) => [each, { ...item, position }]),
                  ),
                }))
              }
            >
              Remove this headline
            </Button>
          </div>
        ))}
        {tiles.length < LIMITS.tiles ? (
          <NewHeadline
            onAdd={(tile) =>
              setChange((was) => {
                let n = 0;
                while (Object.hasOwn(was.tiles, `t${n}`)) n += 1;
                return {
                  ...was,
                  tiles: {
                    ...was.tiles,
                    [`t${n}`]: { ...tile, position: Object.keys(was.tiles).length },
                  },
                };
              })
            }
          />
        ) : null}
        <Field
          id="qeeg-sessions-completed"
          label={en('tile.sessions_completed', 'follow-up')}
          inputMode="numeric"
          value={sessionsText}
          error={
            sessionsText.trim() !== '' && !sessionsValid
              ? `A whole number from 1 to ${LIMITS.sessionsMost}.`
              : undefined
          }
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setSessionsText(typed);
            const n = wholeNumberIn(typed);
            setChange((was) => ({
              ...was,
              sessionsCompleted: isSessionCount(n) ? { count: n, source: 'typed' } : null,
            }));
          }}
        />
      </fieldset>

      <fieldset className="qeeg-item">
        <legend className="qeeg-item__title">{en('heading.change_table', 'follow-up')}</legend>
        {MEASURE_IDS.map((measure) => {
          const row = change.table[measure];
          return (
            <div key={measure} className="qeeg-measure">
              <label className="checkbox" htmlFor={`qeeg-measure-${measure}`}>
                <input
                  id={`qeeg-measure-${measure}`}
                  type="checkbox"
                  checked={row !== undefined}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setChange((was) => {
                      const table = { ...was.table };
                      if (on) table[measure] = { position: 0, eyesOpen: null, eyesClosed: null };
                      else delete table[measure];
                      return { ...was, table: placed(table) };
                    });
                  }}
                />
                <span>{measureName(measure)}</span>
              </label>
              {row ? (
                <div className="qeeg-measure__figures">
                  <FigureField
                    id={`qeeg-measure-${measure}-open`}
                    label={en('table.eyes_open', 'follow-up')}
                    figure={row.eyesOpen}
                    onChange={(figure) =>
                      setChange((was) => {
                        const at = was.table[measure];
                        if (!at) return was;
                        return {
                          ...was,
                          table: { ...was.table, [measure]: { ...at, eyesOpen: figure } },
                        };
                      })
                    }
                  />
                  <FigureField
                    id={`qeeg-measure-${measure}-closed`}
                    label={en('table.eyes_closed', 'follow-up')}
                    figure={row.eyesClosed}
                    onChange={(figure) =>
                      setChange((was) => {
                        const at = was.table[measure];
                        if (!at) return was;
                        return {
                          ...was,
                          table: { ...was.table, [measure]: { ...at, eyesClosed: figure } },
                        };
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <RichField
        id="qeeg-change-summary"
        label="What has changed, in your words"
        value={change.summary.en}
        most={LIMITS.summaryTyped}
        onChange={(text) => setChange((was) => ({ ...was, summary: { ...was.summary, en: text } }))}
      />
    </>
  );
}

function NewHeadline({
  onAdd,
}: {
  onAdd: (tile: { figure: TypedFigure; caption: { en: string; ar: null } }) => void;
}) {
  const [caption, setCaption] = useState('');
  const [figure, setFigure] = useState<TypedFigure | null>(null);
  const [round, setRound] = useState(0);
  const ready = figure !== null && caption.trim() !== '';
  return (
    <div className="qeeg-own" key={round}>
      <FigureField
        id={`qeeg-headline-${round}`}
        label="A new headline"
        figure={null}
        onChange={setFigure}
      />
      <Field
        id={`qeeg-headline-${round}-caption`}
        label="What the figure is"
        maxLength={LIMITS.caption}
        value={caption}
        onChange={(event) => setCaption(event.currentTarget.value)}
      />
      <Button
        disabled={!ready}
        onClick={() => {
          if (figure === null) return;
          onAdd({ figure, caption: { en: caption.trim(), ar: null } });
          setCaption('');
          setFigure(null);
          setRound((was) => was + 1);
        }}
      >
        Add this headline
      </Button>
    </div>
  );
}
