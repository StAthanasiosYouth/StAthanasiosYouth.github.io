import test from 'node:test';
import assert from 'node:assert/strict';
import { turnstileHosts } from '../src/book/turnstile.js';

test('turnstile: production accepts tokens from the family domain and GitHub Pages, never localhost', () => {
  const hosts = turnstileHosts({
    SITE_URL: 'https://stathanasiosyouthsafaga.social',
    ALLOWED_ORIGINS: 'https://stathanasiosyouth.github.io,https://stathanasiosyouthsafaga.social,http://localhost:8080'
  });
  assert.deepEqual(hosts.sort(), ['stathanasiosyouth.github.io', 'stathanasiosyouthsafaga.social']);
});

test('turnstile: back on github.io, the domain still in ALLOWED_ORIGINS is still accepted', () => {
  const hosts = turnstileHosts({ SITE_URL: 'https://stathanasiosyouth.github.io', ALLOWED_ORIGINS: 'https://stathanasiosyouth.github.io' });
  assert.deepEqual(hosts, ['stathanasiosyouth.github.io']);
});
