// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoordinateFields } from './CoordinateFields';

afterEach(cleanup);

/**
 * "Verify pin" without a map library (task brief item 4): latitude and
 * longitude, "Use my current position" (never blocking on refusal), and
 * "Open in Google Maps" once a point exists.
 */
describe('CoordinateFields', () => {
  it('fills the fields from the current position, and never blocks when it is refused', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<CoordinateFields lat={null} lng={null} onChange={onChange} />);

    expect(screen.queryByText('Open in Google Maps')).toBeNull();

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
    const link = screen.getByRole('link', { name: 'Open in Google Maps' });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=25.2048,55.2708',
    );
    expect(link.getAttribute('target')).toBe('_blank');
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
