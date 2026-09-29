/**
 * Reads a report the practice wrote in its old tool into a PAST RECORD of
 * this app.
 *
 * **What it is for.** For months the practice wrote its brain-map reports in
 * a desktop tool that saved each one as a `.qeeg.json` file. A follow-up
 * written in this app is compared with an earlier report, and for most
 * clients the earlier report is one of those files. This module turns one
 * into the content of a first report (`QeegInitial`), under this app's names.
 *
 * **A record of what was chosen, never a report to sign.** The old report
 * was printed once, by the old tool, in the old tool's words. This app never
 * signs or prints it again. What comes out is the record of the choices, and
 * `provenance` says where it came from and what could not be carried.
 *
 * **Why `edition` is always `initial`.** The old tool offered only a first
 * report's lists, whatever the practitioner called the assessment. What she
 * called it is kept as `stage`.
 *
 * **Why the person is not in `content`.** A report's name, age and sex are
 * gathered from the client's record by the server, never typed. The old file
 * typed them, so they are handed back beside the content, in `asTyped`, for
 * the screen to show next to the client the practitioner chooses. They are
 * never put in `content`.
 *
 * **Why the maps come back apart.** A map is stored and referred to only after
 * it is uploaded, which is not this module's work. The images are handed back
 * as the file held them, and `content.maps` is empty.
 *
 * **Tolerant as the old tool was, and honest about it.** The old tool's own
 * reader (`ReportState.fromJson`) filled a short list with blanks, ignored a
 * long one, and printed 5 for a score nobody set. This reader does the same,
 * and wherever it changed or left out something the file held, it adds an
 * `ImportNote` naming the FIELD. A note never holds what was typed.
 *
 * It is pure and it never throws: whatever it is given, it returns a result.
 * The caller hashes the file's bytes; nothing here does I/O.
 */

import type { ApproachId, BandId, ConnectivityId, DimensionId, RegionId } from '../catalogue/ids';
import { BAND_IDS, CONNECTIVITY_IDS, DIMENSION_IDS } from '../catalogue/ids';
import type {
  Bilingual,
  Condition,
  CustomItem,
  ImportNote,
  ImportNoteCode,
  InitialBand,
  InitialConnectivity,
  Mark,
  Ordered,
  Picked,
  QeegInitial,
  RichText,
  Score,
  Stage,
} from '../types';
import { clean, isRealDay } from '../text';
import { LIMITS } from '../types';
import { LEGACY_FORMAT, LEGACY_SUBJECT_KEY, LEGACY_VERSION } from './keys';
import { fromQuillDelta } from './quill';
import {
  APPROACHES_BY_POSITION,
  BAND_LEVEL_BY_OLD_WORD,
  BANDS_BY_POSITION,
  BENEFITS_BY_POSITION,
  CONDITION_BY_OLD_LABEL,
  CONNECTIVITY_LEVEL_BY_OLD_WORD,
  DIMENSIONS_BY_POSITION,
  EYES_BY_OLD_WORD,
  FINDINGS_BY_POSITION,
  FOCUS_BY_POSITION,
  HAND_BY_OLD_WORD,
  MEASURE_BY_OLD_KEY,
  RECOMMENDATIONS_BY_POSITION,
  REGIONS_BY_POSITION,
  STAGE_BY_OLD_WORD,
} from './v1Tables';

export type LegacyImage = {
  /** 'map-0', 'map-1', and so on, in the file's order. */
  key: string;
  /** As the file held it; the browser decodes it. */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  condition: Condition | null;
  caption: Bilingual | null;
};

/** What the old file typed about the person, for the screen to show beside the chosen client. */
export type AsTyped = { name: string; age: string; sex: string };

export type LegacyRefusal = 'not_an_object' | 'not_a_report_file' | 'unknown_version';

export type LegacyRead =
  | {
      ok: true;
      content: QeegInitial;
      asTyped: AsTyped;
      images: LegacyImage[];
      notes: ImportNote[];
    }
  | { ok: false; reason: LegacyRefusal };

// ---------------------------------------------------------------------------
// Reading loosely typed values
// ---------------------------------------------------------------------------

