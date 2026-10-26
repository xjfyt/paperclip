// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IssueRetryNowOutcome, IssueScheduledRetry } from "@paperclipai/shared";
import { IssueScheduledRetryCard } from "./IssueScheduledRetryCard";
import { ToastProvider, useToastState } from "../context/ToastContext";

import { i18n } from "../i18n";
import { issueRetryMessages } from "../i18n/issue-retry-test-resources";
import { ApiError } from "../api/client";
import { useRetryNowMutation } from "../hooks/useRetryNowMutation";

const retryNowMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string } & ComponentProps<"a">) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    retryScheduledRetryNow: retryNowMock,
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

const SYSTEM_NOW = new Date("2026-04-18T20:00:00.000Z").getTime();

const baseRetry: IssueScheduledRetry = {
  runId: "run-00000000",
  status: "scheduled_retry",
  agentId: "agent-1",
  agentName: "ClaudeCoder",
  retryOfRunId: "run-prev-1234567",
  scheduledRetryAt: "2026-04-18T20:15:00.000Z",
  scheduledRetryAttempt: 4,
  scheduledRetryReason: "transient_failure",
  retryExhaustedReason: null,
  error: "Upstream provider rate limited",
  errorCode: "rate_limited",
};

function buildRetryResponse(outcome: IssueRetryNowOutcome) {
  return {
    outcome,
    message:
      outcome === "promoted"
        ? "Promoted scheduled retry"
        : outcome === "already_promoted"
          ? "Scheduled retry already promoted"
          : outcome === "no_scheduled_retry"
            ? "No scheduled retry"
            : "Promotion suppressed by gate",
    scheduledRetry:
      outcome === "promoted" || outcome === "already_promoted"
        ? { ...baseRetry, status: "queued" as const }
        : null,
  };
}

async function waitForUi(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    assertion();
  });
}

async function waitForRetryButtonText(expected: string) {
  for (let i = 0; i < 20; i += 1) {
    if ((getRetryNowButton()?.textContent ?? "").includes(expected)) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(getRetryNowButton()!.textContent ?? "").toContain(expected);
}

function ToastProbe() {
  return <output data-testid="toast-probe">{JSON.stringify(useToastState())}</output>;
}

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{ui}<ToastProbe /></ToastProvider>
      </QueryClientProvider>,
    );
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(SYSTEM_NOW);
  retryNowMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dateNowSpy?.mockRestore();
});

function getCard() {
  return container.querySelector('[data-testid="issue-scheduled-retry-card"]');
}

function getRetryNowButton() {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="issue-scheduled-retry-card-retry-now"]',
  );
}

