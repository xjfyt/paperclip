import type { IssueThreadInteraction } from "@/lib/issue-thread-interactions";
import { type InteractionAudienceDescription } from "@/lib/interaction-audience";
import { describeInteractionResolutionFailure, isInteractionAudienceDenial, interactionResolutionErrorCode, INTERACTION_AUDIENCE_DENIAL_CODES } from "@/lib/interaction-resolution-error";
import { t } from "./index";
import { displayResolverAudience, type DisplayInteractionAudience } from "./interaction-audience-display";

/** Display-only audience copy from structural policy facts, never translated actor names. */
export function taskInteractionAudience(args: {
  interaction: IssueThreadInteraction;
  creatorLabel?: string | null;
  addresseeLabel?: string | null;
  creatorIsCurrentUser?: boolean;
  addresseeIsCurrentUser?: boolean;
}): DisplayInteractionAudience {
  const { interaction, ...labels } = args;
  return displayResolverAudience({
    ...labels,
    facts: {
      effectiveResolverPolicy: interaction.effectiveResolverPolicy,
      requestedResolverPolicy: interaction.requestedResolverPolicy,
      effectiveResolverPolicySource: interaction.effectiveResolverPolicySource,
      resolverPolicyProvenance: interaction.resolverPolicyProvenance,
      hasAddressee: Boolean(interaction.addresseeAgentId || interaction.addresseeUserId),
      isUserAddressee: Boolean(interaction.addresseeUserId),
    },
  });
}

/** Local fallback and guidance only. Raw server/provider reason is never classified by its text. */
export function taskInteractionError(error: unknown, audience: Pick<InteractionAudienceDescription, "shortSummary" | "isOpen">): string {
  const classified = describeInteractionResolutionFailure(error);
  const record = error && typeof error === "object" ? error as { body?: unknown } : null;
  const body = record?.body && typeof record.body === "object" ? record.body as { error?: unknown } : null;
  const raw = typeof body?.error === "string" && body.error.trim() ? body.error : error instanceof Error && error.message.trim() ? error.message : null;
  const text = (key: string) => t(`taskThreadFeedbackUi.${key}`);
  if (isInteractionAudienceDenial(error)) {
    const reason = raw ?? text((INTERACTION_AUDIENCE_DENIAL_CODES as readonly string[]).includes(interactionResolutionErrorCode(error) ?? "") ? "audienceDenied" : "permissionDenied");
    return audience.isOpen ? reason : `${reason} ${audience.shortSummary}`;
  }
  if (classified.kind === "settled") return raw ?? text("settled");
  return raw ? `${raw} ${text("tryAgain")}` : text("submitFailed");
}
