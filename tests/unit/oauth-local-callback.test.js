import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/app/callback/page.js', import.meta.url), 'utf8');
function mount() {
  const listeners = {};
  const timers = [];
  const channels = [];
  const statuses = ['processing'];
  let closed = false;
  const opener = { postMessage() {} };
  const window = {
    location: { origin: 'http://127.0.0.1:3999', href: 'http://127.0.0.1:3999/callback?code=abc&state=login1' },
    opener,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: (name) => { delete listeners[name]; },
    close: () => { closed = true; },
  };
  const body = source.slice(source.indexOf('    const code ='), source.indexOf('\n  }, [searchParams]);'));
  const cleanup = vm.runInNewContext('(function () {' + body + '\n})()', {
    searchParams: new URLSearchParams('code=abc&state=login1'), window,
    setStatus: (value) => statuses.push(value),
    BroadcastChannel: class {
      constructor(name) { this.name = name; channels.push(this); }
      postMessage() {} close() {}
    },
    localStorage: { setItem() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  });
  return { listeners, timers, channels, statuses, window, cleanup, closed: () => closed };
}
describe('local OAuth callback lifecycle', () => {
  it('keeps URL available without confirmation, even after relay timeout', () => {
    const env = mount();
    expect(env.statuses).toEqual(['processing']);
    env.timers.find(t => t.ms === 10000).fn();
    env.timers.find(t => t.ms === 30000).fn();
    expect(env.statuses).toEqual(['processing', 'manual']);
    expect(env.closed()).toBe(false);
    expect(env.timers.some(t => t.ms === 1500)).toBe(false);
    env.cleanup();
    expect(Object.keys(env.listeners)).toEqual([]);
  });
  it('rejects mismatched state, foreign origins and unrelated windows', () => {
    const env = mount();
    for (const event of [
      { origin: 'https://foreign.example', source: env.window.opener, data: { type: 'oauth_complete', state: 'login1' } },
      { origin: env.window.location.origin, source: {}, data: { type: 'oauth_complete', state: 'login1' } },
      { origin: env.window.location.origin, source: env.window.opener, data: { type: 'oauth_complete', state: 'other' } },
    ]) env.listeners.message(event);
    expect(env.statuses).toEqual(['processing']);
  });
  it('closes only after matching saved-account confirmation', () => {
    const env = mount();
    const completion = env.channels.find(c => c.name === 'oauth_completion');
    completion.onmessage({ data: { type: 'oauth_complete', state: 'login1' } });
    expect(env.statuses).toEqual(['processing', 'success']);
    expect(env.closed()).toBe(false);
    env.timers.find(t => t.ms === 1500).fn();
    expect(env.closed()).toBe(true);
  });
});
