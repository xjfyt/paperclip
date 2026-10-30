import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  inspectMigrations,
  reconcilePendingMigrationHistory,
  repairLegacyCrlfMigrationReceipts,
} from "./client.js";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("legacy CRLF migration receipts", () => {
  it("blocks inspection, reconciliation and automatic replay without changing database state", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-crlf-history-");
    const sql = postgres(database.connectionString, { max: 1, onnotice() {} });
    try {
      const file = "0000_mature_masked_marvel.sql";
      const content = await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");
      expect(content).not.toContain("\r");
      const crlf = createHash("sha256").update(content.replaceAll("\n", "\r\n")).digest("hex");
      // The template has the complete real migration chain applied. Recreate
      // one exact historical Windows receipt while retaining canonical rows:
      // partial matching must not hide the old receipt or replay existing DDL.
      const canonical = createHash("sha256").update(content).digest("hex");
      expect((await sql`UPDATE drizzle.__drizzle_migrations SET hash = ${crlf} WHERE hash = ${canonical} RETURNING id`).length).toBe(1);
      await sql.unsafe("CREATE TABLE migration_preservation_probe (value text NOT NULL); INSERT INTO migration_preservation_probe VALUES ('keep');");
      const history = await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
      const tables = await sql`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public', 'drizzle') ORDER BY 1, 2`;
      for (const operation of [inspectMigrations, reconcilePendingMigrationHistory, applyPendingMigrations]) {
        await expect(operation(database.connectionString)).rejects.toThrow(/Migration line-ending mismatch: 0000_mature_masked_marvel.sql/);
        expect(await sql`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(history);
        expect(await sql`SELECT * FROM migration_preservation_probe`).toEqual([{ value: "keep" }]);
        expect(await sql`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public', 'drizzle') ORDER BY 1, 2`).toEqual(tables);
      }
    } finally {
      await sql.end();
      await database.cleanup();
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("repairs only exact CRLF receipts, refuses ambiguous history, and is idempotent", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-crlf-repair-");
    const sql = postgres(database.connectionString, { max: 1, onnotice() {} });
    try {
      const file = "0000_mature_masked_marvel.sql";
      const content = await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");
      const crlf = createHash("sha256").update(content.replaceAll("\n", "\r\n")).digest("hex");
      const canonical = createHash("sha256").update(content).digest("hex");
      const [first, second] = await sql<{ id: number; hash: string }[]>`
        SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 2
      `;
      const total = Number((await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`)[0].count);
      const setHash = (id: number, hash: string) =>
        sql`UPDATE drizzle.__drizzle_migrations SET hash = ${hash} WHERE id = ${id} RETURNING id`;

      // A missing backup confirmation refuses before any write.
      expect((await setHash(first.id, crlf)).length).toBe(1);
      await expect(repairLegacyCrlfMigrationReceipts(database.connectionString)).rejects.toThrow(/backup confirmation/);
      expect((await sql`SELECT hash FROM drizzle.__drizzle_migrations WHERE id = ${first.id}`)[0].hash).toBe(crlf);

      // Two rows claiming the same legacy receipt collapse history; refuse it.
      expect((await setHash(second.id, crlf)).length).toBe(1);
      await expect(
        repairLegacyCrlfMigrationReceipts(database.connectionString, { backupConfirmed: true }),
      ).rejects.toThrow(/more than one legacy receipt/);
      expect(await sql`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${crlf} ORDER BY id`).toEqual([
        { id: first.id },
        { id: second.id },
      ]);

      // A receipt matching neither the LF file nor its CRLF form stays unresolved.
      expect((await setHash(second.id, second.hash)).length).toBe(1);
      expect((await setHash(first.id, "a".repeat(64))).length).toBe(1);
      await expect(
        repairLegacyCrlfMigrationReceipts(database.connectionString, { backupConfirmed: true }),
      ).rejects.toThrow(/match neither/);

      // The exact CRLF pair repairs to the canonical hash and restores inspection.
      expect((await setHash(first.id, crlf)).length).toBe(1);
      await expect(repairLegacyCrlfMigrationReceipts(database.connectionString, { backupConfirmed: true })).resolves.toEqual({
        repairedMigrations: [file],
        canonicalMigrations: total,
      });
      const repaired = await sql`SELECT hash FROM drizzle.__drizzle_migrations WHERE id = ${first.id}`;
      expect(repaired[0].hash).toBe(canonical);
      await expect(inspectMigrations(database.connectionString)).resolves.toMatchObject({ status: "upToDate" });

      // A second run reports nothing to repair and changes nothing.
      await expect(repairLegacyCrlfMigrationReceipts(database.connectionString, { backupConfirmed: true })).resolves.toEqual({
        repairedMigrations: [],
        canonicalMigrations: total,
      });
    } finally {
      await sql.end();
      await database.cleanup();
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
