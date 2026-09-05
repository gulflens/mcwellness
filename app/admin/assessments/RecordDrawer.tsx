import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BANDS,
  BRAIN_MAP_CONDITIONS,
  REFERENCE_SEXES,
  SAMPLE_QUESTIONNAIRE,
  SITES,
  UNITS,
  scoreQuestionnaire,
  shapeFor,
  type Band,
  type Instrument,
  type Site,
  type Unit,
} from '@domain/assessment';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from '../../shell/components/useDrawer';
import { BAND_LABELS, GATE_MESSAGES, REFUSAL_MESSAGES, UNIT_LABELS } from './copy';

/**
 * Recording a measurement (docs/SPEC/assessment.md section 3.2).
 *
 * **A drawer, not a wizard.** The date and the instrument; then the figures,
 * laid out from the instrument's own declared shape — so a brain map asks for
 * band powers per site with their units, and a questionnaire asks its
 * questions and shows the total it computes. Beside the typed fields, one
 * free-text line for recording conditions, never instead of them (CLAUDE.md
 * rule 3).
 *
 * **The shape is the layout.** Every site, band, unit and question below comes
 * from `domain/assessment/shapes`, which is the same declaration the server
 * validates against, so this screen cannot ask for a field the validator does
 * not know and cannot omit one it requires.
 *
 * **It refuses with the field named.** A figure without its unit, an unknown
 * instrument, a payload the shape does not recognise: the server answers with
 * the field and the reason, and both are said here in words rather than left
 * for somebody to find.
 */

export type Recorded = { id: string };

type BrainMapDraft = {
  unit: Unit;
  condition: (typeof BRAIN_MAP_CONDITIONS)[number];
  /** Keyed `site.band`; an empty string means the recording has no figure there. */
  values: Record<string, string>;
};

type QuestionnaireDraft = { answers: Record<string, string> };

const emptyBrainMap = (): BrainMapDraft => ({
  unit: 'uV2',
  condition: 'eyes-closed',
  values: {},
});

const emptyQuestionnaire = (): QuestionnaireDraft => ({ answers: {} });

/** The figures a person actually typed, as the shape declares them. */
function figuresFrom(
  draft: BrainMapDraft,
): { site: Site; band: Band; value: number; unit: Unit }[] {
  const figures: { site: Site; band: Band; value: number; unit: Unit }[] = [];
  for (const site of SITES) {
    for (const band of BANDS) {
      const typed = draft.values[`${site}.${band}`]?.trim() ?? '';
      if (typed === '') continue;
      figures.push({ site, band, value: Number(typed), unit: draft.unit });
    }
  }
  return figures;
}

