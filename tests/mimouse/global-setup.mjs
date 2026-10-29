import { startFixtureServer } from "./fixture-lifecycle.mjs";

export default async function globalSetup() {
  // Playwright calls the returned teardown after test workers exit. Both the
  // HTTP child and PostgreSQL belong to this one marked fixture, never to the
  // webServer plugin's Windows force-kill process tree.
  return startFixtureServer();
}
