import fs from "node:fs";
import { parseUniqueJson } from "./mimouse-json.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../ui/src/i18n/", import.meta.url));
const locales = ["en", "zh-CN", "es", "ja"];
const domains = fs.readdirSync(path.join(root, "contributions")).sort();
const flatten = (value, prefix = "") => Object.entries(value).flatMap(([key, item]) => {
  const full = prefix ? `${prefix}.${key}` : key;
  if (["__proto__", "constructor", "prototype"].includes(key)) throw Error(`Unsafe key ${full}`);
  if (typeof item === "string") return [[full, item]];
  if (!item || Array.isArray(item) || typeof item !== "object") throw Error(`Non-string leaf ${full}`);
  return flatten(item, full);
});
const compiled = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(domains.map(domain => [domain,
  parseUniqueJson(fs.readFileSync(path.join(root, "contributions", domain, `${locale}.json`), "utf8")),
]))]));
const reference = new Map(flatten(compiled.en));
for (const locale of locales) {
  const messages = new Map(flatten(compiled[locale]));
  if (messages.size !== reference.size || [...messages.keys()].some(key => !reference.has(key))) throw Error(`${locale}: key mismatch`);
  for (const [key, value] of reference) {
    const translated = messages.get(key);
    const placeholders = text => [...text.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map(match => match[1]).sort().join("|");
    if (placeholders(value) !== placeholders(translated)) throw Error(`${locale}:${key}: placeholder mismatch`);
    if (/<\/?[A-Za-z]|javascript\s*:|data\s*:/i.test(translated)) throw Error(`${locale}:${key}: unsafe content`);
    const urls = text => [...text.matchAll(/https?:\/\/[^\s]+/g)].map(match => match[0]).sort().join("|");
    if (urls(value) !== urls(translated)) throw Error(`${locale}:${key}: URL mismatch`);
  }
  const result = JSON.stringify(compiled[locale], null, 2) + "\n";
  const target = path.join(root, "locales", `${locale}.json`);
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8") !== result) throw Error(`Outdated generated file: ${locale}`);
  } else fs.writeFileSync(target, result);
}
console.log(`Validated ${reference.size} keys across ${locales.length} locales.`);