export function RecordDrawer({
  clientId,
  today,
  onClose,
  onRecorded,
}: {
  clientId: string;
  /** The date the drawer opens on, as YYYY-MM-DD in the practice's own zone. */
  today: string;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [instrument, setInstrument] = useState<Instrument>('qeeg');
  const [performedOn, setPerformedOn] = useState(today);
  const [software, setSoftware] = useState('');
  const [softwareVersion, setSoftwareVersion] = useState('');
  const [referenceAge, setReferenceAge] = useState('');
  const [referenceSex, setReferenceSex] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [brainMap, setBrainMap] = useState<BrainMapDraft>(emptyBrainMap);
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireDraft>(emptyQuestionnaire);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = shapeFor(instrument);
  const instrumentVersion = shape?.versions[0] ?? '1';

  const scored = useMemo(() => {
    if (instrument !== 'questionnaire.sample') return null;
    const answers = SAMPLE_QUESTIONNAIRE.questions
      .map((question) => ({
        key: question.key,
        value: Number(questionnaire.answers[question.key] ?? ''),
      }))
      .filter((answer) => Number.isFinite(answer.value));
    if (answers.length !== SAMPLE_QUESTIONNAIRE.questions.length) return null;
    const result = scoreQuestionnaire(instrument, answers);
    return result.ok ? result.value : null;
  }, [instrument, questionnaire]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    const provenance = { software: software.trim(), softwareVersion: softwareVersion.trim() };
    const derived =
      instrument === 'qeeg'
        ? {
            kind: 'brain-map',
            provenance,
            condition: brainMap.condition,
            figures: figuresFrom(brainMap),
          }
        : {
            kind: 'questionnaire',
            provenance,
            answers: SAMPLE_QUESTIONNAIRE.questions.map((question) => ({
              key: question.key,
              value: Number(questionnaire.answers[question.key] ?? ''),
            })),
            total: scored?.total ?? -1,
            maximum: scored?.maximum ?? -1,
          };
    try {
      const res = await apiFetch('/api/assessments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          instrument,
          instrumentVersion,
          // Midday in the practice's own zone: the drawer records a day, and a
          // day written as midnight walks backwards for anyone reading it in
          // UTC.
          performedAt: `${performedOn}T12:00:00+04:00`,
          derived,
          conditionNote: conditionNote.trim() === '' ? null : conditionNote.trim(),
          referenceAgeYears: referenceAge.trim() === '' ? null : Number(referenceAge),
          referenceSex: referenceSex === '' ? null : referenceSex,
          deliveryMode: 'home',
        }),
      });
      if (res.ok) {
        onRecorded();
        return;
      }
      const answer = (await res.json().catch(() => null)) as {
        code?: string;
        field?: string;
        reason?: string;
      } | null;
      if (answer?.field && answer.reason) {
        setError(`${answer.field}: ${REFUSAL_MESSAGES[answer.reason] ?? 'That is not recorded.'}`);
        return;
      }
      setError(
        GATE_MESSAGES[answer?.code ?? ''] ?? 'That could not be recorded. Check it and try again.',
      );
    } catch {
      setError('That could not be recorded. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }, [
    apiFetch,
    brainMap,
    clientId,
    conditionNote,
    instrument,
    instrumentVersion,
    onRecorded,
    performedOn,
    questionnaire,
    referenceAge,
    referenceSex,
    scored,
    software,
    softwareVersion,
  ]);

  const figureCount = instrument === 'qeeg' ? figuresFrom(brainMap).length : 0;
  const canSave =
    !busy &&
    software.trim() !== '' &&
    softwareVersion.trim() !== '' &&
    (instrument === 'qeeg' ? figureCount > 0 : scored !== null);

  return (
    <aside className="drawer" role="dialog" aria-labelledby="record-drawer-title" ref={drawerRef}>
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="record-drawer-title">Record a measurement</h2>
          <p className="small muted">
            The figures the equipment&rsquo;s own software reported, kept as it reported them.
          </p>
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
      <div className="drawer__body">
        <div className="drawer__form">
          <Select
            id="assessment-instrument"
            label="Instrument"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value as Instrument)}
          >
            <option value="qeeg">Brain map</option>
            <option value="questionnaire.sample">Questionnaire</option>
          </Select>
          <Field
            id="assessment-date"
            label="Taken on"
            type="date"
            value={performedOn}
            onChange={(e) => setPerformedOn(e.target.value)}
          />
          <Field
            id="assessment-software"
            label="Software that produced the figures"
            hint="So a figure can always be traced back to what computed it."
            value={software}
            onChange={(e) => setSoftware(e.target.value)}
          />
          <Field
            id="assessment-software-version"
            label="Its version"
            value={softwareVersion}
            onChange={(e) => setSoftwareVersion(e.target.value)}
          />

          {instrument === 'qeeg' ? (
            <>
              <Select
                id="assessment-condition"
                label="Eyes"
                value={brainMap.condition}
                onChange={(e) =>
                  setBrainMap({
                    ...brainMap,
                    condition: e.target.value as BrainMapDraft['condition'],
                  })
                }
              >
                <option value="eyes-closed">Closed</option>
                <option value="eyes-open">Open</option>
              </Select>
              <Select
                id="assessment-unit"
                label="What the figures are in"
                hint="Every figure carries its unit. A number with no unit cannot be compared with next quarter's."
                value={brainMap.unit}
                onChange={(e) => setBrainMap({ ...brainMap, unit: e.target.value as Unit })}
              >
                {UNITS.filter((unit) => unit !== 'points').map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_LABELS[unit]}
                  </option>
                ))}
              </Select>
              <div className="figures">
                <table>
                  <caption className="visually-hidden">
                    Band figures per site, as the software reported them
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Site</th>
                      {BANDS.map((band) => (
                        <th key={band} scope="col">
                          <span className="band">
                            <span
                              className={`band__swatch band__swatch--${band}`}
                              aria-hidden="true"
                            />
                            {BAND_LABELS[band]}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SITES.map((site) => (
                      <tr key={site}>
                        <th scope="row" className="numeric">
                          {site}
                        </th>
                        {BANDS.map((band) => (
                          <td key={band}>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              aria-label={`${site} ${BAND_LABELS[band]}`}
                              value={brainMap.values[`${site}.${band}`] ?? ''}
                              onChange={(e) =>
                                setBrainMap({
                                  ...brainMap,
                                  values: {
                                    ...brainMap.values,
                                    [`${site}.${band}`]: e.target.value,
                                  },
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                {figureCount} {figureCount === 1 ? 'figure' : 'figures'} typed. Leave a cell empty
                where the software reported nothing.
              </p>
            </>
          ) : (
            <>
              {SAMPLE_QUESTIONNAIRE.questions.map((question) => (
                <Select
                  key={question.key}
                  id={`assessment-${question.key}`}
                  label={question.labelEn}
                  value={questionnaire.answers[question.key] ?? ''}
                  onChange={(e) =>
                    setQuestionnaire({
                      answers: { ...questionnaire.answers, [question.key]: e.target.value },
                    })
                  }
                >
                  <option value="">Not answered</option>
                  {Array.from(
                    { length: question.max - question.min + 1 },
                    (_, index) => question.min + index,
                  ).map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </Select>
              ))}
              <p className="small muted">
                {scored === null
                  ? 'Answer every question and the total appears here.'
                  : `Total ${scored.total} out of ${scored.maximum}.`}
              </p>
            </>
          )}

          <Field
            id="assessment-reference-age"
            label="Age the software compared against"
            hint="What the software's own reference database used, as it used it. Leave empty where it made no comparison."
            type="number"
            inputMode="numeric"
            value={referenceAge}
            onChange={(e) => setReferenceAge(e.target.value)}
          />
          <Select
            id="assessment-reference-sex"
            label="Sex the software compared against"
            value={referenceSex}
            onChange={(e) => setReferenceSex(e.target.value)}
          >
            <option value="">Not stated</option>
            {REFERENCE_SEXES.map((sex) => (
              <option key={sex} value={sex}>
                {sex === 'female' ? 'Female' : sex === 'male' ? 'Male' : 'Not known'}
              </option>
            ))}
          </Select>
          <Field
            id="assessment-condition-note"
            label="Recording conditions"
            hint="The room, an artefact worth mentioning. Beside the figures, never instead of them."
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
          />

          <div role="status">{error ? <Note tone="critical">{error}</Note> : null}</div>
          <div className="drawer__actions">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
              Record
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
