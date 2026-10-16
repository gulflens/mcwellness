import { describe, expect, it } from 'vitest';
import { REPORT_KINDS, REPORT_STATUSES } from '../../domain/reports';
import {
  editorKindFor,
  isCorrectedHere,
  kindLabel,
  kindWord,
  mayBeSent,
  statusTone,
  statusWord,
} from '../../app/admin/reports/kinds';

/**
 * The console's words for a report's kind and status, and which rows the two
 * kinds' editor opens (docs/SPEC/reports-qeeg.md sections 11 and 13): every
 * kind and every status the database knows has an answer, and the two kinds
 * that were there before answer exactly as they did.
 */

describe('the words for a kind', () => {
  it('names every kind the database knows', () => {
    for (const kind of REPORT_KINDS) {
      expect(kindWord(kind).length, kind).toBeGreaterThan(0);
      expect(kindLabel(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('keeps the two kinds that were there before as they were', () => {
    expect(kindWord('session')).toBe('Session');
    expect(kindWord('progress')).toBe('Progress');
    expect(kindLabel('session')).toBe('Session report');
    expect(kindLabel('progress')).toBe('Progress report');
  });

  it('calls a brain-map report one', () => {
    expect(kindWord('qeeg')).toBe('Brain map');
    expect(kindLabel('qeeg')).toBe('Brain map report');
  });

  it('calls a PDF made in another tool an uploaded report', () => {
    expect(kindWord('external')).toBe('Uploaded');
    expect(kindLabel('external')).toBe('Uploaded report');
  });
});

describe('the words for a status', () => {
  it('names every status the database knows', () => {
    for (const status of REPORT_STATUSES) {
      expect(statusWord(status).length, status).toBeGreaterThan(0);
    }
  });

  it('keeps the three that were there before as they were', () => {
    expect([statusWord('draft'), statusTone('draft')]).toEqual(['Draft', 'neutral']);
    expect([statusWord('issued'), statusTone('issued')]).toEqual(['Issued', 'ok']);
    expect([statusWord('superseded'), statusTone('superseded')]).toEqual(['Replaced', 'neutral']);
  });

  it('calls a past record brought in from the old tool one', () => {
    expect([statusWord('imported'), statusTone('imported')]).toEqual(['Past record', 'neutral']);
  });
});

describe('which rows the editor opens', () => {
  it('opens a session or a progress draft in the editor for its own kind', () => {
    expect(editorKindFor('session')).toBe('session');
    expect(editorKindFor('progress')).toBe('progress');
  });

  it('opens no brain-map report in it, because that editor is not this one', () => {
    expect(editorKindFor('qeeg')).toBeNull();
  });

  it('opens no uploaded report in it, because there is nothing of it to write', () => {
    expect(editorKindFor('external')).toBeNull();
  });
});

describe('which reports are corrected here', () => {
  it('corrects the kinds written here, and not a PDF made elsewhere', () => {
    expect(isCorrectedHere('session')).toBe(true);
    expect(isCorrectedHere('progress')).toBe(true);
    expect(isCorrectedHere('qeeg')).toBe(true);
    expect(isCorrectedHere('external')).toBe(false);
  });
});

describe('which reports may be sent', () => {
  it('offers sending for a signed report, issued or replaced, and nothing else', () => {
    expect(mayBeSent('issued')).toBe(true);
    expect(mayBeSent('superseded')).toBe(true);
    expect(mayBeSent('draft')).toBe(false);
    expect(mayBeSent('imported')).toBe(false);
  });
});
