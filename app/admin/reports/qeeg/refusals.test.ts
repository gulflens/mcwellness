import { describe, expect, it } from 'vitest';
import { FIGURE_SENTENCES } from '../../../api/reports/qeeg/figureSchema';
import {
  CANNOT_COMPARE,
  DRAFT_REFUSALS,
  FIGURE_REFUSALS,
  figureRefusalSentence,
  ISSUE_REFUSALS,
  issueRefusalSentence,
  listRefusalSentence,
  PREVIEW_REFUSALS,
  previewRefusalSentence,
  refusalSentence,
  SUPERSEDE_REFUSALS,
  supersedeRefusalSentence,
  TWIN_REFUSALS,
  twinRefusalSentence,
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

describe('the sentences fix round 1 asked for', () => {
  it('blames the form, not her export, for a picture the door finds damaged', () => {
    for (const code of ['damaged', 'split_data']) {
      expect(FIGURE_REFUSALS[code]).toMatch(/reload the page and try again\.$/);
      expect(FIGURE_REFUSALS[code]).not.toMatch(/Export/);
    }
  });

  it('has a sentence for an answer that never came, a picture that could not be prepared, and a file too large to read', () => {
    expect(FIGURE_REFUSALS['unknown_outcome']).toMatch(/may have been/);
    expect(FIGURE_REFUSALS['unknown_outcome']).not.toMatch(/not saved|could not be saved/);
    expect(FIGURE_REFUSALS['cannot_prepare']).toBeTruthy();
    expect(FIGURE_REFUSALS['file_too_large']).toMatch(/40 MB/);
  });
});

describe('the sentences fix round 2 asked for', () => {
  it('no longer has a sentence for a picture sent twice: the door files it once and says so', () => {
    expect(FIGURE_REFUSALS['already_on_report']).toBeUndefined();
  });

  it('says how many uploaded pictures not on the report could make room', () => {
    expect(figureRefusalSentence(422, { code: 'too_many_maps' }, { unplaced: 0 })).toBe(
      FIGURE_REFUSALS['too_many_maps'],
    );
    expect(figureRefusalSentence(0, { code: 'too_many_maps' }, { unplaced: 1 })).toBe(
      'A report holds eight maps. Remove one before adding another. 1 uploaded picture is not on the report; removing it makes room.',
    );
    expect(figureRefusalSentence(0, { code: 'too_many_maps' }, { unplaced: 2 })).toMatch(
      /2 uploaded pictures are not on the report; removing them makes room\.$/,
    );
  });

  it('has a sentence for every refusal of the list of a draft’s pictures', () => {
    for (const [status, body] of [
      [400, { error: 'bad_request', code: 'invalid_request' }],
      [403, { error: 'forbidden' }],
      [404, { error: 'not_found' }],
      [422, { error: 'unprocessable', code: 'wrong_kind' }],
    ] as const) {
      expect(listRefusalSentence(status, body)).toMatch(/pictures/);
    }
    const all = [400, 403, 404, 422, 500].map((status) =>
      listRefusalSentence(status, status === 422 ? { code: 'wrong_kind' } : {}),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it('says what the list showed after an answer that never came', () => {
    for (const code of ['kept_after_all', 'not_kept', 'removed_after_all', 'not_removed']) {
      expect(FIGURE_REFUSALS[code], code).toBeTruthy();
    }
  });
});

describe('what the form says when a preview, a signature or a correction is refused', () => {
  const ISSUE_CODES = [
    'invalid_request',
    'reason_required',
    'storage_unavailable',
    'imported_draft',
    'stale_draft',
    'invalid_content',
    'client_erased',
    'incomplete',
    'wording_draft',
    'unplaced_figures',
    'unlinked_figure',
    'map_missing',
    'map_differs',
    'overrun',
    'already_issued',
    'not_a_practitioner',
    'no_signing_credential',
    'credential_cannot_sign',
    'credential_lapsed',
    'credential_not_yet_valid',
  ];
  const PREVIEW_CODES = [
    'invalid_request',
    'storage_unavailable',
    'imported_draft',
    'imported_record',
    'invalid_content',
    'client_erased',
    'locale_fixed',
    'unlinked_figure',
    'map_missing',
    'map_differs',
    'overrun',
    'not_signed',
  ];
  const SUPERSEDE_CODES = [
    'invalid_request',
    'route_owned',
    'locale_fixed',
    'invalid_content',
    'not_issued',
    'already_superseded',
    'no_reason',
    'map_not_held',
    'not_permitted',
    'cannot_compare',
  ];

  it('has a different sentence for every code the issue route answers', () => {
    for (const code of ISSUE_CODES) expect(ISSUE_REFUSALS[code], code).toBeTruthy();
    expect(new Set(ISSUE_CODES.map((code) => ISSUE_REFUSALS[code])).size).toBe(ISSUE_CODES.length);
  });

  it('has a different sentence for every code the preview answers', () => {
    for (const code of PREVIEW_CODES) expect(PREVIEW_REFUSALS[code], code).toBeTruthy();
    expect(new Set(PREVIEW_CODES.map((code) => PREVIEW_REFUSALS[code])).size).toBe(
      PREVIEW_CODES.length,
    );
  });

  it('has a different sentence for every code a correction answers', () => {
    for (const code of SUPERSEDE_CODES) expect(SUPERSEDE_REFUSALS[code], code).toBeTruthy();
    expect(new Set(SUPERSEDE_CODES.map((code) => SUPERSEDE_REFUSALS[code])).size).toBe(
      SUPERSEDE_CODES.length,
    );
  });

  it('says where a map whose bytes are gone is placed', () => {
    expect(issueRefusalSentence(422, { code: 'map_missing', field: 'maps.map-1.figureId' })).toBe(
      `${ISSUE_REFUSALS['map_missing']} It is placed in the saved list of brain maps.`,
    );
    expect(
      previewRefusalSentence(422, {
        code: 'map_differs',
        field: 'change.pairs.eyes_open.later.figureId',
      }),
    ).toMatch(/eyes open, the later side\.$/);
  });

  it('says how many pictures are left unplaced', () => {
    expect(issueRefusalSentence(422, { code: 'unplaced_figures', figures: ['a'] })).toMatch(
      /^1 picture uploaded to this draft is not on the report\./,
    );
    expect(issueRefusalSentence(422, { code: 'unplaced_figures', figures: ['a', 'b'] })).toMatch(
      /^2 pictures uploaded to this draft are not on the report\./,
    );
  });

  it('names what ran over by the heading it prints under, never by a part id', () => {
    expect(previewRefusalSentence(422, { code: 'overrun', parts: ['summary.1'] })).toBe(
      `${PREVIEW_REFUSALS['overrun']} It ran over under: Summary.`,
    );
    expect(
      issueRefusalSentence(
        422,
        { code: 'overrun', parts: ['approach.text', 'recommendation.2'] },
        { edition: 'follow-up' },
      ),
    ).toBe(
      `${ISSUE_REFUSALS['overrun']} It ran over under: Next Stage of Training, Personalised Recommendations.`,
    );
  });

  it('says who may not, and falls back to a sentence of its own for anything else', () => {
    expect(issueRefusalSentence(403, { error: 'forbidden' })).toMatch(/not allowed/);
    expect(issueRefusalSentence(404, { error: 'not_found' })).toMatch(/could not be found/);
    expect(issueRefusalSentence(500, {})).toMatch(/could not be signed/);
    expect(previewRefusalSentence(500, {})).toMatch(/preview could not be made/);
    expect(supersedeRefusalSentence(500, {})).toMatch(/corrected version could not be started/);
  });
});

describe('what the form says about the other language (brief Q)', () => {
  it('has a different sentence for every code starting the other language answers', () => {
    const codes = [
      'invalid_request',
      'reason_required',
      'not_permitted',
      'wrong_kind',
      'imported_record',
      'not_signed',
      'already_superseded',
      'twin_exists',
      'client_erased',
      'invalid_content',
      'cannot_compare',
      'map_not_held',
    ];
    for (const code of codes) expect(TWIN_REFUSALS[code], code).toBeTruthy();
    expect(new Set(codes.map((code) => TWIN_REFUSALS[code])).size).toBe(codes.length);
    expect(twinRefusalSentence(409, { code: 'twin_exists' })).toBe(TWIN_REFUSALS['twin_exists']);
    expect(twinRefusalSentence(403, { error: 'forbidden' })).toMatch(/owner and the lead/);
    expect(twinRefusalSentence(0, null)).toMatch(/Check the connection/);
  });

  it('names the field a save of the other language tried to change', () => {
    const sentence = refusalSentence(422, {
      code: 'twin_fixed',
      field: 'dashboard.mental_energy.score',
    });
    expect(sentence).toMatch(/only its own language/);
    expect(sentence).toMatch(/Performance dashboard/);
  });

  it('says why the other language is not signed while its first report was corrected', () => {
    expect(issueRefusalSentence(409, { code: 'twin_out_of_step' })).toBe(
      ISSUE_REFUSALS['twin_out_of_step'],
    );
    expect(ISSUE_REFUSALS['twin_differs']).toBeTruthy();
    expect(ISSUE_REFUSALS['twin_differs']).not.toBe(ISSUE_REFUSALS['twin_out_of_step']);
  });

  it('says why no map is added to or taken from the other language', () => {
    expect(figureRefusalSentence(422, { code: 'twin_fixed' })).toBe(FIGURE_REFUSALS['twin_fixed']);
  });
});
