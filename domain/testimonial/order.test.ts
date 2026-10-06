import { describe, expect, it } from 'vitest';
import { moveTestimonial } from './order';

describe('moveTestimonial', () => {
  const shown = ['a', 'b', 'c'] as const;

  it('swaps a review with the one above it, or below it', () => {
    expect(moveTestimonial(shown, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveTestimonial(shown, 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('answers null at either end and for a review not in the list: nothing to move', () => {
    expect(moveTestimonial(shown, 'a', 'up')).toBeNull();
    expect(moveTestimonial(shown, 'c', 'down')).toBeNull();
    expect(moveTestimonial(shown, 'z', 'up')).toBeNull();
  });

  it('leaves the list it was given alone', () => {
    const list = ['a', 'b'];
    moveTestimonial(list, 'b', 'up');
    expect(list).toEqual(['a', 'b']);
  });
});
