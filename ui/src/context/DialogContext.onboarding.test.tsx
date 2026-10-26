// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DialogProvider, useDialog } from "./DialogContext";
import { isOnboardingWizardActive } from "../lib/onboarding-route";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const dialog = useDialog();
  const active = isOnboardingWizardActive({ onboardingOpen: dialog.onboardingOpen, routeDismissed: dialog.onboardingRouteDismissed });
  return <><output>{active ? "open" : "closed"}</output><button onClick={() => dialog.openOnboarding({ companyId: "c1", initialStep: 3 })}>Configure</button><button onClick={dialog.closeOnboarding}>Close</button></>;
}

describe("onboarding requires an explicit action", () => {
  it("starts closed, supports close/reopen, and is closed again after a fresh provider mount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<DialogProvider><Harness /></DialogProvider>));
      expect(container.querySelector("output")?.textContent).toBe("closed");
      for (let attempt = 0; attempt < 2; attempt++) {
        await act(async () => (container.querySelectorAll("button")[0] as HTMLButtonElement).click());
        expect(container.querySelector("output")?.textContent).toBe("open");
        await act(async () => (container.querySelectorAll("button")[1] as HTMLButtonElement).click());
        expect(container.querySelector("output")?.textContent).toBe("closed");
      }
      await act(async () => root.render(<DialogProvider key="reload"><Harness /></DialogProvider>));
      expect(container.querySelector("output")?.textContent).toBe("closed");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
