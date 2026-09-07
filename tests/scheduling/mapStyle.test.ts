// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mapStyle } from '../../app/admin/schedule/map/mapStyle';

/** The style is read from the running document, so a token change moves the map with it. */
describe('mapStyle', () => {
  it('takes every colour from the document’s own custom properties', () => {
    const root = document.documentElement;
    root.style.setProperty('--paper', '#eef2f1');
    root.style.setProperty('--rule', '#cbd5d6');
    root.style.setProperty('--slate', '#6b7c82');
    root.style.setProperty('--surface', '#ffffff');
    const style = mapStyle(root);
    const colours = style.flatMap((rule) =>
      rule.stylers.map((s) => (s as { color?: string }).color),
    );
    expect(colours).toContain('#eef2f1');
    expect(colours).toContain('#cbd5d6');
    expect(colours).toContain('#6b7c82');
    expect(colours).toContain('#ffffff');
  });

  it('turns the noise off: points of interest, transit and administrative geometry', () => {
    const style = mapStyle(document.documentElement);
    const off = style.filter((rule) =>
      rule.stylers.some((s) => (s as { visibility?: string }).visibility === 'off'),
    );
    expect(off.map((rule) => rule.featureType)).toEqual(
      expect.arrayContaining(['poi', 'transit', 'administrative']),
    );
  });

  it('leaves a colour out rather than inventing one when a token is missing', () => {
    const bare = document.createElement('div');
    document.body.append(bare);
    expect(() => mapStyle(bare)).not.toThrow();
  });
});
