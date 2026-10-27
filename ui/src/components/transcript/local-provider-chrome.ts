import type { TranscriptEntry } from "@/adapters";
type ProviderEntry = Extract<TranscriptEntry, { kind: "provider_activity" }>;
const titleKeys = {
  plan: "providerChromeUi.plan", tool_execution: "providerChromeUi.tool", research: "providerChromeUi.research",
  delegation: "providerChromeUi.delegation", model_identity: "providerChromeUi.model", context: "providerChromeUi.context",
  artifact: "providerChromeUi.artifact", review: "providerChromeUi.review", hook: "providerChromeUi.hook",
  memory: "providerChromeUi.memory", safety: "providerChromeUi.safety", terminal: "providerChromeUi.terminal",
  wait: "providerChromeUi.wait", provider_notice: "providerChromeUi.notice",
} satisfies Record<ProviderEntry["family"], string>;
// UI projection provenance only. Never trust a title string or a flag supplied in
// provider payloads. Weak keys neither alter raw entries nor retain old runs.
// A copied/serialized entry loses provenance and safely keeps its original text.
const localChrome = new WeakMap<ProviderEntry, { titleKey: string; summaryKey?: string }>();
export function markLocalProviderChrome<T extends ProviderEntry>(entry: T, localSummary = false): T {
  const titleKey = titleKeys[entry.family];
  localChrome.set(entry, { titleKey, ...(localSummary ? { summaryKey: titleKey } : {}) });
  return entry;
}
export function localProviderChrome(entry: ProviderEntry) { return localChrome.get(entry); }
