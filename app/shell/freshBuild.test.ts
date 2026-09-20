// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { entryOf, isNewBuildReady, resetFreshBuildForTests, watchForNewBuild } from './freshBuild';

const page = (entry: string) =>
  `<!doctype html><html><head><link rel="stylesheet" href="/assets/index-AAAA.css">` +
  `<script type="module" crossorigin src="/assets/${entry}"></script></head><body></body></html>`;

function serve(html: string | (() => string), status = 200) {
  return vi.fn(async () => new Response(typeof html === 'function' ? html() : html, { status }));
}

afterEach(() => {
  resetFreshBuildForTests();
  vi.useRealTimers();
});

describe('entryOf', () => {
  it('reads the name of the script a build starts from', () => {
    expect(entryOf(page('index-DfRDHcin.js'))).toBe('index-DfRDHcin.js');
  });

  it('answers nothing for a page with no such script: a dev server, an error page', () => {
    expect(entryOf('<html><script type="module" src="/app/shell/main.tsx"></script></html>')).toBe(
      null,
    );
    expect(entryOf('Bad gateway')).toBe(null);
  });
});

describe('watchForNewBuild', () => {
  it('says nothing while the site still serves the build this window is running', async () => {
    const fetchImpl = serve(page('index-OLD.js'));
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => 0 });
    await watch.check();
    expect(isNewBuildReady()).toBe(false);
  });

  it('notices once the site serves a different build, and tells whoever is listening', async () => {
    const heard = vi.fn();
    const fetchImpl = serve(page('index-NEW.js'));
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => 0 });
    watch.subscribe(heard);
    await watch.check();
    expect(isNewBuildReady()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('asks for the page itself, never from a cache, and sends nobody’s cookies with it', async () => {
    const fetchImpl = serve(page('index-OLD.js'));
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => 0 });
    await watch.check();
    expect(fetchImpl).toHaveBeenCalledWith('/', { cache: 'no-store', credentials: 'omit' });
  });

  it('checks when the window is looked at again, and not more than once in five minutes', async () => {
    let clock = 0;
    const fetchImpl = serve(page('index-OLD.js'));
    watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => clock });

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    clock = 4 * 60_000;
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock = 5 * 60_000;
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('stops asking once it knows: the answer cannot go back to "no"', async () => {
    let clock = 0;
    const fetchImpl = serve(page('index-NEW.js'));
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => clock });
    await watch.check();
    clock = 60 * 60_000;
    await watch.check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('takes no signal, a failed answer or a page it cannot read as "nothing new", never as an error', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const a = watchForNewBuild({ running: 'index-OLD.js', fetchImpl: offline, now: () => 0 });
    await expect(a.check()).resolves.toBeUndefined();
    expect(isNewBuildReady()).toBe(false);

    resetFreshBuildForTests();
    const b = watchForNewBuild({
      running: 'index-OLD.js',
      fetchImpl: serve('Bad gateway', 502),
      now: () => 0,
    });
    await b.check();
    expect(isNewBuildReady()).toBe(false);

    resetFreshBuildForTests();
    const c = watchForNewBuild({
      running: 'index-OLD.js',
      fetchImpl: serve('<html>maintenance</html>'),
      now: () => 0,
    });
    await c.check();
    expect(isNewBuildReady()).toBe(false);
  });

  it('does nothing at all where the running page has no built entry: the dev server', async () => {
    const fetchImpl = serve(page('index-NEW.js'));
    const watch = watchForNewBuild({ running: null, fetchImpl, now: () => 0 });
    await watch.check();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isNewBuildReady()).toBe(false);
  });
});
