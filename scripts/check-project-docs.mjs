import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredFiles = ["README.md", "docs/README.md", "docs/00-doc-rules.md"];
const scopedDirectories = ["docs/01-overview", "docs/02-getting-started", "docs/03-config", "docs/04-modules", "docs/05-maintenance"];
// The fork's stable topic pages predate the NN-kebab formal-document layout.
// They still get existence, single-H1 and link-integrity checks; the numbered
// heading and maintenance-metadata rules apply only to docs/NN-* pages.
const supplementaryDocuments = [
  "doc/mimouse/README.md",
  "doc/mimouse/VERIFICATION.md",
  "doc/mimouse/REMAINING.md",
  "doc/mimouse/USER-ACCEPTANCE.md",
  "doc/mimouse/PLAN-TRACEABILITY.md",
  "doc/mimouse/FEEDBACK-EVALUATION-LINEAGE.md",
];
const topicName = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const portable = value => value.split(path.sep).join("/");
const blank = value => value.replace(/[^\n]/g, " ");
const lineAt = (source, offset) => source.slice(0, offset).split("\n").length;

// Keep offsets and line numbers while hiding fenced examples, including tilde
// fences and CRLF files. Inline code is hidden later, after finding headings.
function withoutFences(source) {
  let fence = null;
  return source.replace(/\r\n?/g, "\n").split("\n").map(line => {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line)) fence = null;
      return blank(line);
    }
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match || (match[1][0] === "`" && match[2].includes("`"))) return line;
    fence = { character: match[1][0], length: match[1].length };
    return blank(line);
  }).join("\n");
}

function headingsIn(prose) {
  return [...prose.matchAll(/^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)]
    .map(match => ({ level: match[1].length, title: match[2], line: lineAt(prose, match.index) }));
}

function slug(title) {
  return title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
}

function anchorsIn(source) {
  const prose = withoutFences(source);
  const anchors = new Set();
  for (const heading of headingsIn(prose)) {
    const base = slug(heading.title);
    let anchor = base;
    let duplicate = 0;
    while (anchors.has(anchor)) anchor = `${base}-${++duplicate}`;
    anchors.add(anchor);
  }
  for (const match of prose.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi)) anchors.add(match[1]);
  return anchors;
}

