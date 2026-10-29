import type { IssueThreadInteraction } from "@/lib/issue-thread-interactions";
import { describeInteractionAudience, type InteractionAudienceDescription } from "@/lib/interaction-audience";
import { describeInteractionResolutionFailure, isInteractionAudienceDenial, interactionResolutionErrorCode, INTERACTION_AUDIENCE_DENIAL_CODES } from "@/lib/interaction-resolution-error";
import { t } from "./index";

/** Display-only audience copy from structural policy facts, never translated actor names. */
export function taskInteractionAudience(args: {
  interaction: IssueThreadInteraction;
  creatorLabel?: string | null;
  addresseeLabel?: string | null;
  creatorIsCurrentUser?: boolean;
  addresseeIsCurrentUser?: boolean;
}): InteractionAudienceDescription {
  const description = describeInteractionAudience(args);
  const { interaction } = args;
  const text = (key: string, values: Record<string, string> = {}) => t(`taskThreadFeedbackUi.${key}`, values);
  const hasAddressee = Boolean(interaction.addresseeAgentId || interaction.addresseeUserId);
  const userAddressee = Boolean(interaction.addresseeUserId);
  const addressee = args.addresseeIsCurrentUser ? text("you") : args.addresseeLabel?.trim() || text(userAddressee ? "addressedUser" : "addressedAgent");
  const creator = args.creatorIsCurrentUser ? text("you") : args.creatorLabel?.trim() || text("creator");
  const shortSummary = userAddressee ? text("onlyAddressee", { addressee })
    : description.policy === "human_only" ? hasAddressee ? text("assignedBoard", { addressee }) : text("boardOnly")
    : hasAddressee ? text("addresseeOrBoard", { addressee }) : description.policy === "not_creator" ? text("exceptCreator", { creator }) : text("anyone");
  // This compact consumer needs only shortSummary; leave canonical metadata and unused fields intact.
  return { ...description, shortSummary };
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
