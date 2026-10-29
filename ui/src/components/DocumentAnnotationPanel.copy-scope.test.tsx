// @vitest-environment jsdom
import "@/i18n/annotation-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { useCopyAnnotationLink } from "./DocumentAnnotationPanel";
const mock = vi.hoisted(() => ({ copy: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mock.copy }));
vi.mock("@/context/ToastContext", () => ({ useOptionalToastActions: () => ({ pushToast: mock.push }) }));
afterEach(async () => { vi.resetAllMocks(); await i18n.changeLanguage("en"); });
it.each(["success", "failure"])("ignores a late clipboard %s after the document source changes", async outcome => {
  let finish!: () => void;
  mock.copy.mockReturnValue(new Promise<void>((resolve, reject) => { finish = () => outcome === "success" ? resolve() : reject(new Error("raw clipboard failure")); }));
  const host = document.createElement("div"); const root = createRoot(host);
  function Button({ scope }: { scope: string }) { const copy = useCopyAnnotationLink(scope); return <button onClick={() => copy("plan", "thread")}>copy</button>; }
  try {
    await act(async () => root.render(<Button scope="first-source" />));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => root.render(<Button scope="second-source" />));
    await act(async () => finish()); expect(mock.push).not.toHaveBeenCalled();
    mock.copy.mockResolvedValue(undefined);
    await act(async () => { await i18n.changeLanguage("ja"); host.querySelector('button')!.click(); });
    expect(mock.push).toHaveBeenCalledWith(expect.objectContaining({ title: "リンクをコピーしました", tone: "success" }));
  } finally { await act(async () => root.unmount()); }
});
