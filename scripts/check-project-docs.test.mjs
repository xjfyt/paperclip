import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkProjectDocs } from "./check-project-docs.mjs";

const formal = "# 测试文档\n\n> **维护提示** — 行为变化时更新\n> **最后验证** — 2026-10-29\n\n## 一、说明\n\n### 1、步骤\n";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-doc-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, source);
  };
  for (const file of ["README.md", "docs/README.md", "docs/00-doc-rules.md", "docs/01-overview/01-introduction.md", "docs/02-getting-started/01-development.md", "docs/03-config/01-configuration.md", "docs/04-modules/01-integrations.md", "docs/05-maintenance/01-verification.md"]) write(file, formal);
  return { root, write, check: () => checkProjectDocs(root) };
}

test("accepts Chinese/duplicate anchors, references, titles, encoded paths, HTML IDs and CRLF", t => {
  const { write, check } = fixture(t);
  write("README.md", "# 根入口\n\n[中文](docs/01-overview/01-introduction.md#一说明)\n[重复](docs/01-overview/01-introduction.md#一说明-1)\n[HTML](docs/01-overview/01-introduction.md#fixed)\n[编码](assets/a%20b.md#中文标题)\n[标题](assets/file\\(v1\\).md \"title\")\n[空格](<assets/a b.md>)\n[ref][说明]\n[说明]: assets/a%20b.md#中文标题\n");
  write("docs/01-overview/01-introduction.md", (formal + "\n## 一、说明\n\n<a id=\"fixed\"></a>\n").replace(/\n/g, "\r\n"));
  write("assets/a b.md", "# 中文标题\n");
  write("assets/file(v1).md", "# 文件\n");
  const result = check();
  assert.equal(result.issues.length, 0, JSON.stringify(result.issues));
  assert.equal(result.localLinks, 7);
  assert.equal(result.files, 8);
});

test("ignores fenced examples, inline-code links and malformed headings outside the declared scope", t => {
  const { write, check } = fixture(t);
  write("docs/README.md", formal + "\n```markdown\n# 第二个示例标题\n[missing](missing.md)\n```\n\n~~~md\n## 无序号示例\n[missing](absent.md)\n~~~\n\n`[missing](not-a-link.md)`\n");
  write("docs/start/legacy.md", "# Legacy\n# Another H1\n[missing](missing.md)\n");
  assert.deepEqual(check().issues, []);
});

test("rejects missing relative targets and missing Chinese anchors with source line numbers", t => {
  const { write, check } = fixture(t);
  write("README.md", "# 根入口\n\n[missing](absent.md)\n[anchor](docs/README.md#不存在)\n");
  const issues = check().issues;
  assert.deepEqual(issues.map(({ code, line }) => ({ code, line })), [{ code: "missing-link", line: 3 }, { code: "missing-anchor", line: 4 }]);
});

test("rejects invalid naming, H1/H2/H3 and missing maintenance metadata", t => {
  const { write, check } = fixture(t);
  write("docs/01-overview/wrong_name.md", "# First\n# Second\n## Plain\n### Plain\n");
  const codes = check().issues.map(issue => issue.code);
  for (const code of ["document-name", "h1-count", "h2-number", "h3-number", "maintenance-metadata", "verification-metadata"]) assert.ok(codes.includes(code), `Missing diagnostic ${code}`);
});

test("rejects missing required documents and invalid nested directory names", t => {
  const { root, write, check } = fixture(t);
  fs.unlinkSync(path.join(root, "docs/README.md"));
  write("docs/05-maintenance/plain/01-topic.md", formal);
  const codes = check().issues.map(issue => issue.code);
  assert.ok(codes.includes("missing-document"));
  assert.ok(codes.includes("directory-name"));
});

test("rejects absolute, malformed encoded and repository-escaping local links", t => {
  const { write, check } = fixture(t);
  write("README.md", "# Root\n\n[absolute](/docs/README.md)\n[encoding](bad%ZZ.md)\n[outside](../)\n[external](https://example.invalid/a)\n");
  assert.deepEqual(check().issues.map(issue => issue.code), ["link-not-relative", "link-encoding", "link-outside-root"]);
});

test("does not turn headings inside code fences into valid target anchors", t => {
  const { write, check } = fixture(t);
  write("README.md", "# Root\n\n[example](docs/README.md#示例标题)\n");
  write("docs/README.md", formal + "\n```markdown\n# 示例标题\n```\n");
  assert.deepEqual(check().issues.map(issue => issue.code), ["missing-anchor"]);
});
