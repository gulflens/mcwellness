// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadGoogleMaps,
  MAPS_VERSION,
  resetGoogleMapsLoader,
} from '../../app/admin/schedule/map/googleMaps';

afterEach(() => {
  resetGoogleMapsLoader();
  document.head.innerHTML = '';
  delete (window as unknown as { google?: unknown }).google;
});

describe('loadGoogleMaps', () => {
  it('adds one script, pinned to a version, asking for no library it does not use', () => {
    void loadGoogleMaps('a-restricted-browser-key');
    const script = document.head.querySelector('script');
    const src = script?.getAttribute('src') ?? '';
    expect(src).toContain('https://maps.googleapis.com/maps/api/js');
    expect(src).toContain('key=a-restricted-browser-key');
    expect(src).toContain(`v=${MAPS_VERSION}`);
    expect(src).toContain('loading=async');
    expect(src).toContain('region=AE');
    expect(src).toContain('language=en');
  });

  it('copies the document’s nonce onto the script, so the map document’s policy admits it', () => {
    const shell = document.createElement('script');
    shell.setAttribute('nonce', 'a-nonce');
    document.head.append(shell);
    void loadGoogleMaps('k');
    const added = [...document.head.querySelectorAll('script')].at(-1);
    expect(added?.nonce || added?.getAttribute('nonce')).toBe('a-nonce');
  });

  it('resolves with the namespace once Google calls back, and adds no second script', async () => {
    const promise = loadGoogleMaps('k');
    const second = loadGoogleMaps('k');
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    const maps = { Map: class {} } as unknown as typeof google.maps;
    (window as unknown as { google: { maps: unknown } }).google = { maps };
    const callback = /callback=([A-Za-z0-9_.]+)/.exec(
      document.head.querySelector('script')?.getAttribute('src') ?? '',
    )?.[1];
    (window as unknown as Record<string, () => void>)[callback ?? '']?.();
    await expect(promise).resolves.toBe(maps);
    await expect(second).resolves.toBe(maps);
  });

  it('rejects when the script is blocked, so the page can say the map could not load', async () => {
    const promise = loadGoogleMaps('k');
    document.head.querySelector('script')?.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toBeInstanceOf(Error);
  });

  it('rejects when nothing answers in time', async () => {
    vi.useFakeTimers();
    const promise = loadGoogleMaps('k');
    const settled = expect(promise).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(9_000);
    await settled;
    vi.useRealTimers();
  });
});
