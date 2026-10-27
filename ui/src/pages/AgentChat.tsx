import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n";
import { agentChatsApi } from "@/api/agentChats";
import { agentsApi } from "@/api/agents";
import { authApi } from "@/api/auth";
import { useCompany } from "@/context/CompanyContext";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { recordAgentChatVisit } from "@/lib/recent-agent-chats";
import { queryKeys } from "@/lib/queryKeys";
import { useParams } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { TaskDetailSurface } from "./IssueDetail";
import { isUuidLike, type Issue } from "@paperclipai/shared";

export function AgentChat() {
  const { agentRef = "" } = useParams<{ agentRef: string }>();
  const { selectedCompanyId } = useCompany();
  const { enabled, loaded } = useAgentChatEnabled();
  const client = useQueryClient();
  const agents = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const userId =
    session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const rosterAgent = agents.data?.find(
    (item) => item.id === agentRef || agentRouteRef(item) === agentRef,
  );
  const historyAgent = useQuery({
    queryKey: queryKeys.agents.detail(agentRef),
    queryFn: () => agentsApi.get(agentRef, selectedCompanyId!),
    enabled: enabled && !!selectedCompanyId && agents.isSuccess && !rosterAgent && isUuidLike(agentRef),
  });
  const agent = rosterAgent ?? (historyAgent.data?.companyId === selectedCompanyId ? historyAgent.data : undefined);
  const chatKey = queryKeys.agentChats.detail(selectedCompanyId, userId, agent?.id);
  const chat = useQuery({
    queryKey: chatKey,
    queryFn: () => agentChatsApi.get(selectedCompanyId!, agent!.id),
    enabled: enabled && !!agent && session.isFetched,
  });
  const sessionId = session.data?.session?.id ?? null;
  const creating = useRef(new Map<string, Promise<Issue>>());
  useEffect(() => {
    if (enabled && agent && session.isSuccess && chat.isSuccess)
      recordAgentChatVisit(agent.companyId, userId, agent.id, chat.data?.id ?? null);
  }, [enabled, agent?.id, agent?.companyId, userId, session.isSuccess, chat.isSuccess, chat.data?.id]);
  const ensureIssue = useCallback(async () => {
    if (!agent || !selectedCompanyId) throw new Error("Agent not found");
    const assertActor = () => {
      const current = client.getQueryData<Awaited<ReturnType<typeof authApi.getSession>>>(queryKeys.auth.session);
      if ((current?.user?.id ?? current?.session?.userId ?? null) !== userId ||
        (current?.session?.id ?? null) !== sessionId) throw new Error(t("issueRecoveryUi.taskNotLoaded"));
    };
    const assertTarget = (issue: Issue) => {
      if (issue.companyId !== selectedCompanyId || issue.conversationAgentId !== agent.id ||
        (userId !== null && issue.conversationUserId !== userId) ||
        (chat.data && issue.id !== chat.data.id)) throw new Error(t("issueRecoveryUi.taskNotLoaded"));
    };
    assertActor();
    const existing = chat.data ?? client.getQueryData<Issue | null>(chatKey);
    if (existing) { assertTarget(existing); return existing; }
    // A stale route callback must not reuse another conversation's creation.
    const scope = JSON.stringify([selectedCompanyId, userId, sessionId, agent.id]);
    const promise = creating.current.get(scope) ?? agentChatsApi.ensure(selectedCompanyId, agent.id);
    creating.current.set(scope, promise);
    try {
      const issue = await promise;
      assertActor();
      assertTarget(issue);
      client.setQueryData(queryKeys.issues.detail(issue.id), issue);
      client.setQueryData(chatKey, issue);
      void client.invalidateQueries({ queryKey: queryKeys.agentChats.list(selectedCompanyId, userId) });
      return issue;
    } finally {
      if (creating.current.get(scope) === promise) creating.current.delete(scope);
    }
  }, [agent, selectedCompanyId, chat.data, client, userId, sessionId]);
  if (!loaded || agents.isPending || session.isPending || historyAgent.isFetching && !agent)
    return (
      <p className="text-sm text-muted-foreground">Loading conversation…</p>
    );
  if (!enabled && !chat.data)
    return (
      <p className="text-sm text-muted-foreground">
        Agent Chat is disabled. Enable it in Experimental settings. Existing
        history remains available through task links.
      </p>
    );
  if (agents.error || chat.error || !rosterAgent && historyAgent.error)
    return (
      <p className="text-sm text-destructive">
        {(agents.error ?? chat.error ?? historyAgent.error)?.message}
      </p>
    );
  if (!agent)
    return <p className="text-sm text-destructive">Agent not found.</p>;
  if (chat.isPending)
    return (
      <p className="text-sm text-muted-foreground">Loading conversation…</p>
    );
  return (
    <TaskDetailSurface
      key={`${agent.id}:${userId}`}
      conversation={{ agent, issue: chat.data ?? null, ensureIssue }}
    />
  );
}
