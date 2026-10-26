import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimeExports, inside, releaseClosure } from './dist-install-smoke.mjs';
import { materializePublishManifest } from './prepare-bundled-package.mjs';
test('uses the canonical publishConfig materialization, not workspace TS exports', () => {
  const p = { name: '@paperclipai/example', version: '1.0.0', exports: './src/index.ts', publishConfig: { exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } } };
  assert.throws(() => assertRuntimeExports(p.exports), /Non-dist/);
  assert.doesNotThrow(() => assertRuntimeExports(materializePublishManifest(p).exports));
});
test('rejects nested fallback TS, source and shim paths', () => {
  for (const value of ['./src/index.js', './dist/boot-shim.js', { '.': { import: ['./dist/index.js', './src/fallback.ts'] } }]) assert.throws(() => assertRuntimeExports(value), /Non-dist/);
});
test('rejects unpublished/private workspace runtime edges, including optional and peer', () => {
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const root = { name: '@paperclipai/server', pkg: { [section]: { '@paperclipai/private': 'workspace:*' } } };
    assert.throws(() => releaseClosure([root]), /Unpublished/);
    assert.throws(() => releaseClosure([root, { name: '@paperclipai/private', pkg: { private: true } }]), /Unpublished/);
  }
});
test('orders complete runtime closure without dev-only private vendors', () => {
  const child = { name: '@paperclipai/shared', pkg: {} };
  const root = { name: '@paperclipai/server', pkg: { dependencies: { [child.name]: 'workspace:*' }, devDependencies: { '@paperclipai/paperclip-runner': 'workspace:*' } } };
  assert.deepEqual(releaseClosure([root, child]).map(p => p.name), [child.name, root.name]);
});
test('containment rejects sibling-prefix and parent escapes', () => {
  assert.equal(inside('/tmp/fixture', '/tmp/fixture/x'), true);
  for (const p of ['/tmp/fixture-other/x', '/tmp/fixture', '/tmp/outside']) assert.equal(inside('/tmp/fixture', p), false);
});

test('allows compiled dist/src layout but rejects package-root source and traversal', () => {
  assert.doesNotThrow(() => assertRuntimeExports({ '.': { import: './dist/src/index.js', types: './dist/src/index.d.ts' } }));
  assert.throws(() => assertRuntimeExports('./dist/../src/index.js'), /Non-dist/);
});

test('canonical unified release version prevents SDK workspace edges requesting unpublished versions', () => {
  const manifest = materializePublishManifest({ name: '@paperclipai/plugin-sdk', version: '0.3.1', dependencies: { '@paperclipai/shared': 'workspace:*' } });
  assert.equal(manifest.dependencies['@paperclipai/shared'], manifest.version);
});
