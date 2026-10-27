// @vitest-environment jsdom
import { ApiUnavailableError } from "@/api/response";
import { apiErrorMessages } from "@/i18n/api-errors-test-resources";
import { i18n } from "@/i18n";
import { apiUnavailableUiMessage } from "@/i18n/api-errors";
import { useToastState } from "../context/ToastContext";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToastActions, type ToastInput } from "../context/ToastContext";
import { ToastViewport } from "./ToastViewport";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
vi.stubGlobal("cancelAnimationFrame", clearTimeout);
function Notify({ toast }: { toast: ToastInput }) {
  const { pushToast } = useToastActions();
  useEffect(() => { pushToast(toast); }, [pushToast, toast]);
  return <ToastViewport />;
}
describe("notification avatars", () => {
  it.each(["user", "agent"] as const)("carries the %s identity through the provider to the viewport", (type) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() => root.render(<ToastProvider><Notify toast={{ title: "Alex Example created a task", actor: { type, id: "actor-1", name: "Alex Example" } }} /></ToastProvider>));
      expect(container.textContent).toContain("Alex Example created a task");
      if (type === "user") expect(container.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe("AE");
      else expect(container.querySelector('[data-slot="agent-avatar"] img')?.getAttribute("src")).toContain("/api/agent-avatars/");
    } finally { act(() => root.unmount()); }
  });
  it("hot-switches a typed body without changing original state, dedupe or expiry", async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage("en");
    const container = document.createElement("div"), root = createRoot(container);
    const error = new ApiUnavailableError(503);
    const input: ToastInput = { id: "local", title: "Original title", body: error.message, bodyMessage: apiUnavailableUiMessage(error), ttlMs: 5000 };
    let observed: ReturnType<typeof useToastState> = [], push: ReturnType<typeof useToastActions>["pushToast"] | undefined;
    function Probe() { observed = useToastState(); push = useToastActions().pushToast; return <ToastViewport />; }
    try {
      await act(async () => root.render(<ToastProvider><Probe /></ToastProvider>));
      await act(async () => { push!(input); });
      const createdAt = observed[0].createdAt;
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      for (const [locale, messages] of Object.entries(apiErrorMessages)) {
        await act(async () => { await i18n.changeLanguage(locale); });
        expect(container.textContent).toContain(messages.unavailable);
        expect(observed[0]).toMatchObject({ title: input.title, body: error.message, ttlMs: 5000, createdAt });
      }
      // Descriptor metadata does not participate in existing raw-body deduplication.
      await act(async () => { expect(push!({ ...input, bodyMessage: undefined })).toBeNull(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
      expect(observed).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(observed).toHaveLength(0);
      await act(async () => { push!({ id: "server", title: "Server", body: error.message, ttlMs: 5000 }); });
      for (const locale of Object.keys(apiErrorMessages)) {
        await act(async () => { await i18n.changeLanguage(locale); });
        expect(container.textContent).toContain(error.message);
      }
    } finally { await act(async () => root.unmount()); vi.useRealTimers(); await i18n.changeLanguage("en"); }
  });

});
