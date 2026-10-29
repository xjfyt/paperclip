import { cpSync } from "node:fs";

for (const [source, destination] of [
  ["../src/onboarding-assets/", "../dist/onboarding-assets/"],
  ["../src/built-ins/", "../dist/built-ins/"],
  ["../src/services/scripts/", "../dist/services/scripts/"],
  ["../../packages/paperclip-runner/dist/", "../dist/vendor/paperclip-runner/"],
]) {
  cpSync(new URL(source, import.meta.url), new URL(destination, import.meta.url), {
    recursive: true,
    force: true,
  });
}
