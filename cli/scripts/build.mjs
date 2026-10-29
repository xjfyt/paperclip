import { chmodSync } from "node:fs";
import esbuild from "esbuild";
import config from "../esbuild.config.mjs";

await esbuild.build(config);
chmodSync(new URL("../dist/index.js", import.meta.url), 0o755);