describe("IssueScheduledRetryCard", () => {
  it("shows workspace contention as an automatic wait without failure or retry controls", () => {
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={{ ...baseRetry, scheduledRetryReason: "workspace_busy" }} />);
    expect(container.textContent).toContain("Waiting for workspace");
    expect(container.textContent).toContain("Work starts automatically");
    expect(container.textContent).not.toMatch(/failed|Retry|Attempt|Replaces run/);
    expect(getRetryNowButton()).toBeNull();
  });
  it("surfaces model capacity and the automatic retry without a generic failure", () => {
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={{ ...baseRetry, scheduledRetryAttempt: 1, scheduledRetryReason: "native_provider_overloaded",
      error: "Selected model is at capacity. Please try a different model.", errorCode: "native_provider_overloaded" }} />);
    expect(container.textContent).toContain("Model at capacity");
    expect(container.textContent).toContain("Selected model is at capacity");
    expect(container.textContent).toContain("Paperclip will retry automatically");
    expect(container.textContent).not.toContain("Native session failed");
  });

  it("renders nothing when there is no scheduled retry", () => {
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={null} />);
    expect(getCard()).toBeNull();
  });

  it("renders nothing when status is not scheduled_retry", () => {
    renderWithProviders(
      <IssueScheduledRetryCard
        issueId="issue-1"
        scheduledRetry={{ ...baseRetry, status: "queued" }}
      />,
    );
    expect(getCard()).toBeNull();
  });

  it("shows attempt count, reason, absolute and relative timestamps", () => {
    renderWithProviders(
      <IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />,
    );
    const card = getCard();
    expect(card).not.toBeNull();
    const text = card!.textContent ?? "";
    expect(text).toContain("Retry scheduled");
    expect(text).toContain("Attempt 4");
    expect(text).toContain("Transient failure");
    expect(text).toContain("Automatic retry in 15m");
    expect(text).toContain("run-prev");
  });

  it("uses continuation copy for max-turn continuations", () => {
    renderWithProviders(
      <IssueScheduledRetryCard
        issueId="issue-1"
        scheduledRetry={{ ...baseRetry, scheduledRetryReason: "max_turns_continuation" }}
      />,
    );
    const text = getCard()?.textContent ?? "";
    expect(text).toContain("Continuation scheduled");
    expect(text).toContain("Automatic continuation");
    expect(text).toContain("Pulls continuation forward immediately");
  });

  it("uses 'due now' label when scheduledRetryAt is at the current time", () => {
    renderWithProviders(
      <IssueScheduledRetryCard
        issueId="issue-1"
        scheduledRetry={{ ...baseRetry, scheduledRetryAt: "2026-04-18T20:00:10.000Z" }}
      />,
    );
    const text = getCard()?.textContent ?? "";
    expect(text).toContain("Automatic retry due now");
  });

  it("invokes retry-now and shows promoted state on success", async () => {
    retryNowMock.mockResolvedValue(buildRetryResponse("promoted"));
    renderWithProviders(
      <IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />,
    );
    const button = getRetryNowButton();
    expect(button).not.toBeNull();

    act(() => {
      button!.click();
    });
    await waitForRetryButtonText("Promoted");
    expect(retryNowMock).toHaveBeenCalledWith("issue-1");
    const finalButton = getRetryNowButton();
    expect(finalButton!.textContent ?? "").toContain("Promoted");
    expect(finalButton!.disabled).toBe(true);
  });

  it("shows already promoted state when backend reports duplicate click", async () => {
    retryNowMock.mockResolvedValue(buildRetryResponse("already_promoted"));
    renderWithProviders(
      <IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />,
    );
    act(() => {
      getRetryNowButton()!.click();
    });
    await waitForRetryButtonText("Already promoted");
    expect(getRetryNowButton()!.textContent ?? "").toContain("Already promoted");
    expect(container.querySelector('[data-testid="issue-scheduled-retry-error-band"]')).toBeNull();
  });

  it("shows cleanup waiting without claiming success or disabling Retry now", async () => {
    const message = "Waiting for execution cleanup. Paperclip will retry automatically once cleanup finishes.";
    retryNowMock.mockResolvedValue({ outcome: "waiting", message, scheduledRetry: baseRetry });
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />);
    act(() => { getRetryNowButton()!.click(); });
    await waitForUi(() => {
      expect(getCard()?.textContent).toContain(message);
      expect(getCard()?.textContent).not.toContain("run starting");
      expect(getRetryNowButton()!.disabled).toBe(false);
      expect(container.querySelector('[data-testid="issue-scheduled-retry-error-band"]')).toBeNull();
    });
  });

  it("renders an inline error band on backend failure", async () => {
    retryNowMock.mockRejectedValue(new Error("Server error"));
    renderWithProviders(
      <IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />,
    );
    act(() => {
      getRetryNowButton()!.click();
    });
    await waitForUi(() => {
      const band = container.querySelector('[data-testid="issue-scheduled-retry-error-band"]');
      expect(band).not.toBeNull();
      expect((band?.textContent ?? "")).toContain("Server error");
      expect(getRetryNowButton()!.disabled).toBe(false);
    });
  });

  it("surfaces gate-suppressed outcome via the inline error band", async () => {
    retryNowMock.mockResolvedValue(buildRetryResponse("gate_suppressed"));
    renderWithProviders(
      <IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />,
    );
    act(() => {
      getRetryNowButton()!.click();
    });
    await waitForUi(() => {
      const band = container.querySelector('[data-testid="issue-scheduled-retry-error-band"]');
      expect(band).not.toBeNull();
      expect((band?.textContent ?? "")).toContain("Promotion suppressed");
      expect(getRetryNowButton()!.disabled).toBe(false);
    });
  });
});


