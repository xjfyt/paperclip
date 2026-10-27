import { describe, expect, it } from "vitest";
import { parseBuildObservationSecret } from "../services/mimouse-coding/build-observation-secret.js";

describe("strict build observation GitLab secret decoder", () => {
  it("extracts only the token from the existing JSON secret contract", () => {
    expect(parseBuildObservationSecret('{"token":"fixture-not-a-real-token"}')).toBe("fixture-not-a-real-token");
    expect(parseBuildObservationSecret(' \t\r\n{ \n"token"\t:\r"fixture" }\r\n')).toBe("fixture");
    expect(parseBuildObservationSecret('{"token":"fixture\\u002dtoken\\/value"}')).toBe("fixture-token/value");
  });
  it("accepts exactly 4096 visible ASCII token characters and the 32 KiB document boundary", () => {
    const token = "!".repeat(4096); const raw = JSON.stringify({ token });
    expect(parseBuildObservationSecret(raw.padEnd(32 * 1024, " "))).toBe(token);
    expect(() => parseBuildObservationSecret(raw.padEnd(32 * 1024 + 1, " "))).toThrow("observation_secret_invalid");
  });
  it.each([
    undefined, null, {}, [], 1, true, "", "fixture-raw-token", '"fixture"', '[{"token":"fixture"}]', "{}",
    '{"token":null}', '{"token":1}', '{"token":true}', '{"token":[]}', '{"token":{}}',
    '{"token":""}', '{"token":"fixture","token":"other"}', '{"token":"fixture","extra":"other"}',
    '{"extra":"other","token":"fixture"}', '{"\\u0074oken":"fixture"}', '{"TOKEN":"fixture"}',
    '{"token":"fixture",}', '{token:"fixture"}', "{'token':'fixture'}", '{"token":"fixture"}{}',
    '{"token":"fixture"} null', '{"token":"fixture\\x20"}', '{"token":"fixture\\u00"}',
    '\ufeff{"token":"fixture"}', '\u00a0{"token":"fixture"}', '{"token":"fixture"}\u00a0',
    '{"token":"fixture"}\u2028', '{"token":"fixture\n"}', '{"token":"fixture\\n"}',
    '{"token":"fixture\\r"}', '{"token":"fixture\\t"}', '{"token":"fixture\\u007f"}',
    '{"token":"fixture\\u0020"}', '{"token":"fixture\\u0000"}', '{"token":"fixture\\ud800"}',
    '{"token":"fixtureé"}', JSON.stringify({ token: "x".repeat(4097) }),
  ])("rejects invalid or ambiguous secret fixture %# without leaking its contents", raw => {
    let caught: unknown;
    try { parseBuildObservationSecret(raw); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) throw Error("expected a stable failure");
    expect(caught.message).toBe("observation_secret_invalid");
  });
});
