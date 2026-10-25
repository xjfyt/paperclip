/** JSON.parse validates syntax; this second pass rejects duplicate object keys,
 * including escaped spellings, which JSON.parse would silently overwrite. */
export function parseUniqueJson(source) {
  const value = JSON.parse(source);
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
  let cursor = 0;
  function visit() {
    const token = tokens[cursor++];
    if (token === "{") {
      const keys = new Set();
      if (tokens[cursor] === "}") { cursor++; return; }
      for (;;) {
        const key = JSON.parse(tokens[cursor++]);
        if (keys.has(key)) throw Error(`Duplicate JSON key: ${key}`);
        keys.add(key); cursor++; visit();
        if (tokens[cursor++] === "}") return;
      }
    }
    if (token === "[") {
      if (tokens[cursor] === "]") { cursor++; return; }
      for (;;) { visit(); if (tokens[cursor++] === "]") return; }
    }
  }
  visit();
  return value;
}