type Loose = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A key's own value, never one inherited from the object's prototype. */
function field(record: Loose, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** A table's own row, so a word like "constructor" is never mistaken for one. */
function lookUp<T>(table: Readonly<Record<string, T>>, word: string): T | undefined {
  return Object.hasOwn(table, word) ? table[word] : undefined;
}

/** Text as the old tool read it: a string as it is, a number or a truth as it would print. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

// ---------------------------------------------------------------------------
// The notes
// ---------------------------------------------------------------------------

class Notes {
  readonly list: ImportNote[] = [];

  add(code: ImportNoteCode, at: string): void {
    if (!this.list.some((n) => n.code === code && n.at === at)) this.list.push({ code, at });
  }

  /**
   * Typed text made fit to store by the rule the editor uses (`clean`), with
   * a note when that left out more than the white space at its two ends.
   */
  limited(value: string, limit: number, at: string): string {
    const kept = clean(value, limit);
    if (kept.length < value.normalize('NFC').trim().length) this.add('text_shortened', at);
    return kept;
  }

  /** Her English and her Arabic, or null when she typed neither. */
  bilingual(en: string, ar: string, limit: number, at: string): Bilingual | null {
    const english = this.limited(en, limit, `${at}.en`);
    const arabic = this.limited(ar, limit, `${at}.ar`);
    if (english === '' && arabic === '') return null;
    return { en: english, ar: arabic === '' ? null : arabic };
  }
}

// ---------------------------------------------------------------------------
// Lists read by position
// ---------------------------------------------------------------------------

/** The names ticked in a row of ticks. Only `true` is a tick, as in the old tool. */
function ticked<Id extends string>(
  value: unknown,
  table: readonly Id[],
  at: string,
  notes: Notes,
): Id[] {
  if (!Array.isArray(value)) return [];
  const row = value as readonly unknown[];
  if (row.length > table.length) notes.add('extra_positions_ignored', at);
  return table.filter((_, i) => i < row.length && row[i] === true);
}

/** What she added to a list: items with text, the first twelve, keyed c0 onwards. */
function customItems(
  value: unknown,
  at: string,
  withNote: boolean,
  notes: Notes,
): Ordered<CustomItem> {
  if (!Array.isArray(value)) return {};
  const items = (value as readonly unknown[])
    .filter(isRecord)
    .filter((item) => clean(text(field(item, 'text')), LIMITS.label) !== '');
  if (items.length > LIMITS.customPerList) notes.add('extra_positions_ignored', `${at}.custom`);
  const out: Record<string, CustomItem & { position: number }> = {};
  items.slice(0, LIMITS.customPerList).forEach((item, position) => {
    const key = `c${position}`;
    const where = `${at}.custom.${key}`;
    const label = notes.bilingual(
      text(field(item, 'text')),
      text(field(item, 'textAr')),
      LIMITS.label,
      `${where}.label`,
    );
    out[key] = {
      // Never null: an item with no text was left out above.
      label: label ?? { en: '', ar: null },
      note: withNote
        ? notes.bilingual(
            text(field(item, 'note')),
            text(field(item, 'noteAr')),
            LIMITS.note,
            `${where}.note`,
          )
        : null,
      chosen: field(item, 'checked') !== false,
      position,
    };
  });
  return out;
}

function picked<Id extends string>(
  file: Loose,
  tickKey: string,
  customKey: string,
  table: readonly Id[],
  at: string,
  notes: Notes,
  withNote = false,
): Picked<Id> {
  return {
    chosen: ticked(field(file, tickKey), table, at, notes),
    custom: customItems(field(file, customKey), at, withNote, notes),
  };
}

/** The entry at `position` of a list the file may or may not hold. */
function entryAt(list: unknown, position: number): unknown {
  return Array.isArray(list) ? (list as readonly unknown[])[position] : undefined;
}

function longerThan(list: unknown, length: number): boolean {
  return Array.isArray(list) && list.length > length;
}

// ---------------------------------------------------------------------------
// Single choices, read by word
// ---------------------------------------------------------------------------

/** A word from a table, or null. A word the table does not know is noted; a blank is not. */
function chosenWord<T>(
  value: unknown,
  table: Readonly<Record<string, T>>,
  at: string,
  notes: Notes,
): T | null {
  const word = text(value);
  if (word === '') return null;
  const found = lookUp(table, word);
  if (found === undefined) {
    notes.add('value_not_recognised', at);
    return null;
  }
  return found;
}

function stageOf(value: unknown, notes: Notes): Stage {
  return chosenWord(value, STAGE_BY_OLD_WORD, 'stage', notes) ?? 'initial';
}

