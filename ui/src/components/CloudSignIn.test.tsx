// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CloudSignIn } from "./CloudSignIn";
const handoff = vi.hoisted(() => ({ begin: vi.fn(() => false), clear: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/cloud-sign-in", () => ({ beginCloudSignIn: handoff.begin, clearCloudSignInAttempt: handoff.clear }));
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel: handoff.navigate }));
vi.mock("@/components/AnimatedPaperclipIcon", () => ({ PaperclipLoading: () => <div>Loading</div> }));
const cloud = { managed: true as const, managedBy: "paperclip-cloud" as const, stackSlug: "demo", cloudBaseUrl: "https://cloud.test" };
let root: Root | undefined, host: HTMLDivElement;
async function renderCloud() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<CloudSignIn cloud={cloud} returnTo="/dashboard" />); });
  return host.querySelector("a")!;
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.clearAllMocks(); });
it("uses the guarded handoff for ordinary manual retry", async () => {
  const link = await renderCloud();
  expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
  expect(handoff.clear).toHaveBeenCalledTimes(1);
  expect(handoff.navigate).toHaveBeenCalledExactlyOnceWith(link.getAttribute("href"));
});
it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])("leaves %s modified links to browser behavior", async key => {
  const link = await renderCloud();
  // Observe the component's cancellation before suppressing jsdom's navigation.
  let componentPrevented = true;
  const listener = (event: MouseEvent) => { componentPrevented = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener("click", listener);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [key]: true }));
  document.removeEventListener("click", listener);
  expect(componentPrevented).toBe(false);
  expect(handoff.navigate).not.toHaveBeenCalled();
});
