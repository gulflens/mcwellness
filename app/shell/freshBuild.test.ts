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

  it("does not care which order the tag's attributes come in, since that is the bundler's to choose", () => {
    expect(
      entryOf('<script crossorigin src="/assets/index-Zz9_-a.js" type="module"></script>'),
    ).toBe('index-Zz9_-a.js');
    expect(
      entryOf(
        '<script type="module" crossorigin="" nonce="" src="/assets/index-Zz9_-a.js"></script>',
      ),
    ).toBe('index-Zz9_-a.js');
  });

  it('is not taken in by a preload or a stylesheet of the same name', () => {
    expect(
      entryOf(
        '<link rel="modulepreload" href="/assets/index-AAAA.js"><link rel="stylesheet" href="/assets/index-AAAA.css">',
      ),
    ).toBe(null);
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
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => clock });

    // The first answer, all the way in: the five minutes run from an answer.
    await watch.check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

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

  it('asks again at the very next look after a failed answer, not five minutes later', async () => {
    let online = false;
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(page('index-NEW.js'));
    });
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => 0 });
    await watch.check();
    expect(isNewBuildReady()).toBe(false);

    online = true;
    await watch.check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(isNewBuildReady()).toBe(true);
  });

  it('asks once, not twice, when focus and visibility arrive together while the first is still out', async () => {
    let release: (r: Response) => void = () => undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const watch = watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => 0 });
    const first = watch.check();
    const second = watch.check();
    release(new Response(page('index-OLD.js')));
    await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('listens once however many times it is started', async () => {
    const earlier = serve(page('index-OLD.js'));
    const fetchImpl = serve(page('index-OLD.js'));
    watchForNewBuild({ running: 'index-OLD.js', fetchImpl: earlier, now: () => 0 });
    watchForNewBuild({ running: 'index-OLD.js', fetchImpl, now: () => 0 });
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    // The first watcher was taken down when the second was put up.
    expect(earlier).not.toHaveBeenCalled();
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
