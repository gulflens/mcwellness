// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayMap, formatDrive } from '../../app/admin/schedule/map/DayMap';
import { fakeGoogleMaps } from './fakeGoogleMaps';

afterEach(cleanup);

const day = {
  practitionerId: '00000009-0000-4000-8000-000000000001',
  homeBase: { locationId: 'base', point: { lat: 25.2, lng: 55.27 } },
  stops: [
    {
      appointmentId: 'a1',
      locationId: 'l1',
      point: { lat: 25.3, lng: 55.3 },
      windowStart: '2026-09-10T05:00:00.000Z',
      windowEnd: '2026-09-10T05:45:00.000Z',
      status: 'proposed',
    },
    {
      appointmentId: 'a2',
      locationId: 'l2',
      point: { lat: 25.35, lng: 55.4 },
      windowStart: '2026-09-10T07:00:00.000Z',
      windowEnd: '2026-09-10T07:45:00.000Z',
      status: 'confirmed',
    },
  ],
  legs: [
    {
      toStopId: 'a1',
      fromLocationId: 'base',
      toLocationId: 'l1',
      departAt: '2026-09-10T05:00:00.000Z',
      seconds: 900,
      metres: 9000,
      source: 'traffic' as const,
    },
    {
      toStopId: 'a2',
      fromLocationId: 'l1',
      toLocationId: 'l2',
      departAt: '2026-09-10T06:45:00.000Z',
      seconds: 1500,
      metres: 18000,
      source: 'traffic' as const,
    },
  ],
};

describe('DayMap', () => {
  it('draws a numbered pin per stop and a base, each a button that names its stop', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Stop 1 on the map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop 2 on the map' })).toBeTruthy();
    expect(screen.getByText('H')).toBeTruthy();
  });

  it('draws one line per drive, through the places in order', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(state.polylines).toHaveLength(1);
    expect(state.polylines[0]?.path).toHaveLength(3);
    expect(state.fitted).toBeGreaterThan(0);
  });

  it('writes the drive beside the line, always as an estimate', () => {
    const state = fakeGoogleMaps();
    render(<DayMap maps={state.maps} day={day} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByText('about 15 min')).toBeTruthy();
    expect(screen.getByText('about 25 min')).toBeTruthy();
  });

  it('hands the stop back when its pin is pressed, and marks the selected one', () => {
    const state = fakeGoogleMaps();
    const onSelect = vi.fn();
    const { rerender } = render(
      <DayMap maps={state.maps} day={day} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop 2 on the map' }));
    expect(onSelect).toHaveBeenCalledWith('a2');
    rerender(<DayMap maps={state.maps} day={day} selectedId="a2" onSelect={onSelect} />);
    expect(
      screen.getByRole('button', { name: 'Stop 2 on the map' }).getAttribute('aria-current'),
    ).toBe('true');
  });

  it('says nothing at all about a day with no stops', () => {
    const state = fakeGoogleMaps();
    render(
      <DayMap
        maps={state.maps}
        day={{ ...day, stops: [], legs: [] }}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });
});

describe('formatDrive', () => {
  it('is a sentence with the word estimate, and no distance under the fallback', () => {
    expect(formatDrive({ seconds: 1500, metres: 18000, source: 'traffic' })).toBe(
      'about 25 min, 18 km, estimate from traffic',
    );
    expect(formatDrive({ seconds: 1500, metres: 18000, source: 'straight-line' })).toBe(
      'about 25 min, straight-line estimate',
    );
    expect(formatDrive(undefined)).toBe('– –');
  });
});
