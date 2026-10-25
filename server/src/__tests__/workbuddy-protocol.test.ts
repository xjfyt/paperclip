import { describe, expect, it, vi } from "vitest";
import { authorizationUrl, parseToken, runWorkBuddyAcp, trustedAcpUrl, WorkBuddySseParser, workBuddyClient } from "../services/workbuddy/protocol.js";
describe("WorkBuddy official protocol", () => {
  it("requests only cloud-task scopes and preserves opaque state", () => {
    const url = new URL(authorizationUrl("client", "https://app.example/callback", "random-state"));
    expect(url.hostname).toBe("www.workbuddy.cn"); expect(url.searchParams.get("scope")).toBe("user.task.readable user.task.invokable"); expect(url.searchParams.get("state")).toBe("random-state");
  });
  it("uses token response expiry, never a documentation example lifetime", () => {
    expect(parseToken({ access_token: "a", token_type: "Bearer", expires_in: 17, scope: "user.task.readable", open_id: "user" }).expires_in).toBe(17);
    expect(() => parseToken({ access_token: "a", expires_in: 0 })).toThrow();
  });
  it.each(["http://acp.workbuddy.cn/task", "https://evil.example/task", "https://acp.workbuddy.cn:999/task", "https://user:pass@acp.workbuddy.cn/task"])("does not send ACP credentials to %s", url => expect(() => trustedAcpUrl(url)).toThrow());
  it("reassembles fragmented UTF-8 SSE without treating disconnect as completion", () => {
    const parser = new WorkBuddySseParser(); const bytes = new TextEncoder().encode('data: {"text":"中文"}\r\n\r\n'); const received: unknown[] = [];
    for (const byte of bytes) received.push(...parser.push(new Uint8Array([byte])));
    expect(received).toEqual([{ text: "中文" }]);
  });
  it("does not retry uncertain task creation", async () => {
    const transport = vi.fn().mockRejectedValue(Error("timeout"));
    await expect(workBuddyClient(transport).create("fixture", "report")).rejects.toMatchObject({ code: "transport_unconfirmed", uncertain: true }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("uses form-encoded OAuth exchange and real task ids", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ access_token: "a", token_type: "Bearer", expires_in: 123, scope: "user.task.readable", open_id: "u" }));
    await workBuddyClient(transport).exchange({ grant_type: "authorization_code", code: "fixture", redirect_uri: "https://app.example/callback" });
    expect(transport.mock.calls[0][1].body).toBeInstanceOf(URLSearchParams);
  });
  it("runs initialize/load/prompt, denies permission and keeps round separate from business success", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    const events: string[] = []; const text: string[] = []; const requests: any[] = [];
    const send = (data: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
    const transport = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response(body, { headers: { "content-type": "text/event-stream", "Acp-Connection-Id": "connection" } });
      expect((init.headers as Record<string, string>)["Acp-Connection-Id"]).toBe("connection");
      const request = JSON.parse(String(init.body)); requests.push(request);
      if (request.method) {
        events.push(request.method);
        if (request.method === "session/prompt") {
          expect(events).toContain("persisted-prompt");
          send({ jsonrpc: "2.0", id: "permission", method: "session/request_permission", params: { sessionId: "task" } });
          send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "task", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "报告" } } } });
        }
        send({ jsonrpc: "2.0", id: request.id, result: request.method === "session/prompt" ? { stopReason: "end_turn" } : {} });
      }
      return new Response(null, { status: 202 });
    });
    const result = await runWorkBuddyAcp({ link: "https://acp.workbuddy.cn/sessions/task", token: "fixture", taskId: "task", prompt: "Research", beforePrompt: async () => { events.push("persisted-prompt"); }, onText: async value => { text.push(value); } }, transport);
    expect(events).toEqual(["initialize", "session/load", "persisted-prompt", "session/prompt"]);
    expect(result).toEqual({ stopReason: "end_turn", permissionDenied: true, businessCompleted: false });
    expect(requests.find(item => item.id === "permission").result.outcome.outcome).toBe("cancelled"); expect(text).toEqual(["报告"]);
  });
});

import { fetchWorkBuddyReport } from "../services/workbuddy/protocol.js";
describe("WorkBuddy read-only report recovery", () => {
  it("uses the overview API without replaying a prompt or leaking the ticket", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { sessionId: "task", artifacts: [{ sessionId: "task", event: "created", artifact: { type: "overview", uri: "agent:///artifacts/report.md", text: "报告 ticket-secret", updatedAt: 1 } }], pagination: { hasMore: false } } }));
    const result = await fetchWorkBuddyReport({ link: "https://sandbox.example/acp", token: "ticket-secret", taskId: "task", allowedHosts: ["sandbox.example"] }, transport);
    expect(result).toEqual({ report: "报告 [REDACTED]", artifactRefs: ["agent:///artifacts/report.md"] });
    const [url, options] = transport.mock.calls[0]; expect(url.pathname).toBe("/api/session/artifacts"); expect(url.searchParams.get("sessionId")).toBe("task"); expect(options.method).toBeUndefined(); expect(options.redirect).toBe("error");
  });
  it("does not guess an artifact endpoint for gateway session URLs", async () => {
    const transport = vi.fn(); await expect(fetchWorkBuddyReport({ link: "https://acp.workbuddy.cn/sessions/task", token: "ticket", taskId: "task" }, transport)).rejects.toMatchObject({ code: "artifact_endpoint_unverified" }); expect(transport).not.toHaveBeenCalled();
  });
  it("rejects cross-session records and unbounded pagination", async () => {
    const input = { link: "https://sandbox.example/acp", token: "ticket", taskId: "task", allowedHosts: ["sandbox.example"] };
    await expect(fetchWorkBuddyReport(input, vi.fn().mockResolvedValue(Response.json({ code: 0, data: { sessionId: "other", artifacts: [] } })))).rejects.toThrow("artifact_identity");
    const transport = vi.fn().mockImplementation(async () => Response.json({ code: 0, data: { sessionId: "task", artifacts: [], pagination: { hasMore: true } } }));
    await expect(fetchWorkBuddyReport(input, transport)).rejects.toThrow("pagination_budget"); expect(transport).toHaveBeenCalledTimes(10);
  });
});
