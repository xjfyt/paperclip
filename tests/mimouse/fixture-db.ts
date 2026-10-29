import path from "node:path";
import { realpath } from "node:fs/promises";
import { createDb } from "../../packages/db/src/index.js";

/** Never mutate a database just because the fixed fixture port accepts our
 * credentials. Verify the harness-owned data directory before returning it. */
export async function createFixtureDb() {
  const home = process.env.PAPERCLIP_MIMOUSE_TEST_HOME;
  if (!home || !path.isAbsolute(home)) throw Error("An absolute isolated PAPERCLIP_MIMOUSE_TEST_HOME is required");
  const expected = await realpath(path.join(home, "instances/default/db"));
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  try {
    const rows = await db.$client.unsafe("SHOW data_directory");
    const actual = rows[0]?.data_directory;
    if (typeof actual !== "string" || await realpath(actual) !== expected) throw Error("Fixture database identity mismatch; refusing all mutations");
    return db;
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}
