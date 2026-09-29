/**
 * The names the old report tool's files are read by.
 *
 * **Another program's words, written once.** The tool the practice used
 * before this app kept each report as a `.qeeg.json` file, and it keeps the
 * person the report is about under a key of its own choosing. That key is the
 * other program's file format, not this app's vocabulary: a wellness practice
 * does not call its clients by it, and nothing in this app does. It is written
 * here, once, as the value of a constant, so the reader can open the file and
 * every other line of this app, tests and fixtures included, can say
 * `LEGACY_SUBJECT_KEY` instead. `vocabulary.test.ts` holds that this line is
 * the only one.
 *
 * **One version.** The old tool only ever wrote version 1, and read a file
 * with no version as version 1. So does the reader.
 */

/** The key the old file keeps the person's name, age and sex under. Another program's format. */
export const LEGACY_SUBJECT_KEY = 'patient';

/** What a past record's provenance says it was read from. */
export const LEGACY_FORMAT = 'qeeg.json/1' as const;

/** The only value of the old file's `v` the reader accepts. */
export const LEGACY_VERSION = 1 as const;
