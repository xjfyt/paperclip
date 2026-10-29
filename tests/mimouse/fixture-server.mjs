import { pathToFileURL } from "node:url";
import path from "node:path";

// The harness owns the PostgreSQL process. This child only owns the HTTP app,
// and uses its public programmatic shutdown instead of Windows signal killing.
if (!process.send || !process.env.PAPERCLIP_MIMOUSE_TEST_HOME) throw Error("Fixture IPC and isolated home required");
let running;
let closing;
async function close() {
  closing ??= (async () => {
    await running?.shutdown("SIGTERM");
    process.exit(0);
  })();
  return closing;
}
process.on("message", message => {
  if (message?.type === "mimouse-fixture-shutdown") void close().catch(error => { console.error(error); process.exit(1); });
});
process.on("disconnect", () => { void close().catch(error => { console.error(error); process.exit(1); }); });
try {
  const entry = process.env.PAPERCLIP_MIMOUSE_TEST_COMPILED === "true" ? "dist/index.js" : "src/index.ts";
  const { startServer } = await import(pathToFileURL(path.resolve(process.cwd(), entry)).href);
  running = await startServer();
  process.send({ type: "mimouse-fixture-ready", pid: process.pid, port: running.listenPort });
} catch (error) {
  console.error(error);
  process.exit(1);
}