/** A real day written as YYYY-MM-DD, as the old tool's date picker wrote it, by the shape's rule. */
function dayOf(value: unknown, notes: Notes): string | null {
  const day = text(value).trim();
  if (day === '') return null;
  if (isRealDay(day)) return day;
  notes.add('value_not_recognised', 'recording.recordedOn');
  return null;
}

// ---------------------------------------------------------------------------
// The parts of the report
// ---------------------------------------------------------------------------

function bandsOf(file: Loose, notes: Notes): Readonly<Record<BandId, InitialBand>> {
  const list = field(file, 'bands');
  if (longerThan(list, BANDS_BY_POSITION.length)) notes.add('extra_positions_ignored', 'bands');
  const out = {} as Record<BandId, InitialBand>;
  BANDS_BY_POSITION.forEach((band, position) => {
    const entry = entryAt(list, position);
    const at = `bands.${band}`;
    out[band] = isRecord(entry)
      ? {
          level: chosenWord(field(entry, 'lvl'), BAND_LEVEL_BY_OLD_WORD, at, notes),
          regions: ticked(field(entry, 'regions'), REGIONS_BY_POSITION, `${at}.regions`, notes),
        }
      : { level: null, regions: [] };
  });
  // In this app's order, whatever the old order was.
  return Object.fromEntries(BAND_IDS.map((id) => [id, out[id]])) as Record<BandId, InitialBand>;
}

function connectivityOf(file: Loose, notes: Notes): InitialConnectivity {
  const links = field(file, 'links');
  // Each measure's level comes from that measure's own table, so the loose
  // type below is narrowed back to `InitialConnectivity` safely at the end.
  const out = {} as Record<ConnectivityId, { level: string | null; regions: RegionId[] }>;
  for (const [oldKey, measure] of Object.entries(MEASURE_BY_OLD_KEY)) {
    const entry = isRecord(links) ? field(links, oldKey) : undefined;
    const at = `connectivity.${measure}`;
    const levels: Readonly<Record<string, string>> = CONNECTIVITY_LEVEL_BY_OLD_WORD[measure];
    out[measure] = isRecord(entry)
      ? {
          level: chosenWord(field(entry, 'lvl'), levels, at, notes),
          regions: ticked(field(entry, 'regions'), REGIONS_BY_POSITION, `${at}.regions`, notes),
        }
      : { level: null, regions: [] };
  }
  return Object.fromEntries(
    CONNECTIVITY_IDS.map((id) => [id, out[id]]),
  ) as unknown as InitialConnectivity;
}

/** The whole number the old tool would have read, or null where it would have printed 5. */
function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  return /^\s*[+-]?\d{1,6}\s*$/.test(value) ? Number.parseInt(value, 10) : null;
}

function dashboardOf(file: Loose, notes: Notes): Readonly<Record<DimensionId, Score>> {
  const list = field(file, 'dims');
  if (longerThan(list, DIMENSIONS_BY_POSITION.length)) {
    notes.add('extra_positions_ignored', 'dashboard');
  }
  const out = {} as Record<DimensionId, Score>;
  DIMENSIONS_BY_POSITION.forEach((dimension, position) => {
    const entry = entryAt(list, position);
    const at = `dashboard.${dimension}`;
    const read = isRecord(entry) ? wholeNumber(field(entry, 'score')) : null;
    let score: number;
    if (read === null) {
      notes.add('score_defaulted', at);
      score = 5;
    } else if (read < 0 || read > 10) {
      notes.add('value_not_recognised', at);
      score = Math.min(10, Math.max(0, read));
    } else {
      score = read;
    }
    const evidence = isRecord(entry)
      ? notes.bilingual(
          text(field(entry, 'evid')),
          text(field(entry, 'evidAr')),
          LIMITS.evidence,
          `${at}.evidence`,
        )
      : null;
    out[dimension] = { score, evidence };
  });
  return Object.fromEntries(DIMENSION_IDS.map((id) => [id, out[id]])) as Record<DimensionId, Score>;
}

/**
 * Rich text made fit to store: trimmed and cut as `clean` would, with its
 * marks moved by what was trimmed from the start and kept inside what is
 * left. `removed` says the delta reader already took characters out.
 */
