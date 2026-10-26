/**
 * Resolve from @paperclipai/db, which publishes the qualified, patched wrapper
 * as a bundled dependency. Importing from a server/CLI caller can select an
 * unrelated hoisted, unpatched copy instead. Callers retain lifecycle ownership
 * and may wrap this lazy load in their coordinated shutdown-hook guard.
 */
export function loadEmbeddedPostgres() {
  return import("embedded-postgres");
}
