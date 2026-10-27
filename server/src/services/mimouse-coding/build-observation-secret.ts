const MAX_SECRET_BYTES = 32 * 1024;
// Exactly one literal key. JSON.parse is used only for the captured JSON STRING,
// never for an object where duplicate keys could have already been discarded.
const singleTokenObject = /^[ \t\r\n]*\{[ \t\r\n]*"token"[ \t\r\n]*:[ \t\r\n]*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")[ \t\r\n]*\}[ \t\r\n]*$/;
function invalid(): never { throw Error("observation_secret_invalid"); }

/** Existing GitLab secret format, with a deliberately narrow acceptance profile.
 * The caller must bind/hash the COMPLETE secret before extracting its token. */
export function parseBuildObservationSecret(raw: unknown): string {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_SECRET_BYTES) invalid();
  const match = singleTokenObject.exec(raw);
  if (!match || match[0].length !== raw.length) invalid();
  let token: unknown;
  try { token = JSON.parse(match[1]); } catch { return invalid(); }
  if (typeof token !== "string" || token.length < 1 || token.length > 4096 || /[^\x21-\x7e]/.test(token)) invalid();
  return token;
}