function limitedRich(rich: RichText, at: string, notes: Notes, removed: boolean): RichText {
  const lead = rich.text.length - rich.text.trimStart().length;
  const kept = clean(rich.text.slice(lead), LIMITS.summary);
  if (removed || kept.length < rich.text.trim().length) notes.add('text_shortened', at);
  const marks: Mark[] = rich.marks
    .map((m) => ({
      ...m,
      from: Math.max(0, m.from - lead),
      to: Math.min(kept.length, m.to - lead),
    }))
    .filter((m) => m.from < m.to);
  if (marks.length > LIMITS.marks) notes.add('extra_positions_ignored', `${at}.marks`);
  return { text: kept, marks: marks.slice(0, LIMITS.marks) };
}

/**
 * One language of the summary. The formatted version when it holds anything,
 * as the old tool printed it; otherwise the plain one, with no marks.
 */
function summaryIn(plainValue: unknown, richValue: unknown, at: string, notes: Notes): RichText {
  const plain = (): RichText => ({
    text: notes.limited(text(plainValue), LIMITS.summary, at),
    marks: [],
  });
  if (typeof richValue !== 'string') return plain();
  const read = fromQuillDelta(richValue);
  if (!read.ok) {
    notes.add('summary_formatting_unreadable', at);
    return plain();
  }
  if (read.rich.text.trim() === '') return plain();
  if (read.dropped.includes('colour')) notes.add('summary_colour_dropped', at);
  if (read.dropped.includes('slant')) notes.add('summary_slant_dropped', at);
  if (read.dropped.includes('embed') || read.dropped.includes('other')) {
    notes.add('summary_content_dropped', at);
  }
  return limitedRich(read.rich, at, notes, read.removed);
}

/**
 * The number of sessions, from the label the old form wrote: `N Session` or
 * `N Sessions`, and nothing else. A number found anywhere else in the text
 * (a range, a week, a fraction) is not taken for it.
 */
function sessionsOf(value: unknown, notes: Notes): number | null {
  const label = text(value);
  if (label.trim() === '') return null;
  const digits = /^\s*(\d{1,3})\s+Sessions?\s*$/i.exec(label);
  const count = digits?.[1] === undefined ? null : Number(digits[1]);
  if (count === null || count < 1 || count > LIMITS.sessionsMost) {
    notes.add('value_not_recognised', 'plan.sessions');
    return null;
  }
  return count;
}

function approachOf(value: unknown, notes: Notes): ApproachId | null {
  const written = text(value).trim();
  if (written === '') return null;
  const position = /^\d$/.test(written) ? Number(written) : -1;
  const approach = APPROACHES_BY_POSITION[position];
  if (approach === undefined) {
    notes.add('value_not_recognised', 'plan.approach');
    return null;
  }
  return approach;
}

/** A picture held in the file itself. Anything else would send the browser elsewhere. */
function imageUrl(img: unknown): string | null {
  if (!isRecord(img)) return null;
  const url = field(img, 'url');
  return typeof url === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(url) ? url : null;
}

