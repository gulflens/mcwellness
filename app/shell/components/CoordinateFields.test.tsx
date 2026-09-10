// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoordinateFields } from './CoordinateFields';

afterEach(cleanup);

/**
 * "Verify pin" without a map library (task brief item 4): latitude and
 * longitude, "Use my current position" (never blocking on refusal), and
 * "Open in Google Maps" once a point exists — unless the caller says not to,
 * which the practitioner base drawer does.
 */
describe('CoordinateFields', () => {
  it('fills the fields from the current position, and never blocks when it is refused', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<CoordinateFields lat={null} lng={null} onChange={onChange} />);

    expect(screen.queryByRole('link')).toBeNull();

    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 25.2048, longitude: 55.2708 },
      } as GeolocationPosition);
    });
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use my current position' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ lat: 25.2048, lng: 55.2708 }));

    rerender(<CoordinateFields lat={25.2048} lng={55.2708} onChange={onChange} />);
    const link = screen.getByRole('link', { name: 'Open in Google Maps, opens in a new tab' });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=25.2048,55.2708',
    );
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('keeps what is typed on screen and ties one error to both boxes', async () => {
    const onChange = vi.fn();
    render(<CoordinateFields lat={null} lng={null} onChange={onChange} error="Set the point." />);

    const latitude = screen.getByLabelText('Latitude') as HTMLInputElement;
    // Text with a decimal keypad, never a number spinner a scroll wheel can nudge.
    expect(latitude.getAttribute('type')).toBe('text');
    expect(latitude.getAttribute('inputmode')).toBe('decimal');

    // One message, announced, and pointed at by both boxes rather than loose beside them.
    const message = screen.getByRole('alert');
    expect(message.textContent).toBe('Set the point.');
    for (const label of ['Latitude', 'Longitude']) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute('aria-describedby')).toBe(message.getAttribute('id'));
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }

    // Out of range reports nothing upward, but the characters stay where they were typed.
    fireEvent.change(latitude, { target: { value: '255' } });
    expect(latitude.value).toBe('255');
    expect(onChange).toHaveBeenLastCalledWith({ lat: null, lng: null });

    fireEvent.change(latitude, { target: { value: '25.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ lat: 25.5, lng: null });
  });

  it('shows a plain message, and sets nothing, when the position is refused', async () => {
    const onChange = vi.fn();
    render(<CoordinateFields lat={null} lng={null} onChange={onChange} />);

    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error?: PositionErrorCallback) => {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      },
    );
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use my current position' }));
    expect(
      await screen.findByText(
        'Your current position is not available. Enter the coordinates by hand instead.',
      ),
    ).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CoordinateFields — offerMapLink', () => {
  // A member of staff's home is not a household the practitioner is driving to,
  // and docs/COMPLIANCE/approved-vendors.md's Google Maps row is written
  // entirely about households (the review of pull request 126, finding 6).
  it('omits the Google Maps link, and keeps the current-position button', () => {
    render(<CoordinateFields lat={25.2} lng={55.27} onChange={vi.fn()} offerMapLink={false} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Use my current position' })).toBeTruthy();
  });

  it('still offers it by default, which is what the client forms want', () => {
    render(<CoordinateFields lat={25.2} lng={55.27} onChange={vi.fn()} />);
    expect(
      screen.getByRole('link', { name: 'Open in Google Maps, opens in a new tab' }),
    ).toBeTruthy();
  });
});

