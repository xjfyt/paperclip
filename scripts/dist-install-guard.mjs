// Copied into the consumer; Node 24 synchronous hooks cover ESM and require.
import { registerHooks } from 'node:module';
import { realpathSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, sep, isAbsolute, resolve } from 'node:path';
const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(result.url));
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Runtime escaped isolated consumer: ${path}`);
    if (/\.(?:[cm]?ts|tsx)$/.test(path)) throw new Error(`Runtime loaded TypeScript: ${path}`);
    if (path.includes(`${sep}@paperclipai${sep}`)) {
      if (path.includes(`${sep}src${sep}`) || /shim/i.test(path)) throw new Error(`Runtime loaded workspace source/shim: ${path}`);
      appendFileSync(resolve(root, 'runtime-resolutions.jsonl'), JSON.stringify({ specifier, path }) + '\n');
    }
  }
  return result;
} });
