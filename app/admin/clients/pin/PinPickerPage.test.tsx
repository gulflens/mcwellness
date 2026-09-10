// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIN_MESSAGE_TYPE } from '../../../shell/maps/pinMessage';
import { UAE_CENTRE } from './emirates';
import { PinPickerPage } from './PinPickerPage';

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
  /**
   * Fires the autocomplete element's `gmp-select` the way Google's own
   * element actually does: the page attaches a real `addEventListener` to
   * `autocomplete` (it is a genuine DOM node, not the plain-object listener
   * map above), so the fake fires a real DOM event too, carrying a
   * `placePrediction` whose `toPlace()` returns the chosen place.
   */
  function selectPlace(place: {
    fetchFields: (o: { fields: string[] }) => Promise<unknown>;
    location?: { lat: () => number; lng: () => number } | null;
    formattedAddress?: string | null;
  }): void {
    const event = new Event('gmp-select');
    (event as unknown as { placePrediction: { toPlace: () => typeof place } }).placePrediction = {
      toPlace: () => place,
    };
    autocomplete.dispatchEvent(event);
  }
  return {
    maps: maps as unknown as typeof google.maps,
    listeners,
    marker,
    map,
    autocomplete,
    // Exposed raw (not through the `typeof google.maps` cast above) so a
    // test can read its `mock.calls` without fighting the same unsafe cast
    // the page itself needs to reach this constructor
    // (`app/admin/clients/pin/PinPickerPage.tsx`).
    placeAutocomplete: maps.places.PlaceAutocompleteElement,
    selectPlace,
  };
}

/**
 * Mounts the page the way `CoordinateFields.openPicker` opens it since trunk
 * round 43 part three: a starting point, if there is one, is written to
 * `sessionStorage` under a fresh key, and the URL carries only that key
 * (finding 3 of the review of this page — no personal data in a URL). `null`
 * mounts the page the way it opens with no key at all.
 */
function mount(stored: Record<string, unknown> | null, fake = fakeMaps()) {
  const opener = { postMessage: vi.fn() };
  Object.defineProperty(window, 'opener', { value: opener, configurable: true });
  const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  const key = stored ? crypto.randomUUID() : null;
  if (stored && key) {
    window.sessionStorage.setItem(`mcwellness:pin:${key}`, JSON.stringify(stored));
  }
  render(
    <MemoryRouter initialEntries={[`/admin/clients/pin${key ? `?k=${key}` : ''}`]}>
      <PinPickerPage browserKey="browser-key-under-test" loadMaps={async () => fake.maps} />
    </MemoryRouter>,
  );
  return { opener, close, key, ...fake };
}

describe('PinPickerPage', () => {
  it('opens on the point it was given, removes the stored blob, and posts the point back when used', async () => {
    const { opener, close, maps, key } = mount({ lat: 25.2048, lng: 55.2708, label: 'Home' });
    await waitFor(() => expect(maps.Marker).toHaveBeenCalled());
    const options = (maps.Marker as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      position: { lat: number; lng: number };
      draggable: boolean;
    };
    expect(options.position).toEqual({ lat: 25.2048, lng: 55.2708 });
    expect(options.draggable).toBe(true);
    // The blob is gone the moment this page has read it: it must not linger.
    expect(window.sessionStorage.getItem(`mcwellness:pin:${key}`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use this pin' }));
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: PIN_MESSAGE_TYPE, lat: 25.2048, lng: 55.2708, address: null },
      window.location.origin,
    );
    expect(close).toHaveBeenCalled();
  });

  it('follows the marker when it is dragged, and a tap on the map', async () => {
    const { listeners, marker, maps } = mount({ lat: 25.2048, lng: 55.2708 });
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
    const { maps } = mount({ emirate: 'SHJ' });
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
    const { opener } = mount({ lat: 25.2, lng: 55.3 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use this pin' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Use this pin' }));
    expect(opener.postMessage.mock.calls[0]?.[1]).toBe(window.location.origin);
  });

  it('restricts the address search to the UAE, and follows a place chosen from it', async () => {
    const { marker, map, placeAutocomplete, selectPlace } = mount({
      lat: 25.2048,
      lng: 55.2708,
    });
    await waitFor(() => expect(placeAutocomplete).toHaveBeenCalled());
    // The one compliance-relevant setting on this box: a coordinator search
    // must not resolve to an address outside the UAE.
    const options = (placeAutocomplete as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(options).toEqual({ includedRegionCodes: ['ae'] });

    const place = {
      fetchFields: vi.fn(async (o: { fields: string[] }) => {
        expect(o).toEqual({ fields: ['location', 'formattedAddress'] });
        return undefined;
      }),
      location: { lat: () => 25.0772, lng: () => 55.1409 },
      formattedAddress: 'A synthetic street, Dubai',
    };
    selectPlace(place);
    await waitFor(() => expect(place.fetchFields).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('A synthetic street, Dubai')).toBeTruthy());
    expect(marker.position).toEqual({ lat: 25.0772, lng: 55.1409 });
    expect(map.panTo).toHaveBeenCalledWith({ lat: 25.0772, lng: 55.1409 });
    expect(map.setZoom).toHaveBeenCalledWith(17);
    expect(screen.getByText(/25\.07720, 55\.14090/)).toBeTruthy();
  });

  describe('the stored blob — missing, stale, corrupt or unreachable', () => {
    it('falls back to no starting point when the page is opened with no key at all', async () => {
      const { maps } = mount(null);
      await waitFor(() => expect(maps.Map).toHaveBeenCalled());
      const options = (maps.Map as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
        center: { lat: number; lng: number };
      };
      expect(options.center).toEqual(UAE_CENTRE);
      expect(screen.getByRole('button', { name: 'Use this pin' })).toHaveProperty('disabled', true);
      expect(screen.getByText('No pin yet. Tap the map to place one.')).toBeTruthy();
    });

    it('falls back the same way when the key names nothing stored', async () => {
      const fake = fakeMaps();
      render(
        <MemoryRouter initialEntries={['/admin/clients/pin?k=never-written']}>
          <PinPickerPage browserKey="browser-key-under-test" loadMaps={async () => fake.maps} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(fake.maps.Map).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Use this pin' })).toHaveProperty('disabled', true);
    });

    it('falls back the same way, and still clears the entry, when it cannot be parsed', async () => {
      const key = 'corrupt-key';
      window.sessionStorage.setItem(`mcwellness:pin:${key}`, 'not valid json{');
      const fake = fakeMaps();
      render(
        <MemoryRouter initialEntries={[`/admin/clients/pin?k=${key}`]}>
          <PinPickerPage browserKey="browser-key-under-test" loadMaps={async () => fake.maps} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(fake.maps.Map).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Use this pin' })).toHaveProperty('disabled', true);
      expect(window.sessionStorage.getItem(`mcwellness:pin:${key}`)).toBeNull();
    });

    it('falls back the same way, and does not throw, when sessionStorage itself throws on read', async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('site data blocked');
      });
      const fake = fakeMaps();
      render(
        <MemoryRouter initialEntries={['/admin/clients/pin?k=blocked-key']}>
          <PinPickerPage browserKey="browser-key-under-test" loadMaps={async () => fake.maps} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(fake.maps.Map).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Use this pin' })).toHaveProperty('disabled', true);
      getItem.mockRestore();
    });
  });
});
