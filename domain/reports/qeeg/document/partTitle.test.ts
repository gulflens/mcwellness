import { describe, expect, it } from 'vitest';
import { partTitle, partTitles } from './partTitle';

describe('partTitle', () => {
  it('names a part by the heading of the section it prints under, in the wording’s words', () => {
    expect(partTitle('summary.1', 'initial', 'en')).toBe('Summary');
    expect(partTitle('recommendation.2', 'initial', 'en')).toBe('Personalised Recommendations');
    expect(partTitle('band.delta', 'initial', 'en')).toBe('Understanding Your Brain');
    expect(partTitle('connectivity.asymmetry', 'initial', 'en')).toBe('Understanding Your Brain');
    expect(partTitle('dashboard.grid', 'initial', 'en')).toBe('Performance Dashboard');
    expect(partTitle('map.0', 'initial', 'en')).toBe('Brain maps');
    expect(partTitle('client', 'initial', 'en')).toBe('Client Information');
    expect(partTitle('final.standing', 'initial', 'en')).toBe(
      'Personalised Programme Recommendations',
    );
    expect(partTitle('approach.text', 'follow-up', 'en')).toBe('Next Stage of Training');
    expect(partTitle('change.table.head', 'follow-up', 'en')).toBe('What Has Changed');
  });

  it('never answers a raw part id, even for one it does not know', () => {
    expect(partTitle('something.new', 'initial', 'en')).toBe('Another part of the report');
  });

  it('lists each section once, in the order the parts ran over', () => {
    expect(partTitles(['summary.1', 'summary.2', 'benefits.list'], 'initial', 'en')).toEqual([
      'Summary',
      'Potential Benefits',
    ]);
  });
});
