// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DayMap } from '../../app/admin/schedule/map/DayMap';
import { fakeGoogleMaps } from '../scheduling/fakeGoogleMaps';

/**
 * Where they are, on the day map (docs/SPEC/dispatch.md section 15): the
 * practitioner's last shared position drawn by the app as a label of its own,
 * never a numbered stop, and never the reason the map refits.
 */

afterEach(cleanup);

const day = {
  practitionerId: '00000009-0000-4000-8000-000000000001',
  homeBase: null,
  stops: [
    {
      appointmentId: 'a1',
      locationId: 'l1',
      point: { lat: 25.3, lng: 55.3 },
      windowStart: '2026-09-10T05:00:00.000Z',
      windowEnd: '2026-09-10T05:45:00.000Z',
      status: 'confirmed',
    },
  ],
  legs: [],
};

describe('the last shared position on the day map', () => {
  it('is drawn with how old it is, and is not a stop', () => {
    const state = fakeGoogleMaps();
    render(
      <DayMap
        maps={state.maps}
        day={day}
        selectedId={null}
        onSelect={() => undefined}
        here={{ point: { lat: 25.25, lng: 55.29 }, label: 'Last shared 4 min ago' }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Last shared 4 min ago' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not refit the map when a new position arrives', () => {
    const state = fakeGoogleMaps();
    const props = { maps: state.maps, day, selectedId: null, onSelect: () => undefined };
    const { rerender } = render(<DayMap {...props} here={null} />);
    const fitted = state.fitted;
    rerender(
      <DayMap
        {...props}
        here={{ point: { lat: 25.25, lng: 55.29 }, label: 'Last shared just now' }}
      />,
    );
    expect(state.fitted).toBe(fitted);
  });

  it('draws nothing for somebody who is not sharing', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