function pixels(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function imagesOf(file: Loose, notes: Notes): LegacyImage[] {
  const slots = field(file, 'maps');
  if (!Array.isArray(slots)) return [];
  const images: LegacyImage[] = [];
  for (const slot of slots as readonly unknown[]) {
    if (!isRecord(slot)) continue;
    const label = text(field(slot, 'label')).trim();
    const img = field(slot, 'img');
    const url = imageUrl(img);
    if (url === null || !isRecord(img)) {
      const held = isRecord(img) && typeof field(img, 'url') === 'string';
      const herLabel = label !== '' && lookUp(CONDITION_BY_OLD_LABEL, label) === undefined;
      if (held || herLabel) notes.add('map_without_image_dropped', 'maps');
      continue;
    }
    if (images.length === LIMITS.maps) {
      notes.add('extra_positions_ignored', 'maps');
      break;
    }
    const key = `map-${images.length}`;
    const condition = label === '' ? null : (lookUp(CONDITION_BY_OLD_LABEL, label) ?? null);
    let caption: Bilingual | null = null;
    if (label !== '' && condition === null) {
      notes.add('map_label_kept_as_caption', `maps.${key}`);
      caption = { en: notes.limited(label, LIMITS.caption, `maps.${key}.caption.en`), ar: null };
    }
    images.push({
      key,
      dataUrl: url,
      widthPx: pixels(field(img, 'w')),
      heightPx: pixels(field(img, 'h')),
      condition,
      caption,
    });
  }
  return images;
}

/** Who the old report named beneath its signature, or null where it named nobody. */
function printed(value: unknown, at: string, notes: Notes): string | null {
  const written = notes.limited(text(value), LIMITS.label, at);
  return written === '' ? null : written;
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

function read(file: unknown, sourceSha256: string): LegacyRead {
  if (!isRecord(file)) return { ok: false, reason: 'not_an_object' };
  const subject = field(file, LEGACY_SUBJECT_KEY);
  if (!isRecord(subject)) return { ok: false, reason: 'not_a_report_file' };
  if (Object.hasOwn(file, 'v') && field(file, 'v') !== LEGACY_VERSION) {
    return { ok: false, reason: 'unknown_version' };
  }

  const notes = new Notes();

  const asTyped: AsTyped = {
    name: notes.limited(text(field(subject, 'name')), LIMITS.label, 'asTyped.name'),
    age: notes.limited(text(field(subject, 'age')), LIMITS.label, 'asTyped.age'),
    sex: notes.limited(text(field(subject, 'gender')), LIMITS.label, 'asTyped.sex'),
  };

  const stage = stageOf(field(subject, 'assess'), notes);
  const recording = {
    recordedOn: dayOf(field(subject, 'date'), notes),
    eyes: chosenWord(field(subject, 'eyes'), EYES_BY_OLD_WORD, 'recording.eyes', notes),
    handedness: chosenWord(field(subject, 'hand'), HAND_BY_OLD_WORD, 'recording.handedness', notes),
  };

  const findings = picked(file, 'kf', 'customKF', FINDINGS_BY_POSITION, 'findings', notes);
  const focus = picked(file, 'fa', 'customFA', FOCUS_BY_POSITION, 'focus', notes);
  const images = imagesOf(file, notes);
  const bands = bandsOf(file, notes);
  const connectivity = connectivityOf(file, notes);
  const dashboard = dashboardOf(file, notes);
  const recommendations = picked(
    file,
    'rc',
    'customRC',
    RECOMMENDATIONS_BY_POSITION,
    'recommendations',
    notes,
    true,
  );
  const english = summaryIn(
    field(file, 'summary'),
    field(file, 'summaryRich'),
    'summary.en',
    notes,
  );
  const arabic = summaryIn(
    field(file, 'summaryAr'),
    field(file, 'summaryRichAr'),
    'summary.ar',
    notes,
  );
  const benefits = picked(file, 'bn', 'customBN', BENEFITS_BY_POSITION, 'benefits', notes);
  const plan = {
    sessions: sessionsOf(field(file, 'sessions'), notes),
    approach: approachOf(field(file, 'approach'), notes),
  };
  const asPrinted = {
    signerName: printed(field(file, 'signer'), 'provenance.asPrinted.signerName', notes),
    signerRole: printed(field(file, 'role'), 'provenance.asPrinted.signerRole', notes),
  };
  const signature = field(file, 'signature');
  if (isRecord(signature) && typeof field(signature, 'url') === 'string') {
    notes.add('signature_image_dropped', 'signature');
  }

  const content: QeegInitial = {
    kind: 'qeeg',
    schema: 1,
    wording: 1,
    edition: 'initial',
    stage,
    provenance: {
      origin: 'legacy_tool',
      format: LEGACY_FORMAT,
      sourceSha256,
      notes: [...notes.list],
      asPrinted,
    },
    subject: { nameAr: null, ageYears: null, sex: null },
    recording,
    findings,
    focus,
    maps: {},
    bands,
    connectivity,
    dashboard,
    recommendations,
    summary: { en: english, ar: arabic.text.trim() === '' ? null : arabic },
    benefits,
    plan,
  };

  return { ok: true, content, asTyped, images, notes: [...notes.list] };
}

/**
 * One old report file, already parsed from JSON, read into a past record.
 * `sourceSha256` is the digest of the file's bytes, which the caller computes.
 */
export function readLegacyReport(file: unknown, sourceSha256: string): LegacyRead {
  try {
    return read(file, sourceSha256);
  } catch {
    // A value whose reading throws (a getter, a proxy) is not a file the old
    // tool wrote.
    return { ok: false, reason: 'not_a_report_file' };
  }
}
