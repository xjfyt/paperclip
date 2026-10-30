import { repairLegacyCrlfMigrationReceipts } from "./client.js";
import { resolveMigrationConnection } from "./migration-runtime.js";

const backupConfirmed = process.argv.includes("--confirm-backup");

if (!backupConfirmed) {
  console.error(
    "用法：pnpm --filter @paperclipai/db repair-line-endings --confirm-backup\n" +
      "请先备份数据库。该命令只把与当前 SQL 精确对应的旧 CRLF 迁移回执改写为规范 LF 哈希，不改 SQL、journal 或数据。",
  );
  process.exit(2);
}

const connection = await resolveMigrationConnection();
try {
  const result = await repairLegacyCrlfMigrationReceipts(connection.connectionString, {
    backupConfirmed: true,
  });
  console.log(JSON.stringify({ source: connection.source, ...result }, null, 2));
} finally {
  await connection.stop();
}
