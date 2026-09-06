import { describe, expect, it } from 'vitest';
import { observationWords } from './observationWords';

describe('the words a visit’s observations print as', () => {
  it('turns the session module’s keys into sentences, in both languages', () => {
    expect(observationWords(['headache', 'fatigue'], 'en')).toEqual(['Headache', 'Fatigue']);
    expect(observationWords(['headache'], 'ar')).toEqual(['صداع']);
  });

  it('drops a key it does not know rather than printing a database field', () => {
    expect(observationWords(['headache', 'irritability_2', 7, null], 'en')).toEqual(['Headache']);
  });

  it('says a thing once, however often it was ticked', () => {
    expect(observationWords(['none', 'none'], 'en')).toEqual(['Nothing to note']);
  });

  it('answers nothing at all for a visit that recorded nothing', () => {
    expect(observationWords([], 'en')).toEqual([]);
  });
});
