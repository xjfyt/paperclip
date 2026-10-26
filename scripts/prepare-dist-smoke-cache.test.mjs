import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheEnvironment, hostMatches } from './prepare-dist-smoke-cache.mjs';
test('preserves configured routing/trust without carrying authentication or TLS bypasses', () => {
  const input = { PATH: '/bin', HTTPS_PROXY: 'existing-route', NODE_EXTRA_CA_CERTS: 'existing-ca', SSL_CERT_FILE: 'existing-file', REQUESTS_CA_BUNDLE: 'existing-bundle', NPM_TOKEN: 'secret', NODE_OPTIONS: '--import unwanted', NODE_TLS_REJECT_UNAUTHORIZED: '0', npm_config_strict_ssl: 'false', DATABASE_URL: 'production' };
  const env = cacheEnvironment(input, '/tmp/home', '/tmp/cache', '/tmp/fixture');
  for (const key of ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']) assert.equal(env[key], input[key]);
  for (const key of ['NPM_TOKEN', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'npm_config_strict_ssl', 'DATABASE_URL']) assert.equal(env[key], undefined);
  assert.equal(env.npm_config_ignore_scripts, 'true');
  assert.equal(env.npm_config_registry, 'https://registry.npmjs.org');
  assert.notEqual(env.npm_config_userconfig, env.npm_config_globalconfig);
});
test('filters native package platforms including exclusions', () => {
  assert.equal(hostMatches(undefined, 'linux'), true);
  assert.equal(hostMatches(['linux'], 'linux'), true);
  assert.equal(hostMatches(['darwin'], 'linux'), false);
  assert.equal(hostMatches(['!linux'], 'linux'), false);
  assert.equal(hostMatches(['!win32'], 'linux'), true);
});
