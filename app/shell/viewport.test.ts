// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { areaOf, DESK_WIDTH, useViewport, viewportContent } from './viewport';

const DEVICE = 'width=device-width, initial-scale=1';

describe('areaOf', () => {
  it('calls only the admin console the console', () => {
    expect(areaOf('/admin/clients')).toBe('console');
    expect(areaOf('/admin')).toBe('console');
    expect(areaOf('/today')).toBe('other');
    expect(areaOf('/portal/home')).toBe('other');
    expect(areaOf('/sign-in')).toBe('other');
  });
});

describe('viewportContent', () => {
  it('lays the console out at a desk width on a small-screened device', () => {
    expect(viewportContent('console', 390)).toBe(`width=${DESK_WIDTH}`);
    expect(viewportContent('console', 767)).toBe(`width=${DESK_WIDTH}`);
  });

  it('leaves the console at the device width on anything larger', () => {
    expect(viewportContent('console', 768)).toBe(DEVICE);
    expect(viewportContent('console', 1440)).toBe(DEVICE);
  });

  it('never gives another area the desk width', () => {
    for (const width of [320, 390, 768, 1440]) {
      expect(viewportContent('other', width)).toBe(DEVICE);
    }
  });

  it('never takes zooming away', () => {
    const every = [
      viewportContent('console', 390),
      viewportContent('console', 1440),
      viewportContent('other', 390),
    ];
    for (const content of every) {
      expect(content).not.toContain('user-scalable');
      expect(content).not.toContain('maximum-scale');
    }
  });
});

describe('useViewport', () => {
  it('writes the desk width onto the document for the console on a phone', () => {
    document.head.innerHTML =
      '<meta name="viewport" content="width=device-width, initial-scale=1">';
    Object.defineProperty(window.screen, 'width', { value: 390, configurable: true });
    renderHook(() => useViewport('/admin/clients'));
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      `width=${DESK_WIDTH}`,
    );
  });

  it('puts the device width back when the person leaves the console', () => {
    document.head.innerHTML = `<meta name="viewport" content="width=${DESK_WIDTH}">`;
    Object.defineProperty(window.screen, 'width', { value: 390, configurable: true });
    renderHook(() => useViewport('/today'));
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(DEVICE);
  });

  it('leaves a document with no viewport element alone rather than throwing', () => {
    document.head.innerHTML = '';
    Object.defineProperty(window.screen, 'width', { value: 390, configurable: true });
    expect(() => renderHook(() => useViewport('/admin/clients'))).not.toThrow();
  });
});