function linksIn(prose) {
  const links = [];
  const text = prose.replace(/(`+)([^`]|(?!\1)`)*?\1/g, blank);
  // Read destinations separately so balanced/escaped parentheses and angle
  // destinations with spaces do not become false missing-file reports.
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(/g)) {
    let cursor = match.index + match[0].length;
    while (/[ \t\n]/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
    let href = "";
    if (text[cursor] === "<") {
      const end = text.indexOf(">", cursor + 1);
      if (end === -1) continue;
      href = text.slice(cursor + 1, end);
    } else {
      let depth = 0;
      while (cursor < text.length) {
        const character = text[cursor++];
        if (character === "\\" && cursor < text.length) { href += text[cursor++]; continue; }
        if (character === "(" ) depth++;
        if (character === ")") { if (depth === 0) break; depth--; }
        if (/\s/.test(character) && depth === 0) break;
        href += character;
      }
    }
    links.push({ href, line: lineAt(text, match.index) });
  }
  // Reference-style links use the definition's destination, checked once even
  // when several labels reference it. Unused definitions are checked as well.
  for (const match of text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|(\S+))/gm)) {
    links.push({ href: match[1] ?? match[2], line: lineAt(text, match.index) });
  }
  return links;
}

/** Check only the project's new Chinese entry documents, never all upstream docs. */
export function checkProjectDocs(root) {
  root = fs.realpathSync(root);
  const files = [];
  const issues = [];
  const addIssue = (file, line, code, message) => issues.push({ file: portable(file), line, code, message });
  for (const file of [...requiredFiles, ...supplementaryDocuments]) {
    if (!fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile()) addIssue(file, 1, "missing-document", "Required project document is missing");
    else files.push(file);
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { addIssue(relative, 1, "document-symlink", "Scoped document trees must not contain symlinks"); continue; }
      if (entry.isDirectory()) {
        if (!topicName.test(entry.name)) addIssue(relative, 1, "directory-name", "Use NN-kebab-case for a formal document directory");
        walk(relative);
      } else if (/\.mdx?$/i.test(entry.name)) {
        if (!new RegExp(`^${topicName.source.slice(1, -1)}\\.md$`).test(entry.name)) addIssue(relative, 1, "document-name", "Use NN-kebab-case.md for formal documents");
        files.push(relative);
      }
    }
  }
  for (const directory of scopedDirectories) {
    if (!fs.existsSync(path.join(root, directory)) || !fs.statSync(path.join(root, directory)).isDirectory()) addIssue(directory, 1, "missing-directory", "Required project document directory is missing");
    else walk(directory);
  }
  const anchorCache = new Map();
  let localLinks = 0;
  for (const file of files) {
    const prose = withoutFences(fs.readFileSync(path.join(root, file), "utf8"));
    const headings = headingsIn(prose);
    if (headings.filter(heading => heading.level === 1).length !== 1) addIssue(file, 1, "h1-count", "Document must contain exactly one H1");
    if (!supplementaryDocuments.includes(file)) {
      for (const heading of headings) {
        if (heading.level === 2 && !/^[一二三四五六七八九十百]+、\S/.test(heading.title)) addIssue(file, heading.line, "h2-number", "Use a Chinese numbered H2, such as 一、主题");
        if (heading.level === 3 && !/^\d+、\S/.test(heading.title)) addIssue(file, heading.line, "h3-number", "Use a numbered H3, such as 1、主题");
      }
      if (file !== "README.md") {
        if (!/^>\s*\*\*维护提示\*\*[^\n]*\S/m.test(prose)) addIssue(file, 1, "maintenance-metadata", "Missing 维护提示 metadata");
        if (!/^>\s*\*\*最后验证\*\*[^\n]*\d{4}-\d{2}-\d{2}/m.test(prose)) addIssue(file, 1, "verification-metadata", "Missing dated 最后验证 metadata");
      }
    }
    for (const link of linksIn(prose)) {
      const href = link.href;
      if (/^(?:https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith("//")) continue;
      localLinks++;
      if (/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(href)) { addIssue(file, link.line, "link-not-relative", `Use a repository-relative link: ${href}`); continue; }
      let target;
      let anchor;
      try {
        const hash = href.indexOf("#");
        target = decodeURIComponent((hash === -1 ? href : href.slice(0, hash)).split("?")[0]);
        anchor = hash === -1 ? null : decodeURIComponent(href.slice(hash + 1));
      } catch { addIssue(file, link.line, "link-encoding", `Invalid percent encoding: ${href}`); continue; }
      let resolved = target ? path.resolve(root, path.dirname(file), target) : path.resolve(root, file);
      if (!fs.existsSync(resolved)) { addIssue(file, link.line, "missing-link", `Link target does not exist: ${href}`); continue; }
      resolved = fs.realpathSync(resolved);
      const relative = path.relative(root, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { addIssue(file, link.line, "link-outside-root", `Link leaves the repository: ${href}`); continue; }
      if (!anchor) continue;
      if (fs.statSync(resolved).isDirectory()) resolved = path.join(resolved, "README.md");
      if (!fs.existsSync(resolved) || !/\.mdx?$/i.test(resolved)) { addIssue(file, link.line, "missing-anchor", `Cannot resolve Markdown anchor: ${href}`); continue; }
      if (!anchorCache.has(resolved)) anchorCache.set(resolved, anchorsIn(fs.readFileSync(resolved, "utf8")));
      if (!anchorCache.get(resolved).has(anchor)) addIssue(file, link.line, "missing-anchor", `Anchor does not exist: ${href}`);
    }
  }
  return {
    files: files.length,
    localLinks,
    issues,
    scope: [...requiredFiles, ...supplementaryDocuments, ...scopedDirectories.map(directory => `${directory}/**/*.md`)],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkProjectDocs(fileURLToPath(new URL("../", import.meta.url)));
  for (const issue of result.issues) console.error(`${issue.file}:${issue.line} [${issue.code}] ${issue.message}`);
  console.log(`Project docs: ${result.files} files, ${result.localLinks} local links, ${result.issues.length} issues.`);
  console.log(`Scope: ${result.scope.join(", ")}. Existing upstream docs are checked only as link targets.`);
  process.exitCode = result.issues.length ? 1 : 0;
}
