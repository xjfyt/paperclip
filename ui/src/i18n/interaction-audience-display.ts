import type { AttentionItem } from "@paperclipai/shared";
import {
  describeResolverAudience,
  type InteractionAudienceDescription,
  type InteractionAudienceFacts,
} from "@/lib/interaction-audience";
import { t } from "./index";

export interface InteractionAudienceDisplaySource {
  facts: InteractionAudienceFacts;
  creatorLabel?: string | null;
  addresseeLabel?: string | null;
  creatorIsCurrentUser?: boolean;
  addresseeIsCurrentUser?: boolean;
}
export interface DisplayInteractionAudience extends InteractionAudienceDescription {
  /** Explicit local provenance lets a display component update a memoized description on locale changes. */
  displaySource: InteractionAudienceDisplaySource;
}

/** Display opt-in only. Canonical policy, facts, and actor-provided names are never rewritten. */
export function displayResolverAudience(source: InteractionAudienceDisplaySource): DisplayInteractionAudience {
  const description = describeResolverAudience(source);
  const { facts } = source;
  const short = (key: string, values: Record<string, string> = {}) => t(`taskThreadFeedbackUi.${key}`, values);
  const full = (key: string, values: Record<string, string> = {}) => t(`interactionAudienceUi.${key}`, values);
  const addressee = source.addresseeIsCurrentUser ? short("you") : source.addresseeLabel?.trim() || short(facts.isUserAddressee ? "addressedUser" : "addressedAgent");
  const creator = source.creatorIsCurrentUser ? short("you") : source.creatorLabel?.trim() || short("creator");
  const policyLabel = (policy: string) => ["anyone", "not_creator", "human_only"].includes(policy) ? full(`policies.${policy}`) : policy;
  const summary = facts.isUserAddressee ? full("onlyAddressee", { addressee })
    : description.policy === "human_only" ? facts.hasAddressee ? full("assignedBoard", { addressee }) : full("boardOnly")
    : facts.hasAddressee ? full("addresseeOrBoard", { addressee })
    : description.policy === "not_creator" ? full("exceptCreator", { creator }) : full("anyone");
  const shortSummary = facts.isUserAddressee ? short("onlyAddressee", { addressee })
    : description.policy === "human_only" ? facts.hasAddressee ? short("assignedBoard", { addressee }) : short("boardOnly")
    : facts.hasAddressee ? short("addresseeOrBoard", { addressee }) : description.policy === "not_creator" ? short("exceptCreator", { creator }) : short("anyone");
  const narrowedNote = facts.effectiveResolverPolicySource === "governed_action" ? full("governed")
    : facts.effectiveResolverPolicySource === "company_cap" ? full("companyCap", { requested: policyLabel(description.requestedPolicy), effective: policyLabel(description.policy) })
    : facts.resolverPolicyProvenance === "legacy_inherited_restriction" ? full("legacy") : null;
  return {
    ...description,
    label: (description.policy !== "human_only" || facts.isUserAddressee) && facts.hasAddressee ? full("addressed") : policyLabel(description.policy),
    summary, shortSummary, narrowedNote, displaySource: source,
  };
}

export function displayAttentionResolverAudience(
  item: Pick<AttentionItem, "sourceKind" | "resolverAudience">,
  options: { currentUserId?: string | null } = {},
): DisplayInteractionAudience | null {
  if (item.sourceKind !== "issue_thread_interaction" || !item.resolverAudience) return null;
  const audience = item.resolverAudience;
  return displayResolverAudience({
    facts: {
      effectiveResolverPolicy: audience.effectiveResolverPolicy,
      requestedResolverPolicy: audience.requestedResolverPolicy,
      effectiveResolverPolicySource: audience.effectiveResolverPolicySource,
      resolverPolicyProvenance: audience.resolverPolicyProvenance,
      hasAddressee: Boolean(audience.addresseeAgentId || audience.addresseeUserId),
      isUserAddressee: Boolean(audience.addresseeUserId),
    },
    creatorLabel: audience.createdByAgentName,
    addresseeLabel: audience.addresseeName,
    addresseeIsCurrentUser: audience.addresseeUserId != null && audience.addresseeUserId === options.currentUserId,
  });
}
