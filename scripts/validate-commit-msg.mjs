#!/usr/bin/env node
/**
 * Validate commit messages per docs/00-doc-rules.md section 7.
 * Chinese type(scope): title + required body sections.
 *
 * Usage:
 *   node scripts/validate-commit-msg.mjs <msg-file>
 *   echo "..." | node scripts/validate-commit-msg.mjs
 *   node scripts/validate-commit-msg.mjs --sample
 *
 * Exempt: Merge / Revert / fixup! / squash! prefixes.
 */

import fs from 'node:fs';
import process from 'node:process';

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'hotfix',
  'refactor',
  'arch',
  'perf',
  'security',
  'docs',
  'ops',
  'infra',
  'chore',
  'research',
  'ai',
  'revert',
  'test',
  'build',
];

export const REQUIRED_SECTIONS = ['原因', '事项', '关联', '改动', '验证'];

const TITLE_RE = new RegExp(
  `^(${COMMIT_TYPES.join('|')})\\([a-zA-Z0-9][a-zA-Z0-9._/-]*\\):\\s*\\S`,
);

const WEAK_TITLES = /^(update|fix|wip|tmp|修改|更新|调整|优化|完善)$/i;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** Strip git comment lines and trailing blank lines. */
export function normalizeCommitMessage(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter((line) => !line.startsWith('#'));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.join('\n').trimEnd();
}

export function isExemptCommit(message) {
  const first = message.split('\n')[0]?.trim() ?? '';
  if (/^Merge(\s|$)/.test(first)) return true;
  if (/^Revert(\s|$)/.test(first)) return true;
  if (/^(fixup|squash)!/.test(first)) return true;
  return false;
}

/**
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateCommitMessage(raw) {
  const message = normalizeCommitMessage(raw);
  const errors = [];

  if (!message.trim()) {
    return { ok: false, errors: ['提交说明为空。'] };
  }

  if (isExemptCommit(message)) {
    return { ok: true };
  }

  const lines = message.split('\n');
  const title = lines[0].trim();
  const body = lines.slice(1).join('\n');

  if (!TITLE_RE.test(title)) {
    errors.push(
      `标题须为「type(scope): 一句话概括」，type 为 ${COMMIT_TYPES.join(' / ')} 之一。当前：${JSON.stringify(title)}`,
    );
  } else {
    const desc = title.replace(/^[^:]+:\s*/, '').trim();
    if (!CJK_RE.test(desc)) {
      errors.push('标题摘要须使用中文；专有名词、路径和命令可保留英文。');
    }
    if (WEAK_TITLES.test(desc)) {
      errors.push(`标题摘要过弱（禁止仅写「${desc}」），须能看出模块和结果。`);
    }
    if (/[。．.]$/.test(desc)) {
      errors.push('标题不要以句号结尾。');
    }
  }

  const nonEmptyBody = body.replace(/^\n+/, '').trim();
  if (!nonEmptyBody) {
    errors.push(
      '禁止无正文的单行 feat/fix 等提交。正文须含「原因：」「事项：」「关联：」「改动：」「验证：」各节。',
    );
    return { ok: false, errors };
  }

  for (const name of REQUIRED_SECTIONS) {
    const headerRe = new RegExp(`^${name}：\\s*(.*)$`, 'm');
    const match = body.match(headerRe);
    if (!match) {
      errors.push(`缺少必填小节「${name}：」。`);
      continue;
    }
    const inline = (match[1] ?? '').trim();
    const afterIdx = match.index + match[0].length;
    const rest = body.slice(afterIdx);
    const nextHeader = rest.search(/^\S[^：\n]*：/m);
    const sectionBody = (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim();
    const content = [inline, sectionBody].filter(Boolean).join('\n').trim();
    if (!content) {
      errors.push(`「${name}：」小节不能为空。`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export const SAMPLE_COMPLIANT_MESSAGE = `chore(git): 安装提交说明校验钩子

原因：
避免 Agent 和开发者提交无正文的单行 feat/fix，统一按文档规范校验中文提交说明。
事项：
提交说明本地钩子与校验脚本
关联：
无

改动：
- scripts：新增 validate-commit-msg 与 install-git-hooks
- .githooks：commit-msg 调用校验脚本
- 文档：AGENTS.md 与 docs/00-doc-rules.md 指向钩子安装方式

验证：
node --test scripts/validate-commit-msg.test.mjs

Co-Authored-By: Qoder
`;

async function readInput(argv) {
  if (argv.includes('--sample')) {
    return { mode: 'sample' };
  }
  const fileArg = argv[2];
  if (fileArg && fileArg !== '-' && !fileArg.startsWith('--')) {
    return { mode: 'file', text: fs.readFileSync(fileArg, 'utf8') };
  }
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return { mode: 'stdin', text: Buffer.concat(chunks).toString('utf8') };
  }
  return { mode: 'empty', text: '' };
}

function printFailure(errors) {
  console.error('');
  console.error('✗ 提交说明不符合 docs/00-doc-rules.md §七（中文 type(scope): + 原因/事项/关联/改动/验证）。');
  console.error('');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  console.error('');
  console.error('合规样例：');
  console.error(SAMPLE_COMPLIANT_MESSAGE.trimEnd());
  console.error('');
  console.error('本地检查：pnpm commit:check');
  console.error('安装钩子：pnpm git:hooks:install');
  console.error('');
}

async function main() {
  const input = await readInput(process.argv);
  if (input.mode === 'sample') {
    process.stdout.write(SAMPLE_COMPLIANT_MESSAGE);
    process.exit(0);
  }
  const result = validateCommitMessage(input.text ?? '');
  if (!result.ok) {
    printFailure(result.errors);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('validate-commit-msg.mjs') ||
    process.argv[1].includes('validate-commit-msg.mjs'));

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