describe('CoordinateFields — mapPicker', () => {
  afterEach(() => {
    try {
      window.sessionStorage.clear();
    } catch {
      // One of the tests below makes sessionStorage itself throw; if a prior
      // test left it in that state this must not fail the next one's setup.
    }
  });

  /** What `openPicker` wrote under the key its `window.open` URL names. */
  function stored(open: ReturnType<typeof vi.spyOn>, call = 0): unknown {
    const url = new URL(String(open.mock.calls[call]?.[0]), window.location.origin);
    const key = url.searchParams.get('k');
    return JSON.parse(window.sessionStorage.getItem(`mcwellness:pin:${key}`) ?? 'null');
  }

  it('opens the picker behind an opaque key, the point stored under it, and takes the point sent back', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const onChange = vi.fn();
    const onAddress = vi.fn();
    render(
      <CoordinateFields
        lat={25.2048}
        lng={55.2708}
        onChange={onChange}
        browserKey="browser-key-under-test"
        mapPicker={{ emirate: 'DXB', label: 'Home', onAddress }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));

    // The URL carries nothing but the key — no point, no emirate, no label:
    // `.claude/rules/ui.md` forbids personal data in a URL, and a
    // household's entrance coordinate is exactly that.
    const url = new URL(String(open.mock.calls[0]?.[0]), window.location.origin);
    expect(url.pathname).toBe('/admin/clients/pin');
    expect([...url.searchParams.keys()]).toEqual(['k']);
    expect(url.searchParams.get('k')).toBeTruthy();

    // The point travels through sessionStorage instead, under that same key.
    expect(stored(open)).toEqual({ lat: 25.2048, lng: 55.2708, emirate: 'DXB', label: 'Home' });

    fireEvent(
      window,
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'mcwellness:pin', lat: 25.21, lng: 55.28, address: 'Villa 12, Street 4' },
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ lat: 25.21, lng: 55.28 });
    expect(onAddress).toHaveBeenCalledWith('Villa 12, Street 4');
    open.mockRestore();
  });

  it('omits lat and lng from the stored blob when there is no point yet', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    render(
      <CoordinateFields
        lat={null}
        lng={null}
        onChange={vi.fn()}
        browserKey="browser-key-under-test"
        mapPicker={{ label: 'Home' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));
    const blob = stored(open);
    expect(blob).toEqual({ label: 'Home' });
    expect(blob).not.toHaveProperty('lat');
    expect(blob).not.toHaveProperty('lng');
    open.mockRestore();
  });

  it('keeps a kind-of-place label but drops anything else', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { rerender } = render(
      <CoordinateFields
        lat={25.2}
        lng={55.3}
        onChange={vi.fn()}
        browserKey="browser-key-under-test"
        mapPicker={{ label: 'Not a kind of place' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));
    expect(stored(open, 0)).not.toHaveProperty('label');

    rerender(
      <CoordinateFields
        lat={25.2}
        lng={55.3}
        onChange={vi.fn()}
        browserKey="browser-key-under-test"
        mapPicker={{ label: 'Home base' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));
    expect(stored(open, 1)).toHaveProperty('label', 'Home base');
    open.mockRestore();
  });

  it('says so next to the button, and never opens the tab, when sessionStorage blocks the write', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    render(
      <CoordinateFields
        lat={25.2}
        lng={55.3}
        onChange={vi.fn()}
        browserKey="browser-key-under-test"
        mapPicker={{ label: 'Home' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick on the map' }));
    expect(open).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'The map could not be opened: this browser is blocking site data. Enter the coordinates by hand instead.',
      ),
    ).toBeTruthy();
    setItem.mockRestore();
    open.mockRestore();
  });

  it('ignores a message from any other origin', () => {
    const onChange = vi.fn();
    render(
      <CoordinateFields
        lat={null}
        lng={null}
        onChange={onChange}
        browserKey="browser-key-under-test"
        mapPicker={{ label: 'Home' }}
      />,
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: { type: 'mcwellness:pin', lat: 1, lng: 2, address: null },
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says the map needs the key when the build has none', () => {
    render(
      <CoordinateFields
        lat={null}
        lng={null}
        onChange={vi.fn()}
        browserKey={null}
        mapPicker={{ label: 'Home' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Pick on the map' })).toBeNull();
    expect(screen.getByText('The map needs the practice’s browser key.')).toBeTruthy();
  });
});
