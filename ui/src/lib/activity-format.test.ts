import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n, issueActivityMessages } from "../i18n/issue-activity-test-resources";
import { reviewPolicyMessages } from "../i18n/review-policy-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { formatActivityVerb, formatIssueActivityAction } from "./activity-format";

beforeEach(async () => { await i18n.changeLanguage("en"); });
afterEach(async () => { await i18n.changeLanguage("en"); });
function makeAgent(id: string, name: string): Agent {
  return { id, name, companyId: "company-1", urlKey: id, role: "engineer", title: null, icon: null,
    status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
    budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false },
    lastHeartbeatAt: null, metadata: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
}
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/{{(\w+)}}/g, (_match, key: string) => String(values[key]));
}

describe("activity formatting", () => {
  const agentMap = new Map<string, Agent>([
    ["agent-reviewer", makeAgent("agent-reviewer", "Reviewer Bot")],
    ["agent-approver", makeAgent("agent-approver", "Approver Bot")],
  ]);

  it("labels a Slack settlement as idle while retaining actual review wording", () => {
    const details = { status: "in_review", externalConversationState: "waiting" };
    expect(formatActivityVerb("issue.updated", details)).toBe("changed status to idle on");
    expect(formatIssueActivityAction("issue.updated", details)).toBe("changed the status to idle");
    expect(formatActivityVerb("issue.updated", { status: "in_review" })).toBe("changed status to in review on");
  });

  it("uses readable verbs for task read-state changes", () => {
    expect(formatActivityVerb("issue.read_marked")).toBe("read");
    expect(formatActivityVerb("issue.read_unmarked")).toBe("marked unread");
  });

  it("formats blocker activity using linked issue identifiers", () => {
    const details = {
      addedBlockedByIssues: [
        { id: "issue-2", identifier: "PAP-22", title: "Blocked task" },
      ],
      removedBlockedByIssues: [],
    };

    expect(formatActivityVerb("issue.blockers_updated", details)).toBe("added blocker PAP-22 to");
    expect(formatIssueActivityAction("issue.blockers_updated", details)).toBe("added blocker PAP-22");
  });

  it("formats reviewer activity using agent names", () => {
    const details = {
      addedParticipants: [
        { type: "agent", agentId: "agent-reviewer", userId: null },
      ],
      removedParticipants: [],
    };

    expect(formatActivityVerb("issue.reviewers_updated", details, { agentMap })).toBe("added reviewer Reviewer Bot to");
    expect(formatIssueActivityAction("issue.reviewers_updated", details, { agentMap })).toBe("added reviewer Reviewer Bot");
  });

  it("formats approver removals using user-aware labels", () => {
    const details = {
      addedParticipants: [],
      removedParticipants: [
        { type: "user", agentId: null, userId: "local-board" },
      ],
    };

    expect(formatActivityVerb("issue.approvers_updated", details)).toBe("removed approver Board from");
    expect(formatIssueActivityAction("issue.approvers_updated", details)).toBe("removed approver Board");
  });

  it("falls back to updated wording when reviewers are both added and removed", () => {
    const details = {
      addedParticipants: [
        { type: "agent", agentId: "agent-reviewer", userId: null },
      ],
      removedParticipants: [
        { type: "agent", agentId: "agent-approver", userId: null },
      ],
    };

    expect(formatActivityVerb("issue.reviewers_updated", details, { agentMap })).toBe("updated reviewers on");
    expect(formatIssueActivityAction("issue.reviewers_updated", details, { agentMap })).toBe("updated reviewers");
  });

  it("formats monitor activity with direct verbs", () => {
    expect(formatActivityVerb("issue.monitor_scheduled")).toBe("scheduled monitor on");
    expect(formatActivityVerb("issue.monitor_exhausted")).toBe("exhausted monitor on");
    expect(formatIssueActivityAction("issue.monitor_triggered")).toBe("triggered a monitor");
    expect(formatIssueActivityAction("issue.monitor_cleared")).toBe("cleared a monitor");
    expect(formatIssueActivityAction("issue.monitor_recovery_issue_created")).toBe("created a monitor recovery issue");
  });

  it("labels each queued-comment queue mutation", () => {
    expect(formatActivityVerb("issue.queued_comment_edited")).toBe("edited a queued comment on");
    expect(formatActivityVerb("issue.queued_comments_reordered")).toBe("reordered queued comments on");
    expect(formatActivityVerb("issue.queued_comment_discarded")).toBe("discarded a queued comment on");
    expect(formatIssueActivityAction("issue.queued_comment_edited")).toBe("edited a queued comment");
    expect(formatIssueActivityAction("issue.queued_comments_reordered")).toBe("reordered queued comments");
    expect(formatIssueActivityAction("issue.queued_comment_discarded")).toBe("discarded a queued comment");
  });

  // PAP-16506 P4: agents can now resolve an interaction, including a review of
  // their own work, so an outcome has to read as an outcome in the timeline
  // instead of leaking the raw action id.
  it("reads an interaction outcome as an outcome, whoever gave it", () => {
    expect(formatIssueActivityAction("issue.thread_interaction_accepted")).toBe("accepted the request");
    expect(formatIssueActivityAction("issue.thread_interaction_rejected")).toBe("rejected the request");
    expect(formatIssueActivityAction("issue.thread_interaction_withdrawn")).toBe("withdrew the request");
    expect(formatIssueActivityAction("issue.thread_interaction_expired")).toBe("expired the request");
    expect(formatActivityVerb("issue.thread_interaction_accepted")).toBe("accepted the request on");
    expect(formatActivityVerb("issue.thread_interaction_rejected")).toBe("rejected the request on");
  });

  // The accepted/rejected actions fire for every interaction kind, so only a
  // confirmation may read as an approval.
  it("says 'approved' only for a confirmation, never for a suggestion or a question", () => {
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "request_confirmation" }))
      .toBe("approved the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "request_checkbox_confirmation" }))
      .toBe("approved the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "suggest_tasks" }))
      .toBe("accepted the task suggestions");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "ask_user_questions" }))
      .toBe("accepted the answers");
    expect(formatIssueActivityAction("issue.thread_interaction_rejected", { interactionKind: "request_confirmation" }))
      .toBe("rejected the request");
    expect(formatIssueActivityAction("issue.thread_interaction_rejected", { interactionKind: "suggest_tasks" }))
      .toBe("declined the task suggestions");
    expect(formatActivityVerb("issue.thread_interaction_accepted", { interactionKind: "suggest_tasks" }))
      .toBe("accepted the task suggestions on");
  });

  it("keeps the neutral wording for a kind it does not know", () => {
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "request_item_verdicts" }))
      .toBe("accepted the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "future_kind" }))
      .toBe("accepted the request");
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: 7 }))
      .toBe("accepted the request");
  });

  it("names the verb an actor chose on a stalled review", () => {
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "approve" }))
      .toBe("approved the review");
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "request_changes" }))
      .toBe("requested changes on the review");
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "send_back" }))
      .toBe("sent the review back to work");
    expect(formatActivityVerb("issue.stalled_review_decided", { action: "approve" }))
      .toBe("approved the review on");
  });

  it("falls back to a generic verdict line when the decision verb is missing", () => {
    expect(formatIssueActivityAction("issue.stalled_review_decided")).toBe("recorded a review verdict");
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "shrug" }))
      .toBe("recorded a review verdict");
  });

  it("describes a review-policy change without calling the default 'none'", () => {
    expect(formatIssueActivityAction("issue.updated", { reviewPolicy: null }))
      .toBe("changed who can approve to anyone");
    expect(formatIssueActivityAction("issue.updated", { reviewPolicy: "human_only" }))
      .toBe("changed who can approve to human only");
    expect(formatIssueActivityAction("issue.updated", { reviewPolicy: "not_creator" }))
      .toBe("changed who can approve to anyone else");
  });

  it("uses plain next-step copy for successful-run handoff activity", () => {
    expect(formatActivityVerb("issue.successful_run_handoff_required")).toBe("flagged missing next step on");
    expect(formatIssueActivityAction("issue.successful_run_handoff_required")).toBe("Run finished without a clear next step");
    expect(formatIssueActivityAction("issue.successful_run_handoff_resolved")).toBe("Next step chosen");
    expect(formatIssueActivityAction("issue.successful_run_handoff_escalated")).toBe(
      "Run finished without a next step - recovery escalated",
    );
  });
});


