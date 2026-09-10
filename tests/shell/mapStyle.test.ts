// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mapStyle } from '../../app/shell/maps/mapStyle';

describe('mapStyle', () => {
  it('paints nothing, so the map keeps Google’s own colours', () => {
    // The operator saw the old style on the live site: every feature painted
    // `--paper` and the roads `--rule`, about 1.2:1 apart, which read as an
    // empty grey panel rather than a map. Nothing here may name a colour.
    const style = mapStyle();
    for (const rule of style) {
      for (const styler of rule.stylers as Record<string, unknown>[]) {
        expect(styler).not.toHaveProperty('color');
        expect(styler).not.toHaveProperty('hue');
        expect(styler).not.toHaveProperty('saturation');
        expect(styler).not.toHaveProperty('lightness');
      }
    }
  });

  it('turns off the clutter a route map has no use for', () => {
    const off = mapStyle()
      .filter((rule) =>
        (rule.stylers as Record<string, unknown>[]).some((s) => s.visibility === 'off'),
      )
      .map((rule) => rule.featureType);
    expect(off).toContain('poi');
    expect(off).toContain('transit');
    expect(off).toContain('administrative');
  });

  it('needs no document to build, so it cannot depend on a rendered theme', () => {
    // It used to read `getComputedStyle` on an element handed in, which made
    // the basemap follow the console's dark mode. Google's own palette does
    // not, and a light map under a dark console is the ordinary trade.
    expect(() => mapStyle()).not.toThrow();
    expect(mapStyle()).toEqual(mapStyle());
  });
});
