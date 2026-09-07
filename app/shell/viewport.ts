import { useEffect } from 'react';

/**
 * How wide the page tells the browser it is (docs/SPEC/responsive-console.md
 * section 5).
 *
 * The console on a small screen is shown whole and zoomed out rather than
 * squeezed: it lays itself out at a desk width and the browser scales the
 * result to fit, so the person pinches to zoom and drags to pan. Nothing
 * reflows and nothing is hidden, and a phone shows the same console a laptop
 * does.
 *
 * The practitioner app, the household's portal and the sign-in page keep the
 * device's own width. Each is designed for a phone and has to stay readable
 * without zooming: a practitioner is standing in somebody's living room and a
 * parent is reading at eleven at night.
 */
export const DESK_WIDTH = 1024;

/** Below this a device is too narrow to show the console at its own size. */
export const SMALL_SCREEN = 768;

const DEVICE = 'width=device-width, initial-scale=1';

export type RouteArea = 'console' | 'other';

export function areaOf(pathname: string): RouteArea {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? 'console' : 'other';
}

/**
 * A width with no initial scale leaves the browser to pick the scale that fits
 * the layout to the screen, which is the zoomed-out page we want. Neither
 * `user-scalable=no` nor `maximum-scale` is ever written: taking zoom away
 * from somebody who needs it is never the answer, and a guard test
 * (tests/lint/layout-tokens.test.ts) refuses either word anywhere.
 */
export function viewportContent(area: RouteArea, screenWidth: number): string {
  return area === 'console' && screenWidth < SMALL_SCREEN ? `width=${DESK_WIDTH}` : DEVICE;
}

/**
 * Applies the answer to the document's own viewport element as the person
 * moves between the console and everywhere else.
 *
 * The width is read from `screen`, never from `window.innerWidth`. Setting
 * this element changes `innerWidth`, so a condition built on it would flip
 * itself back and forth every time it ran; `screen.width` describes the device
 * and does not move when the element does.
 */
export function useViewport(pathname: string): void {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      return;
    }
    meta.setAttribute('content', viewportContent(areaOf(pathname), window.screen.width));
  }, [pathname]);
}
