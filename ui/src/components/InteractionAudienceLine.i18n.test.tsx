// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { InteractionAudienceLine } from "./InteractionAudienceLine";
import { displayResolverAudience, displayAttentionResolverAudience, type InteractionAudienceDisplaySource } from "@/i18n/interaction-audience-display";
import { describeResolverAudience, describeAttentionResolverAudience, type InteractionAudienceFacts } from "@/lib/interaction-audience";
import { i18n, interactionAudienceMessages as messages } from "@/i18n/interaction-audience-test-resources";
import { taskThreadFeedbackMessages as short } from "@/i18n/task-thread-feedback-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import type { AttentionResolverAudience } from "@paperclipai/shared";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const base: InteractionAudienceFacts = { effectiveResolverPolicy: "anyone", requestedResolverPolicy: "anyone", effectiveResolverPolicySource: "requested", resolverPolicyProvenance: "inherited", hasAddressee: false };
const variants: Array<{ name: string; source: InteractionAudienceDisplaySource; summary: keyof Omit<typeof messages.en, "policies"> }> = [
  { name: "open", source: { facts: base }, summary: "anyone" },
  { name: "creator", source: { facts: { ...base, effectiveResolverPolicy: "not_creator", requestedResolverPolicy: "not_creator" }, creatorLabel: "Raw creator 原文" }, summary: "exceptCreator" },
  { name: "agent", source: { facts: { ...base, hasAddressee: true }, addresseeLabel: "Raw addressee 原文" }, summary: "addresseeOrBoard" },
  { name: "user", source: { facts: { ...base, hasAddressee: true, isUserAddressee: true }, addresseeLabel: "Raw addressee 原文" }, summary: "onlyAddressee" },
  { name: "human", source: { facts: { ...base, effectiveResolverPolicy: "human_only", requestedResolverPolicy: "human_only" } }, summary: "boardOnly" },
  { name: "human-agent", source: { facts: { ...base, hasAddressee: true, effectiveResolverPolicy: "human_only" }, addresseeLabel: "Raw addressee 原文" }, summary: "assignedBoard" },
  { name: "company-cap", source: { facts: { ...base, effectiveResolverPolicy: "human_only", effectiveResolverPolicySource: "company_cap" } }, summary: "boardOnly" },
  { name: "governed", source: { facts: { ...base, effectiveResolverPolicy: "human_only", effectiveResolverPolicySource: "governed_action" } }, summary: "boardOnly" },
  { name: "legacy", source: { facts: { ...base, effectiveResolverPolicy: "human_only", resolverPolicyProvenance: "legacy_inherited_restriction" } }, summary: "boardOnly" },
];
const fill = (text: string) => text.replace("{{addressee}}", "Raw addressee 原文").replace("{{creator}}", "Raw creator 原文");
it.each(locales)("validates full audience dictionary in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));
it.each(locales.flatMap(locale => variants.map(variant => ({ locale, ...variant }))))("updates the same $name audience object and tooltip in $locale without mutating canonical facts", async ({ locale, source, summary }) => {
  await language(locale); const before = JSON.stringify(source); const canonical = describeResolverAudience(source); const audience = displayResolverAudience(source);
  await act(async () => root.render(<><InteractionAudienceLine audience={audience} /><InteractionAudienceLine audience={audience} variant="compact" /></>));
  const lines = container.querySelectorAll<HTMLElement>('[data-testid="interaction-audience"]');
  expect(lines[0].textContent).toContain(fill(messages[locale][summary])); expect(lines[1].title).toContain(fill(messages[locale][summary]));
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(lines[0].textContent).toContain(fill(messages[next][summary])); expect(lines[1].title).toContain(fill(messages[next][summary]));
  expect(lines[0].dataset.audiencePolicy).toBe(canonical.policy); expect(lines[0].dataset.audienceOpen).toBe(String(canonical.isOpen));
  if (canonical.narrowedBy === "governed_action") expect(lines[0].textContent).toContain(messages[next].governed);
  if (canonical.narrowedBy === "legacy_restriction") expect(lines[0].textContent).toContain(messages[next].legacy);
  if (canonical.narrowedBy === "company_cap") expect(lines[1].title).toContain(messages[next].companyCap.replace("{{requested}}", messages[next].policies.anyone).replace("{{effective}}", messages[next].policies.human_only));
  expect(JSON.stringify(source)).toBe(before); expect(describeResolverAudience(source)).toEqual(canonical);
});
it.each(variants)("matches the canonical English description for $name without modifying the canonical helper", async ({ source }) => {
  const { displaySource, ...display } = displayResolverAudience(source); expect(displaySource).toBe(source); expect(display).toEqual(describeResolverAudience(source));
});
it.each(locales)("keeps unmarked custom/canonical audience strings and actor names raw in %s", async locale => {
  await language(locale); const raw = describeResolverAudience({ facts: base });
  await act(async () => root.render(<InteractionAudienceLine audience={raw} />)); expect(container.textContent).toContain(messages.en.anyone);
  const source = { facts: { ...base, hasAddressee: true, isUserAddressee: true }, addresseeLabel: "You" };
  expect(displayResolverAudience(source).summary).toBe(messages[locale].onlyAddressee.replace("{{addressee}}", "You"));
  expect(displayResolverAudience({ ...source, addresseeIsCurrentUser: true }).summary).toBe(messages[locale].onlyAddressee.replace("{{addressee}}", short[locale].you));
});
it.each(locales)("uses only structured attention facts and explicit current-user identity in %s", async locale => {
  await language(locale);
  const resolverAudience: AttentionResolverAudience = { ...base, addresseeAgentId: null, addresseeUserId: "user-raw", addresseeName: "You", createdByAgentId: "creator-raw", createdByAgentName: "Human only" };
  const item = { sourceKind: "issue_thread_interaction" as const, resolverAudience }; const before = JSON.stringify(item); const canonical = describeAttentionResolverAudience(item);
  const display = displayAttentionResolverAudience(item)!;
  await act(async () => root.render(<InteractionAudienceLine audience={display} variant="compact" />)); expect(container.textContent).toBe(short[locale].onlyAddressee.replace("{{addressee}}", "You"));
  expect(displayAttentionResolverAudience(item, { currentUserId: "user-raw" })?.shortSummary).toBe(short[locale].onlyAddressee.replace("{{addressee}}", short[locale].you));
  expect(displayAttentionResolverAudience({ sourceKind: "approval", resolverAudience })).toBeNull(); expect(displayAttentionResolverAudience({ sourceKind: "issue_thread_interaction" })).toBeNull();
  expect(JSON.stringify(item)).toBe(before); expect(describeAttentionResolverAudience(item)).toEqual(canonical);
});
