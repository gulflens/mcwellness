import { describe, expect, it } from 'vitest';
import { FIGURE_SENTENCES } from '../../../api/reports/qeeg/figureSchema';
import {
  CANNOT_COMPARE,
  DRAFT_REFUSALS,
  FIGURE_REFUSALS,
  figureRefusalSentence,
  refusalSentence,
} from './refusals';

/**
 * Every refusal the brain-map draft route answers has a sentence of its own
 * (app/api/reports/qeegDraft.ts), so a practitioner is told what happened and
 * never "something went wrong".
 */

describe('what the form says when a save is refused', () => {
  it('has a different sentence for every code the route answers', () => {
    const codes = [
      'invalid_request',
      'reason_required',
      'invalid_content',
      'route_owned',
      'wrong_kind',
      'already_issued',
      'imported_draft',
      'locale_fixed',
      'cannot_compare',
      'stale_draft',
    ];
    for (const code of codes) expect(DRAFT_REFUSALS[code]).toBeTruthy();
    expect(new Set(codes.map((code) => DRAFT_REFUSALS[code])).size).toBe(codes.length);
  });

  it('reads the code the route puts in `code`, or in `error` where it has no code', () => {
    expect(refusalSentence(409, { error: 'conflict', code: 'stale_draft' })).toBe(
      DRAFT_REFUSALS['stale_draft'],
    );
    expect(refusalSentence(400, { error: 'reason_required' })).toBe(
      DRAFT_REFUSALS['reason_required'],
    );
  });

  it('says who may not, and what cannot be found', () => {
    expect(refusalSentence(403, { error: 'forbidden' })).toMatch(/not allowed/);
    expect(refusalSentence(404, { error: 'not_found' })).toMatch(/could not be found/);
  });

  it('says why a comparison was refused, reason by reason', () => {
    for (const reason of Object.keys(CANNOT_COMPARE)) {
      expect(refusalSentence(422, { code: 'cannot_compare', reason })).toBe(CANNOT_COMPARE[reason]);
    }
    expect(new Set(Object.values(CANNOT_COMPARE)).size).toBe(Object.keys(CANNOT_COMPARE).length);
  });

  it('names the section and the reason of a field the shape refused', () => {
    const sentence = refusalSentence(400, {
      code: 'invalid_content',
      field: 'findings.custom.c0.label.en',
      refusals: [
        { path: 'findings.custom.c0.label.en', reason: 'A label she adds is never empty.' },
      ],
    });
    expect(sentence).toBe(
      'Something in Key findings is not what the report accepts: A label she adds is never empty.',
    );
  });

  it('falls back to a plain sentence for anything else', () => {
    expect(refusalSentence(500, null)).toBe(
      'The draft could not be saved. Check the connection and try again.',
    );
  });
});

describe('what the form says when a map is refused', () => {
  it('has a sentence for every refusal of a picture the door gives', () => {
    for (const code of Object.keys(FIGURE_SENTENCES)) {
      expect(FIGURE_REFUSALS[code], code).toBeTruthy();
    }
  });

  it('has a sentence for every other code the two doors answer', () => {
    const codes = [
      'invalid_request',
      'digest_missing',
      'digest_mismatch',
      'empty_body',
      'reason_required',
      'wrong_kind',
      'storage_unavailable',
      'unsupported_media_type',
      'figure_in_use',
    ];
    for (const code of codes) expect(FIGURE_REFUSALS[code], code).toBeTruthy();
  });

  it('gives every refusal a sentence of its own', () => {
    const sentences = Object.values(FIGURE_REFUSALS);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('has a sentence for every refusal the form makes before sending', () => {
    for (const code of [
      'too_wide',
      'too_tall',
      'too_many_pixels',
      'too_many_bytes',
      'empty',
      'too_many_maps',
      'undecodable',
    ]) {
      expect(figureRefusalSentence(0, { code }), code).toBe(FIGURE_REFUSALS[code]);
    }
  });

  it('reads the code in `code`, or in `error` where there is none', () => {
    expect(figureRefusalSentence(422, { error: 'unprocessable', code: 'too_many_maps' })).toBe(
      FIGURE_REFUSALS['too_many_maps'],
    );
    expect(figureRefusalSentence(503, { error: 'storage_unavailable' })).toBe(
      FIGURE_REFUSALS['storage_unavailable'],
    );
  });

  it('names where a map is still used', () => {
    expect(
      figureRefusalSentence(409, {
        code: 'figure_in_use',
        field: 'change.pairs.eyes_open.later.figureId',
      }),
    ).toBe(
      'This map is still used in What has changed, before and after, eyes open, the later side. Take it out there first, then remove it.',
    );
    expect(figureRefusalSentence(409, { code: 'figure_in_use', field: 'maps.m0.figureId' })).toBe(
      'This map is still used in the saved list of brain maps. Take it out there first, then remove it.',
    );
  });

  it('says who may not, what is gone, and anything else plainly', () => {
    expect(figureRefusalSentence(403, { error: 'forbidden' })).toMatch(/not allowed/);
    expect(figureRefusalSentence(404, { error: 'not_found' })).toMatch(/could not be found/);
    expect(figureRefusalSentence(500, null)).toBe(
      'The map could not be sent. Check the connection and try again.',
    );
  });

  it('explains a save refused over a map it names', () => {
    expect(refusalSentence(400, { code: 'unlinked_figure', field: 'maps.m0.figureId' })).toMatch(
      /^A map the report names is not on this draft/,
    );
    expect(refusalSentence(400, { code: 'figure_mismatch', field: 'maps.m0.sha256' })).toMatch(
      /does not match the picture on file/,
    );
    expect(
      refusalSentence(422, {
        code: 'cannot_compare',
        reason: 'map_not_held',
        field: 'change.pairs.eyes_open.earlier.figureId',
      }),
    ).toBe(CANNOT_COMPARE['map_not_held']);
  });
});
