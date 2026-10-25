import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUniqueJson } from "./mimouse-json.mjs";
test("rejects duplicate keys before composition", () => {
  for (const input of ['{"a":1,"a":2}', '{"nested":[{"a":1,"\\u0061":2}]}', '{"x":{"key":1,"key":2}}']) assert.throws(() => parseUniqueJson(input), /Duplicate JSON key/);
});
test("permits independent scopes and strings containing JSON punctuation", () => {
  const input = '{"left":{"a":1},"right":{"a":2},"text":"{\\\"a\\\":2}","array":[true,false,null,-2.3e4,{},[]]}';
  assert.deepEqual(parseUniqueJson(input), JSON.parse(input));
});
test("retains native syntax validation", () => {
  for (const input of ['{"a":}', '[1,]', '', '{a:1}', '{"a":1} trailing']) assert.throws(() => parseUniqueJson(input), SyntaxError);
});
