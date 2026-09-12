// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flagsRender, resetFlagsRenderForTests } from './flagSupport';

/**
 * flagsRender() is the one piece of this task with runtime behaviour rather
 * than data — measured against the real DOM, memoised, and required to
 * answer false rather than throw whenever anything it needs is missing.
 */
describe('flagsRender', () => {
  beforeEach(() => {
    resetFlagsRenderForTests();
  });

  it('answers false under jsdom, where every measurement reads zero, without throwing', () => {
    expect(() => flagsRender()).not.toThrow();
    expect(flagsRender()).toBe(false);
  });

  it('memoises the answer: the DOM is measured once across repeated calls', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');
    flagsRender();
    flagsRender();
    flagsRender();
    // The probe span is created once, on the first call; the second and
    // third reuse the memoised answer and touch the DOM not at all.
    expect(createElementSpy).toHaveBeenCalledTimes(1);
    createElementSpy.mockRestore();
  });

  it('answers false rather than throwing when document is unavailable', () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error -- simulating an environment with no DOM at all
    delete globalThis.document;
    try {
      expect(() => flagsRender()).not.toThrow();
      expect(flagsRender()).toBe(false);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('answers false rather than throwing when document.body is not yet available', () => {
    const originalBody = document.body;
    Object.defineProperty(document, 'body', { value: null, configurable: true });
    try {
      expect(() => flagsRender()).not.toThrow();
      expect(flagsRender()).toBe(false);
    } finally {
      Object.defineProperty(document, 'body', { value: originalBody, configurable: true });
    }
  });
});
