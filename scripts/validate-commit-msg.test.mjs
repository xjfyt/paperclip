import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SAMPLE_COMPLIANT_MESSAGE,
  isExemptCommit,
  normalizeCommitMessage,
  validateCommitMessage,
} from './validate-commit-msg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'validate-commit-msg.mjs');

test('accepts compliant Chinese type(scope) message with required sections', () => {
  const result = validateCommitMessage(SAMPLE_COMPLIANT_MESSAGE);
  assert.equal(result.ok, true);
});

test('rejects one-line feat without body', () => {
  const result = validateCommitMessage('feat(webui): 添加按钮');
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /禁止无正文的单行/);
});

test('rejects one-line fix without body', () => {
  const result = validateCommitMessage('fix(llm): 修复崩溃');
  assert.equal(result.ok, false);
});

test('rejects English-only title summary', () => {
  const msg = SAMPLE_COMPLIANT_MESSAGE.replace(
    'chore(git): 安装提交说明校验钩子',
    'chore(git): install commit message hook',
  );
  const result = validateCommitMessage(msg);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /标题摘要须使用中文/);
});

test('rejects missing required section', () => {
  const msg = `feat(git): 补充提交校验

原因：
为什么
事项：
事项
关联：
无

改动：
- x：y
`;
  const result = validateCommitMessage(msg);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /验证/);
});

test('allows merge revert and fixup commits', () => {
  assert.equal(isExemptCommit('Merge branch a into b'), true);
  assert.equal(isExemptCommit('Revert "feat(x): y"'), true);
  assert.equal(isExemptCommit('fixup! feat(x): y'), true);
  assert.equal(isExemptCommit('squash! docs(x): y'), true);
  assert.equal(validateCommitMessage('Merge pull request #1').ok, true);
});

test('strips git comment lines before validating', () => {
  const raw = `${SAMPLE_COMPLIANT_MESSAGE}\n# please enter the commit message\n`;
  assert.equal(validateCommitMessage(raw).ok, true);
  assert.equal(normalizeCommitMessage('a\n# b\nc').includes('#'), false);
});

test('CLI exits 1 for bad file and 0 for sample file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-'));
  const bad = path.join(dir, 'bad.txt');
  const good = path.join(dir, 'good.txt');
  fs.writeFileSync(bad, 'feat(x): only title\n', 'utf8');
  fs.writeFileSync(good, SAMPLE_COMPLIANT_MESSAGE, 'utf8');
  const badRun = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
  assert.equal(badRun.status, 1);
  assert.match(badRun.stderr, /禁止无正文的单行/);
  const goodRun = spawnSync(process.execPath, [script, good], { encoding: 'utf8' });
  assert.equal(goodRun.status, 0);
});

test('CLI --sample prints compliant message', () => {
  const run = spawnSync(process.execPath, [script, '--sample'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /原因：/);
  assert.match(run.stdout, /Co-Authored-By: Qoder/);
});
