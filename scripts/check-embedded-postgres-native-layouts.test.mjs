import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { resolveEmbeddedPostgresNativeLibDir, ensureLinuxSharedLibraryAliases } from '../packages/db/src/embedded-postgres-native.ts';

async function fixture(layout, body) {
  const root = await mkdtemp(join(tmpdir(), 'paperclip-native-layout-'));
  try {
    const wrapper = join(root, 'node_modules/@paperclipai/db/node_modules/embedded-postgres/dist/index.js');
    const native = join(root, layout === 'hoisted' ? 'node_modules' : 'node_modules/@paperclipai/db/node_modules', '@embedded-postgres/linux-x64');
    await mkdir(dirname(wrapper), { recursive: true }); await writeFile(wrapper, '');
    await mkdir(join(native, 'dist'), { recursive: true }); await mkdir(join(native, 'native/lib'), { recursive: true });
    await writeFile(join(native, 'package.json'), JSON.stringify({ name: '@embedded-postgres/linux-x64', exports: './dist/index.js' }));
    await writeFile(join(native, 'dist/index.js'), 'throw new Error("fixture package must never execute")');
    await body({ root, wrapper, native });
  } finally { await rm(root, { recursive: true, force: true }); }
}
for (const layout of ['hoisted', 'bundled']) test(`resolves ${layout} optional native dependency without executing it`, async () => {
  await fixture(layout, async ({ wrapper, native }) => {
    const lib = await resolveEmbeddedPostgresNativeLibDir(wrapper, 'linux-x64');
    assert.equal(lib, join(native, 'native/lib'));
    await writeFile(join(lib, 'libicuuc.so.60.2'), 'fixture');
    await ensureLinuxSharedLibraryAliases(lib);
    assert.equal(await readlink(join(lib, 'libicuuc.so.60')), 'libicuuc.so.60.2');
  });
});
test('rejects native-library symlink escape', async () => fixture('hoisted', async ({ wrapper, native, root }) => {
  const lib = join(native, 'native/lib'), outside = join(root, 'outside');
  await rm(lib, { recursive: true }); await mkdir(outside); await symlink(outside, lib);
  await assert.rejects(resolveEmbeddedPostgresNativeLibDir(wrapper, 'linux-x64'), /escape/);
}));
test('rejects unexpected native identity and unsupported host names', async () => fixture('bundled', async ({ wrapper, native }) => {
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: 'unexpected', exports: './dist/index.js' }));
  await assert.rejects(resolveEmbeddedPostgresNativeLibDir(wrapper, 'linux-x64'), /identity/);
  await assert.rejects(resolveEmbeddedPostgresNativeLibDir(wrapper, '../other'), /Unsupported/);
}));

test('shared DB loader selects bundled qualified wrapper over unpatched hoisted copy', async () => {
  await fixture('hoisted', async ({ root, wrapper }) => {
    const bundledPackage = dirname(dirname(wrapper));
    await writeFile(join(bundledPackage, 'package.json'), JSON.stringify({ name: 'embedded-postgres', type: 'module', exports: './dist/index.js' }));
    await writeFile(wrapper, 'export default { fixtureIdentity: "qualified-bundled" };');
    const unpatchedPackage = join(root, 'node_modules/embedded-postgres');
    await mkdir(unpatchedPackage, { recursive: true });
    await writeFile(join(unpatchedPackage, 'package.json'), JSON.stringify({ name: 'embedded-postgres', type: 'module', exports: './index.js' }));
    await writeFile(join(unpatchedPackage, 'index.js'), 'throw new Error("unqualified hoisted wrapper must not load");');
    const dbDist = join(root, 'node_modules/@paperclipai/db/dist');
    await mkdir(dbDist, { recursive: true });
    const loader = join(dbDist, 'embedded-postgres-loader.mjs');
    // The production loader is also valid JavaScript; copy unchanged to the
    // installed-layout fixture rather than reimplementing its resolution logic.
    await writeFile(loader, await readFile(new URL('../packages/db/src/embedded-postgres-loader.ts', import.meta.url), 'utf8'));
    const { loadEmbeddedPostgres } = await import(pathToFileURL(loader).href);
    assert.equal((await loadEmbeddedPostgres()).default.fixtureIdentity, 'qualified-bundled');
  });
});