describe.each(Object.entries(issueActivityMessages))("issue activity localization (%s)", (locale, messages) => {
  beforeEach(async () => { await i18n.changeLanguage(locale); });
  const name = "原文 <Agent> 日本語";
  const options = {
    agentMap: new Map([["agent-1", makeAgent("agent-1", name)]]),
    userProfileMap: new Map([["user-1", { label: "Raw 用户 <name>", image: null }]]), currentUserId: "current-user",
  };
  it("covers all known action labels with matching complete four-language resources", () => {
    expect(validateLocaleMessages(messages, issueActivityMessages.en)).toEqual([]);
    for (const [key, label] of Object.entries(messages.actions)) {
      expect(formatIssueActivityAction(key.replace("_", "."))).toBe(label);
    }
    expect(formatIssueActivityAction("future.plugin_action.v2")).toBe("future plugin action v2");
  });
  it("localizes known status/priority values and keeps the original unknown-value formatting and input", () => {
    for (const [status, label] of Object.entries(messages.status)) {
      expect(formatIssueActivityAction("issue.updated", { status })).toBe(fill(messages.statusChangedTo, { to: label }));
    }
    for (const [priority, label] of Object.entries(messages.priority)) {
      expect(formatIssueActivityAction("issue.updated", { priority })).toBe(fill(messages.priorityChangedTo, { to: label }));
    }
    const details = { status: "in_review", externalConversationState: "waiting", priority: "high", _previous: { status: "in_progress", priority: "low" } };
    const original = JSON.stringify(details);
    expect(formatIssueActivityAction("issue.updated", details)).toBe([
      fill(messages.statusChangedFrom, { from: messages.status.in_progress, to: messages.status.idle }),
      fill(messages.priorityChangedFrom, { from: messages.priority.low, to: messages.priority.high }),
    ].join(messages.listSeparator));
    expect(JSON.stringify(details)).toBe(original);
    expect(formatIssueActivityAction("issue.updated", { status: "future_state.X", _previous: { status: "old_state" } }))
      .toBe(fill(messages.statusChangedFrom, { from: "old state", to: "future state.X" }));
    expect(formatIssueActivityAction("issue.updated", { priority: "future_priority" }))
      .toBe(fill(messages.priorityChangedTo, { to: "future priority" }));
    expect(formatIssueActivityAction("issue.updated", { status: null })).toBe(fill(messages.statusChangedTo, { to: messages.none }));
    expect(formatIssueActivityAction("issue.updated", { status: 7 })).toBe(fill(messages.statusChangedTo, { to: 7 }));
  });
  it("preserves provided names and translates only local participant fallbacks and full assignment phrases", () => {
    for (const [details, label] of [
      [{ assigneeAgentId: "agent-1" }, name], [{ assigneeAgentId: "missing" }, messages.agent],
      [{ assigneeUserId: "user-1" }, "Raw 用户 <name>"], [{ assigneeUserId: "local-board" }, messages.board],
      [{ assigneeUserId: "current-user" }, messages.you], [{ assigneeUserId: "unknown-user" }, fill(messages.user, { id: "unkno" })],
    ] as const) {
      expect(formatIssueActivityAction("issue.updated", details, options)).toBe(fill(messages.assigneeChanged, { name: label }));
    }
    expect(formatIssueActivityAction("issue.updated", { assigneeAgentId: null, title: "Raw_title", description: "# raw_body" }))
      .toBe([messages.assigneeCleared, messages.titleUpdated, messages.descriptionUpdated].join(messages.listSeparator));
  });
  it("uses complete named/count relation phrases without changing additions or removals", () => {
    for (const [relation, action] of [["blocker", "issue.blockers_updated"], ["reviewer", "issue.reviewers_updated"], ["approver", "issue.approvers_updated"]] as const) {
      for (const count of [0, 1, 2]) {
        const entities = Array.from({ length: count }, () => relation === "blocker" ? { id: "raw-id", identifier: "PAP-42", title: "Raw_title" } : { type: "agent", agentId: "agent-1" });
        for (const direction of ["Added", "Removed"] as const) {
          const key = relation === "blocker" ? direction === "Added" ? "addedBlockedByIssues" : "removedBlockedByIssues" : direction === "Added" ? "addedParticipants" : "removedParticipants";
          const details = { [key]: entities };
          const original = JSON.stringify(details);
          const template = count === 0 ? messages.relations[`${relation}Updated`] : messages.relations[`${relation}${direction}${count === 1 ? "Named" : "Count"}`];
          expect(formatIssueActivityAction(action, details, options)).toBe(fill(template, { count, name: relation === "blocker" ? "PAP-42" : name }));
          expect(JSON.stringify(details)).toBe(original);
        }
      }
    }
    expect(formatIssueActivityAction("issue.reviewers_updated", { addedParticipants: [{ type: "agent" }], removedParticipants: [{ type: "user" }] }, options)).toBe(messages.relations.reviewerUpdated);
    expect(formatIssueActivityAction("issue.blockers_updated", { addedBlockedByIssues: [{}] })).toBe(fill(messages.relations.blockerAddedNamed, { name: messages.task }));
  });
  it("preserves document keys/titles and service values inside action-specific complete phrases", () => {
    for (const [key, template] of Object.entries(messages.monitorServices)) {
      expect(formatIssueActivityAction(key.replace("_", "."), { serviceName: "  service_raw <日本語>  " })).toBe(fill(template, { service: "service_raw <日本語>" }));
    }
    for (const [key, template] of Object.entries(messages.documents)) {
      const details = { key: "AGENTS.md", title: "原文 <日本語> _title" };
      expect(formatIssueActivityAction(key.replace("_", "."), details)).toBe(fill(template, { document: "AGENTS.md (原文 <日本語> _title)" }));
      expect(details).toEqual({ key: "AGENTS.md", title: "原文 <日本語> _title" });
    }
    expect(formatIssueActivityAction("issue.monitor_future", { serviceName: " raw_service " })).toBe(fill(messages.unknownMonitorService, { action: "issue monitor future", service: "raw_service" }));
  });
  it("retains confirmation versus suggestion/question outcomes and the exact review-policy contract", () => {
    for (const outcome of ["accepted", "rejected"] as const) {
      for (const [interactionKind, label] of Object.entries(messages.outcomes[outcome])) {
        expect(formatIssueActivityAction(`issue.thread_interaction_${outcome}`, { interactionKind })).toBe(label);
      }
    }
    for (const [action, label] of Object.entries(messages.reviewDecisions)) expect(formatIssueActivityAction("issue.stalled_review_decided", { action })).toBe(label);
    expect(formatIssueActivityAction("issue.thread_interaction_accepted", { interactionKind: "future_kind" })).toBe(messages.actions.issue_thread_interaction_accepted);
    expect(formatIssueActivityAction("issue.stalled_review_decided", { action: "future_verdict" })).toBe(messages.actions.issue_stalled_review_decided);
    const policies = reviewPolicyMessages[locale as keyof typeof reviewPolicyMessages];
    for (const [policy, label] of [[null, policies.anyoneValue], ["anyone", policies.anyoneValue], ["human_only", policies.humanOnlyValue], ["not_creator", policies.notCreatorValue], ["future_policy", "future policy"], ["constructor", "constructor"]] as const) {
      expect(formatIssueActivityAction("issue.updated", { reviewPolicy: policy })).toBe(fill(messages.reviewPolicyChanged, { policy: label }));
    }
  });
  it("keeps decomposition counts and existing fallback rules", () => {
    const details = { status: "completed", childIssueIds: ["a", "b", "c", "", null], newlyCreatedChildIssueIds: ["a"] };
    expect(formatIssueActivityAction("issue.accepted_plan_decomposition_updated", details)).toBe(fill(messages.decomposition.completedSummary, { summary: fill(messages.decomposition.createdAndReused, { created: 1, reused: 2 }) }));
    expect(formatIssueActivityAction("issue.accepted_plan_decomposition_updated", { status: "completed" })).toBe(messages.decomposition.completed);
    expect(formatIssueActivityAction("issue.accepted_plan_decomposition_updated", { status: "in_flight", requestedChildCount: 0 })).toBe(fill(messages.decomposition.inFlightSummary, { summary: fill(messages.decomposition.requested, { count: 0 }) }));
    expect(formatIssueActivityAction("issue.accepted_plan_decomposition_updated", { requestedChildCount: Number.NaN })).toBe(messages.actions.issue_accepted_plan_decomposition_updated);
  });
  it("does not change the separate activity-feed formatter", () => {
    expect(formatActivityVerb("issue.updated", { status: "in_progress", priority: "high" })).toBe("changed status to in progress on");
    expect(formatActivityVerb("issue.reviewers_updated", { addedParticipants: [{ type: "agent", agentId: "agent-1" }] }, options)).toBe(`added reviewer ${name} to`);
    expect(formatActivityVerb("issue.thread_interaction_accepted", { interactionKind: "suggest_tasks" })).toBe("accepted the task suggestions on");
    expect(formatActivityVerb("tool_gateway.call_completed", { tool: "raw_tool" })).toBe("used raw tool on");
    expect(formatActivityVerb("future.action_name")).toBe("future action name");
  });
});
