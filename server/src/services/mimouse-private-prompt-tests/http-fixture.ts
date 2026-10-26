import { createServer, request } from "node:http";
import express from "express";
import type { Db } from "@paperclipai/db";
import { mimousePromptRegistryRoutes } from "../../routes/mimouse-prompt-registry.js";
import { errorHandler } from "../../middleware/error-handler.js";

/** Real loopback HTTP/router/middleware boundary. Actor injection is fixture-only:
 * this does not authenticate an OIDC cookie or claim to test production login. */
export async function privatePromptHttpFixture(db: Db, actors: Record<string, Express.Request["actor"]>) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.actor = actors[String(req.headers["x-fixture-actor"])] ?? { type: "none", source: "none" }; next(); });
  app.use("/api", mimousePromptRegistryRoutes(db)); app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") throw Error("Fixture must bind loopback only");
  return {
    async call(method: "GET" | "POST", path: string, body?: unknown, actor = "owner") {
      if (!path.startsWith("/api/companies/")) throw Error("Fixture API path required");
      const data = body === undefined ? undefined : JSON.stringify(body);
      return new Promise<{ status: number; headers: Record<string, unknown>; body: any }>((accept, reject) => {
        const req = request({ hostname: "127.0.0.1", port: address.port, method, path, agent: false,
          headers: { "x-fixture-actor": actor, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, res => {
          let text = ""; res.setEncoding("utf8"); res.on("data", chunk => { text += chunk; });
          res.on("end", () => { try { accept({ status: res.statusCode!, headers: res.headers, body: JSON.parse(text) }); } catch (error) { reject(error); } });
        });
        req.setTimeout(30000, () => req.destroy(Error("Fixture HTTP timeout"))); req.on("error", reject); req.end(data);
      });
    },
    async close() { await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); },
  };
}
