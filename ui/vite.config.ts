import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch.ts";
import { createApiProxy } from "./src/lib/vite-api-proxy.ts";
import { serviceWorkerBuildIdPlugin } from "./src/lib/vite-sw-build-id.ts";
import { readBrowserBuildCommit } from "./src/lib/vite-build-commit.ts";
import { productionChunkBudgetPlugin, REVIEWED_PARSER_CHUNK_BUDGET_BYTES } from "./src/lib/vite-chunk-budget.ts";

const apiProxy = createApiProxy();

export default defineConfig(({ mode }) => ({
  define: {
    __PAPERCLIP_BUILD_COMMIT__: JSON.stringify(
      readBrowserBuildCommit(import.meta.dirname),
    ),
  },
  plugins: [react(), tailwindcss(), serviceWorkerBuildIdPlugin(), productionChunkBudgetPlugin()],
  build: {
    minify: "oxc",
    // The plugin enforces 500 kB as a hard error for every other chunk; this
    // reporter limit only avoids a duplicate warning for its hash-bound parser.
    chunkSizeWarningLimit: REVIEWED_PARSER_CHUNK_BUDGET_BYTES / 1000,
    rolldownOptions: {
      output: {
        // Preserve React component names for production error traces.
        keepNames: true,
        minify: mode === "production" ? { compress: { dropConsole: true, dropDebugger: true } } : true,
        comments: false,
        strictExecutionOrder: true,
        codeSplitting: {
          // Split actual modules into cacheable chunks instead of raising the
          // bundle-size warning threshold. Large single modules stay visible.
          maxSize: 450 * 1024,
          includeDependenciesRecursively: false,
          groups: [
            { name: "mermaid-parser-core", priority: 20,
              test: /[/\\]@mermaid-js[/\\]parser[/\\]dist[/\\]chunks[/\\]mermaid-parser\.core[/\\]chunk-FOHPRMQF\.mjs$/ },
            { name: "initial-vendor", test: /[/\\]node_modules[/\\]/, tags: ["$initial"], priority: 10 },
            { name: "initial-app", test: id => !id.includes("node_modules"), tags: ["$initial"], priority: 10 },
            { name: id => {
              const name = id.replaceAll("\\", "/").split("/node_modules/").at(-1)!;
              return "vendor-" + (name.startsWith("@") ? name.split("/").slice(0, 2).join("-") : name.split("/")[0]).replaceAll("@", "");
            }, test: /[/\\]node_modules[/\\]/ },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      lexical: path.resolve(import.meta.dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: apiProxy,
  },
  preview: {
    port: 3101,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
  },
}));
