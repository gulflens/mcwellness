// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIN_MESSAGE_TYPE, PinPickerPage } from './PinPickerPage';

afterEach(cleanup);

/** The slice of google.maps the picker touches, as plain objects. */
function fakeMaps() {
  const listeners: Record<string, Array<(e?: unknown) => void>> = {};
  const marker = {
    position: { lat: 25.2048, lng: 55.2708 },
    setPosition(p: { lat: number; lng: number }) {
      this.position = p;
    },
    getPosition() {
      const p = this.position;
      return { lat: () => p.lat, lng: () => p.lng };
    },
    addListener(name: string, fn: (e?: unknown) => void) {
      (listeners[`marker:${name}`] ??= []).push(fn);
    },
    // The page detaches the marker on unmount, as the real API's own
    // teardown does; the fake needs the method to be there to receive it.
    setMap() {},
  };
  const map = {
    addListener(name: string, fn: (e?: unknown) => void) {
      (listeners[`map:${name}`] ??= []).push(fn);
    },
    panTo: vi.fn(),
    setZoom: vi.fn(),
  };
  const autocomplete = document.createElement('div');
  // Regular functions, not arrows: the page constructs each of these with
  // `new`, as the real API requires, and an arrow function cannot be a
  // constructor — `new vi.fn(() => map)(...)` throws "is not a constructor"
  // from inside vitest's own spy, before the page's code runs at all.
  const maps = {
    Map: vi.fn(function () {
      return map;
    }),
    Marker: vi.fn(function () {
      return marker;
    }),
    places: {
      PlaceAutocompleteElement: vi.fn(function () {
        return autocomplete;
      }),
    },
  };
  return { maps: maps as unknown as typeof google.maps, listeners, marker, map, autocomplete };
}

function mount(query: string, fake = fakeMaps()) {
  const opener = { postMessage: vi.fn() };
  Object.defineProperty(window, 'opener', { value: opener, configurable: true });
  const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  render(
    <MemoryRouter initialEntries={[`/admin/clients/pin${query}`]}>
      <PinPickerPage browserKey="browser-key-under-test" loadMaps={async () => fake.maps} />
    </MemoryRouter>,
  );
  return { opener, close, ...fake };
}

describe('PinPickerPage', () => {
  it('opens on the point it was given and posts it back when used', async () => {
    const { opener, close, maps } = mount('?lat=25.2048&lng=55.2708&label=Home');
    await waitFor(() => expect(maps.Marker).toHaveBeenCalled());
    const options = (maps.Marker as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      position: { lat: number; lng: number };
      draggable: boolean;
    };
    expect(options.position).toEqual({ lat: 25.2048, lng: 55.2708 });
    expect(options.draggable).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Use this pin' }));
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: PIN_MESSAGE_TYPE, lat: 25.2048, lng: 55.2708, address: null },
      window.location.origin,
    );
    expect(close).toHaveBeenCalled();
  });

  it('follows the marker when it is dragged, and a tap on the map', async () => {
    const { listeners, marker, maps } = mount('?lat=25.2048&lng=55.2708');
    await waitFor(() => expect(maps.Marker).toHaveBeenCalled());
    marker.setPosition({ lat: 25.21, lng: 55.28 });
    for (const fn of listeners['marker:dragend'] ?? []) fn();
    expect(screen.getByText(/25\.21000, 55\.28000/)).toBeTruthy();
    for (const fn of listeners['map:click'] ?? []) {
      fn({ latLng: { lat: () => 25.3, lng: () => 55.4 } });
    }
    expect(screen.getByText(/25\.30000, 55\.40000/)).toBeTruthy();
  });

  it('centres on the emirate when it has no point yet', async () => {
    const { maps } = mount('?emirate=SHJ');
    await waitFor(() => expect(maps.Map).toHaveBeenCalled());
    const options = (maps.Map as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      center: { lat: number; lng: number };
    };
    expect(options.center).toEqual({ lat: 25.3463, lng: 55.4209 });
    expect(screen.getByRole('button', { name: 'Use this pin' })).toHaveProperty('disabled', true);
  });

  it('says so when the practice has no browser key', () => {
    render(
      <MemoryRouter initialEntries={['/admin/clients/pin']}>
        <PinPickerPage browserKey={null} loadMaps={async () => fakeMaps().maps} />
      </MemoryRouter>,
    );
    expect(screen.getByText('The map needs the practice’s browser key.')).toBeTruthy();
  });

  it('never posts to a stranger: the target is this page’s own origin', async () => {
    const { opener } = mount('?lat=25.2&lng=55.3');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use this pin' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Use this pin' }));
    expect(opener.postMessage.mock.calls[0]?.[1]).toBe(window.location.origin);
  });
});
