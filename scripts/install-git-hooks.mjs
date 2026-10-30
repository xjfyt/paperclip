#!/usr/bin/env node
/**
 * Point this repo at .githooks via core.hooksPath (idempotent).
 * Usage: pnpm git:hooks:install
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = path.join(root, '.githooks');
const commitMsg = path.join(hooksDir, 'commit-msg');

function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim() || `git ${args.join(' ')} failed`;
    throw new Error(err);
  }
  return (r.stdout || '').trim();
}

if (!fs.existsSync(path.join(root, '.git'))) {
  console.error('✗ 当前目录不是 Git 仓库根（缺少 .git）。');
  process.exit(1);
}
if (!fs.existsSync(commitMsg)) {
  console.error(`✗ 缺少钩子文件：${path.relative(root, commitMsg)}`);
  process.exit(1);
}

try {
  fs.chmodSync(commitMsg, 0o755);
} catch {
  // Windows may ignore the execute bit; git still runs the hook via hooksPath.
}

const desired = '.githooks';
const current = (() => {
  const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.status !== 0) return '';
  return (r.stdout || '').trim();
})();

if (current === desired || current === path.join(root, desired)) {
  console.log(`✓ core.hooksPath 已是 ${desired}（无需改动）`);
  process.exit(0);
}

git(['config', 'core.hooksPath', desired]);
const after = git(['config', '--get', 'core.hooksPath']);
console.log(`✓ 已设置 core.hooksPath=${after}`);
console.log('  commit-msg 将调用 scripts/validate-commit-msg.mjs');