describe("scheduled retry four-language controls", () => {
  it.each(Object.entries(issueRetryMessages))("keeps pending, duplicate and promoted semantics in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    let resolve!: (value: ReturnType<typeof buildRetryResponse>) => void;
    retryNowMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />);
    const text = getCard()!.textContent;
    expect(text).toContain(messages.retryScheduled);
    expect(text).toContain(messages.transient_failure);
    expect(text).toContain(messages.attempt.replace("{{attempt}}", "4"));
    expect(text).toContain(messages.lastAttemptFailed);
    expect(text).toContain(baseRetry.error);
    expect(text).toContain(messages.automaticRetryNote);
    expect(container.querySelector('a[href="/agents/agent-1/runs/run-prev-1234567"]')).not.toBeNull();
    act(() => getRetryNowButton()!.click());
    await waitForRetryButtonText(messages.retrying);
    expect(getRetryNowButton()!.disabled).toBe(true);
    act(() => getRetryNowButton()!.click());
    expect(retryNowMock).toHaveBeenCalledTimes(1);
    expect(retryNowMock).toHaveBeenCalledWith("issue-1");
    await act(async () => resolve(buildRetryResponse("promoted")));
    await waitForRetryButtonText(messages.promoted);
    expect(getRetryNowButton()!.disabled).toBe(true);
    expect(getCard()!.textContent).toContain(messages.promotedStarting);
    expect(container.querySelector('[data-testid="toast-probe"]')!.textContent).toContain(messages.retryPromoted);
    expect(container.querySelector('[data-testid="toast-probe"]')!.textContent).toContain("Promoted scheduled retry");
  });

  it.each(Object.entries(issueRetryMessages))("refreshes fallback errors without re-requesting and preserves server diagnostics in %s", async (locale, messages) => {
    retryNowMock.mockRejectedValueOnce({ diagnostic: "opaque" });
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />);
    act(() => getRetryNowButton()!.click());
    await waitForUi(() => expect(getCard()!.textContent).toContain(issueRetryMessages.en.requestFailed));
    await act(async () => { await i18n.changeLanguage(locale); });
    const band = container.querySelector('[data-testid="issue-scheduled-retry-error-band"]')!;
    expect(band.textContent).toContain(messages.couldNotRetry);
    expect(band.textContent).toContain(messages.requestFailed);
    expect(band.querySelector("button")!.textContent).toBe(messages.tryAgain);
    expect(retryNowMock).toHaveBeenCalledTimes(1);
    // A server Error matching a client fallback's English text is still server text.
    retryNowMock.mockRejectedValueOnce(new Error("Missing issue id"));
    act(() => band.querySelector<HTMLButtonElement>("button")!.click());
    await waitForUi(() => expect(band.textContent).toContain("Missing issue id"));
    expect(retryNowMock).toHaveBeenCalledTimes(2);
    expect(getRetryNowButton()!.disabled).toBe(false);
  });

  it.each(Object.entries(issueRetryMessages))("localizes empty API errors and leaves gate/waiting text untouched in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    retryNowMock.mockRejectedValueOnce(new ApiError("", 503, null));
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={baseRetry} />);
    act(() => getRetryNowButton()!.click());
    await waitForUi(() => expect(getCard()!.textContent).toContain(messages.requestFailedStatus.replace("{{status}}", "503")));
    const raw = "Provider says 原样: gate_suppressed";
    retryNowMock.mockResolvedValueOnce({ outcome: "gate_suppressed", message: raw, scheduledRetry: baseRetry });
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="issue-scheduled-retry-error-band"] button')!.click());
    await waitForUi(() => expect(getCard()!.textContent).toContain(raw));
    retryNowMock.mockResolvedValueOnce({ outcome: "waiting", message: raw + " waiting", scheduledRetry: baseRetry });
    act(() => getRetryNowButton()!.click());
    await waitForUi(() => {
      expect(getCard()!.textContent).toContain(raw + " waiting");
      expect(container.querySelector('[data-testid="issue-scheduled-retry-error-band"]')).toBeNull();
      expect(getRetryNowButton()!.disabled).toBe(false);
    });
    expect(retryNowMock).toHaveBeenCalledTimes(3);
  });

  it("switches the same mounted continuation through all four languages with original reason and timestamps", async () => {
    const retry = { ...baseRetry, scheduledRetryReason: "max_turns_continuation", scheduledRetryAt: null };
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={retry} />);
    const card = getCard();
    for (const [locale, messages] of Object.entries(issueRetryMessages)) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(getCard()).toBe(card);
      expect(card!.textContent).toContain(messages.continuationScheduled);
      expect(card!.textContent).toContain(messages.automaticContinuation.replace("{{when}}", messages.pendingScheduleLower));
      expect(card!.textContent).toContain(messages.pullContinuation);
      expect(card!.textContent).toContain(messages.max_turns_continuation);
    }
    expect(retry.scheduledRetryReason).toBe("max_turns_continuation");
    expect(retryNowMock).not.toHaveBeenCalled();
  });

  it.each(Object.entries(issueRetryMessages))("keeps workspace waits control-free and unknown reasons verbatim in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={{ ...baseRetry, scheduledRetryReason: "workspace_busy" }} />);
    expect(container.textContent).toContain(messages.waitingWorkspace);
    expect(container.textContent).toContain(messages.waitingWorkspaceBody);
    expect(getRetryNowButton()).toBeNull();
    renderWithProviders(<IssueScheduledRetryCard issueId="issue-1" scheduledRetry={{ ...baseRetry, scheduledRetryReason: "future_reason 原文", error: "Original error 原文" }} />);
    expect(getCard()!.textContent).toContain("future_reason 原文");
    expect(getCard()!.textContent).toContain("Original error 原文");
    expect(retryNowMock).not.toHaveBeenCalled();
  });

  it.each(Object.entries(issueRetryMessages))("translates only the locally generated missing ID error in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    function MissingIdProbe() {
      const mutation = useRetryNowMutation(null);
      return <><button data-testid="missing-id" onClick={() => mutation.mutate()}>request</button><output>{mutation.lastError?.message}</output></>;
    }
    renderWithProviders(<MissingIdProbe />);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="missing-id"]')!.click());
    await waitForUi(() => expect(container.textContent).toContain(messages.missingIssueId));
    expect(container.textContent).toContain(messages.couldNotRetry);
    expect(retryNowMock).not.toHaveBeenCalled();
  });
});
