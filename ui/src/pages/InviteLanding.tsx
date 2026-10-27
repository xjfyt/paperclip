import { apiUnavailableUiMessage, describeApiUiError, renderApiUiMessage } from "@/i18n/api-errors";
import type { LocalizedUiMessage } from "@/lib/localized-ui-error";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENT_ADAPTER_TYPES } from "@paperclipai/shared";
import type { AgentAdapterType, JoinRequest } from "@paperclipai/shared";
import { InviteAuthMethods } from "@/components/InviteAuthMethods";
import { t as inviteT, useTranslation } from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Button } from "@/components/ui/button";
import { CompanyPatternIcon } from "@/components/CompanyPatternIcon";
import { useCompany } from "@/context/CompanyContext";
import { Link, useNavigate, useParams } from "@/lib/router";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { fetchCompanyListForCurrentAccount, useCompanyListQuery } from "../api/companies-query";
import { healthApi } from "../api/health";
import { getAdapterLabel } from "../adapters/adapter-display-registry";
import { clearPendingInviteToken, rememberPendingInviteToken } from "../lib/invite-memory";
import { queryKeys } from "../lib/queryKeys";
import { formatDate } from "../lib/utils";

type AuthMode = "sign_in" | "sign_up";
type AuthFeedback = { tone: "error" | "info"; message: string; translationKey?: string; values?: Record<string, string> };

// Agent-invite onboarding remains a legacy-adapter flow. Native runner setup
// belongs in authenticated agent configuration after an administrator enables
// the experimental flag.
const joinAdapterOptions: AgentAdapterType[] = AGENT_ADAPTER_TYPES.filter(
  (type) => type !== "paperclip_runner",
);
const ENABLED_INVITE_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "gemini_local",
  "kimi_local",
  "opencode_local",
  "pi_local",
  "cursor",
]);

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim().length > 0 ? current : null;
}

const fieldClassName =
  "w-full border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500";
const panelClassName = "border border-zinc-800 bg-zinc-950/95 p-6";
const modeButtonBaseClassName =
  "flex-1 border px-3 py-2 text-sm transition-colors";

function formatHumanRole(role: string | null | undefined) {
  if (!role) return null;
  return ["owner", "admin", "operator", "viewer"].includes(role) ? inviteT(`inviteUi.${role}`) : role.charAt(0).toUpperCase() + role.slice(1);
}

function getAuthErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  const message = error.message.trim();
  return message.length > 0 ? message : null;
}

function localizedInviteFeedback(tone: AuthFeedback["tone"], key: string, values?: Record<string, string>): AuthFeedback {
  const translationKey = `inviteUi.${key}`;
  return { tone, translationKey, values, message: inviteT(translationKey, values) };
}

function mapInviteAuthFeedback(error: unknown, authMode: AuthMode, email: string): AuthFeedback {
  const unavailable = apiUnavailableUiMessage(error);
  if (unavailable) return { tone: "error", translationKey: unavailable.key, message: getAuthErrorMessage(error) ?? "" };
  const code = getAuthErrorCode(error), message = getAuthErrorMessage(error);
  const emailLabel = email.trim() || inviteT("inviteUi.thatEmail");
  if (code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return localizedInviteFeedback("info", "accountExists", { email: emailLabel });
  if (code === "INVALID_EMAIL_OR_PASSWORD" || (authMode === "sign_in" && message === "Request failed: 401")) return localizedInviteFeedback("error", "credentialsMismatch");
  if (authMode === "sign_up" && message === "Request failed: 422") return localizedInviteFeedback("info", "accountMayExist", { email: emailLabel });
  return message ? { tone: "error", message } : localizedInviteFeedback("error", "authFailed");
}

function isBootstrapAcceptancePayload(payload: unknown) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "bootstrapAccepted" in (payload as Record<string, unknown>),
  );
}

function isApprovedHumanJoinPayload(payload: unknown, showsAgentForm: boolean) {
  if (!payload || typeof payload !== "object" || showsAgentForm) return false;
  const status = (payload as { status?: unknown }).status;
  return status === "approved";
}

type AwaitingJoinApprovalPanelProps = {
  companyDisplayName: string;
  companyLogoUrl: string | null;
  invitedByUserName: string | null;
  claimSecret?: string | null;
  claimApiKeyPath?: string | null;
  onboardingTextUrl?: string | null;
};

function InviteCompanyLogo({
  companyDisplayName,
  companyLogoUrl,
  className,
}: {
  companyDisplayName: string;
  companyLogoUrl: string | null;
  className?: string;
}) {
  return (
    <CompanyPatternIcon
      companyName={companyDisplayName}
      logoUrl={companyLogoUrl}
      logoFit="contain"
      className={className}
    />
  );
}

function AwaitingJoinApprovalPanel({
  companyDisplayName,
  companyLogoUrl,
  invitedByUserName,
  claimSecret = null,
  claimApiKeyPath = null,
  onboardingTextUrl = null,
}: AwaitingJoinApprovalPanelProps) {
  useTranslation();
  const approverLabel = invitedByUserName ?? inviteT("inviteUi.anAdmin");

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <div className="mx-auto max-w-md border border-zinc-800 bg-zinc-950 p-6" data-testid="invite-pending-approval">
        <div className="flex items-center gap-3">
          <InviteCompanyLogo
            companyDisplayName={companyDisplayName}
            companyLogoUrl={companyLogoUrl}
            className="h-12 w-12 border border-zinc-800 rounded-none"
          />
          <h1 className="text-lg font-semibold">{inviteT("inviteUi.requestJoin", { company: companyDisplayName })}</h1>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-400">
            {inviteT("inviteUi.awaitingApproval", { approver: approverLabel })}
          </p>
          <div className="border border-zinc-800 p-3">
            <p className="text-xs text-zinc-500 mb-1">{inviteT("inviteUi.approvalPage")}</p>
            <p className="text-sm text-zinc-200">{inviteT("inviteUi.settingsMembers")}</p>
          </div>
          <p className="text-sm text-zinc-400">
            {inviteT("inviteUi.askAdmin", { page: inviteT("inviteUi.settingsMembers") })}
          </p>
          <p className="text-xs text-zinc-500">{inviteT("inviteUi.refreshApproval")}</p>
        </div>
        {claimSecret && claimApiKeyPath ? (
          <div className="mt-4 space-y-1 border border-zinc-800 p-3 text-xs text-zinc-400">
            <div className="text-zinc-200">{inviteT("inviteUi.claimSecret")}</div>
            <div className="font-mono break-all">{claimSecret}</div>
            <div className="font-mono break-all">POST {claimApiKeyPath}</div>
          </div>
        ) : null}
        {onboardingTextUrl ? (
          <div className="mt-4 text-xs text-zinc-400">{inviteT("inviteUi.onboarding")} {" "}<span className="font-mono break-all">{onboardingTextUrl}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function InviteLandingPage() {
  const { token } = useParams();
  // Invitation forms, acceptance results and asynchronous callbacks are scoped
  // to the exact token, not the route component's lifetime across navigation.
  return <><div className="fixed right-4 top-4 z-20"><LanguageSelector /></div><InviteLandingContent key={token ?? "missing"} /></>;
}

function InviteLandingContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setSelectedCompanyId } = useCompany();
  const params = useParams();
  const token = (params.token ?? "").trim();
  const [authMode, setAuthMode] = useState<AuthMode>("sign_up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agentName, setAgentName] = useState("");
  const [adapterType, setAdapterType] = useState<AgentAdapterType>("claude_local");
  const [capabilities, setCapabilities] = useState("");
  const [result, setResult] = useState<{ kind: "bootstrap" | "join"; payload: unknown } | null>(null);
  const [error, setError] = useState<LocalizedUiMessage | null>(null);
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback | null>(null);
  const [autoAcceptStarted, setAutoAcceptStarted] = useState(false);
  const authErrorId = "invite-auth-error";
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const inviteQuery = useQuery({
    queryKey: queryKeys.access.invite(token),
    queryFn: () => accessApi.getInvite(token),
    enabled: token.length > 0,
    retry: false,
  });

  // Whose list this is, is no longer this page's problem: the entry is keyed by
  // account, so another account's list is unreachable rather than merely
  // distrusted. What is left for the gate below is narrower and still real — do
  // we have an answer *yet*. Without it, a pending query reads as an empty list,
  // which reads as "not a member", which auto-accepts an invite the customer may
  // already hold.
  //
  // Hence `staleTime: 0` and a mount-scoped flag rather than `isSuccess`: a
  // cached list is the right account's now, but it can be thirty seconds old, and
  // acting on "not a member" is the direction that costs something.
  //
  // `local_trusted` has no accounts at all, so there is no identity to key on and
  // nothing to check the list against; the gate stays open.
  const companiesQuery = useCompanyListQuery({
    enabled: !!sessionQuery.data && !!inviteQuery.data?.companyId,
    staleTime: 0,
  });
  const membershipIsAccountScoped = healthQuery.data?.deploymentMode !== "local_trusted";
  // No `sessionQuery.data` term: the query only fetches while a session exists, so
  // the flag cannot be true without one, and if the session lapses the observer
  // re-keys to the anonymous entry and holds no data to leak.
  const membershipListIsCurrent = membershipIsAccountScoped
    ? companiesQuery.isFetchedAfterMount
    : true;
  const companyList = membershipListIsCurrent ? companiesQuery.data?.companies ?? [] : [];

  useEffect(() => {
    if (token) rememberPendingInviteToken(token);
  }, [token]);

  useEffect(() => {
    setAutoAcceptStarted(false);
  }, [token]);

  useEffect(() => {
    if (!membershipListIsCurrent) return;
    const list = companiesQuery.data?.companies;
    if (!list || !inviteQuery.data?.companyId) return;
    if (list.some((c) => c.id === inviteQuery.data!.companyId)) {
      clearPendingInviteToken(token);
    }
  }, [companiesQuery.data, inviteQuery.data, membershipListIsCurrent, token]);

  const invite = inviteQuery.data;
  const isCheckingExistingMembership =
    Boolean(sessionQuery.data) &&
    Boolean(invite?.companyId) &&
    !membershipListIsCurrent;
  const isCurrentMember =
    Boolean(invite?.companyId) &&
    companyList.some((company) => company.id === invite?.companyId);
  const companyName = invite?.companyName?.trim() || null;
  const companyDisplayName = companyName || inviteT("inviteUi.thisCompany");
  const companyLogoUrl = invite?.companyLogoUrl?.trim() || null;
  const invitedByUserName = invite?.invitedByUserName?.trim() || null;
  const inviteMessage = invite?.inviteMessage?.trim() || null;
  const requestedHumanRole = formatHumanRole(invite?.humanRole);
  const inviteJoinRequestStatus = invite?.joinRequestStatus ?? null;
  const inviteJoinRequestType = invite?.joinRequestType ?? null;
  const canCompleteAcceptedHumanInvite =
    inviteJoinRequestType === "human" &&
    (inviteJoinRequestStatus === "pending_approval" || inviteJoinRequestStatus === "approved");
  const requiresHumanAccount =
    healthQuery.data?.deploymentMode === "authenticated" &&
    !sessionQuery.data &&
    invite?.allowedJoinTypes !== "agent";
  const showsAgentForm = invite?.inviteType !== "bootstrap_ceo" && invite?.allowedJoinTypes === "agent";
  const shouldAutoAcceptHumanInvite =
    Boolean(invite) && !inviteQuery.isPending && !inviteQuery.isError &&
    !healthQuery.isPending && !healthQuery.isError && !sessionQuery.isError &&
    !companiesQuery.isError && !companiesQuery.isFetching &&
    Boolean(sessionQuery.data) &&
    !showsAgentForm &&
    invite?.inviteType !== "bootstrap_ceo" &&
    (!inviteJoinRequestStatus || canCompleteAcceptedHumanInvite) &&
    !isCheckingExistingMembership &&
    !isCurrentMember &&
    !result &&
    error === null;
  const sessionLabel =
    sessionQuery.data?.user.name?.trim() ||
    sessionQuery.data?.user.email?.trim() ||
    inviteT("inviteUi.thisAccount");

  const authCanSubmit =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (authMode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!invite) throw new Error(inviteT("inviteUi.notFound"));
      if (isCheckingExistingMembership) {
        throw new Error(inviteT("inviteUi.checkingRetry"));
      }
      if (isCurrentMember) {
        throw new Error(inviteT("inviteUi.alreadyBelongs"));
      }
      if (invite.inviteType === "bootstrap_ceo" || invite.allowedJoinTypes !== "agent") {
        return accessApi.acceptInvite(token, { requestType: "human" });
      }
      return accessApi.acceptInvite(token, {
        requestType: "agent",
        agentName: agentName.trim(),
        adapterType,
        capabilities: capabilities.trim() || null,
      });
    },
    onSuccess: async (payload) => {
      if (!active.current) return;
      setError(null);
      clearPendingInviteToken(token);
      const asBootstrap = isBootstrapAcceptancePayload(payload);
      setResult({ kind: asBootstrap ? "bootstrap" : "join", payload });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      if (!active.current) return;
      if (invite?.companyId && isApprovedHumanJoinPayload(payload, showsAgentForm)) {
        setSelectedCompanyId(invite.companyId, { source: "manual" });
        navigate("/", { replace: true });
      }
    },
    onError: (err) => {
      if (!active.current) return;
      setError(describeApiUiError(err, { key: "inviteUi.acceptFailed" }));
    },
  });

  useEffect(() => {
    if (!shouldAutoAcceptHumanInvite || autoAcceptStarted || acceptMutation.isPending) return;
    setAutoAcceptStarted(true);
    setError(null);
    acceptMutation.mutate();
  }, [acceptMutation, autoAcceptStarted, shouldAutoAcceptHumanInvite]);

  const authMutation = useMutation({
    mutationFn: async () => {
      if (authMode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      if (!active.current) return;
      setAuthFeedback(null);
      rememberPendingInviteToken(token);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
      await queryClient.invalidateQueries({ queryKey: queryKeys.access.currentBoardAccess });
      // Keyed to the account that just signed in — the helper resolves the
      // identity past the invalidation above rather than trusting the session
      // entry still sitting in the cache — and forced past whatever is cached
      // for it. This replaces the hand-rolled cancel-and-refetch this PR
      // originally carried, which #11488 made both unnecessary and weaker.
      const { companies: freshCompanies } = await fetchCompanyListForCurrentAccount(queryClient);
      if (!active.current) return;

      if (invite?.companyId && freshCompanies.some((company) => company.id === invite.companyId)) {
        clearPendingInviteToken(token);
        setSelectedCompanyId(invite.companyId, { source: "manual" });
        navigate("/", { replace: true });
        return;
      }

      if (!invite || invite.inviteType !== "bootstrap_ceo") {
        return;
      }

      try {
        const payload = await acceptMutation.mutateAsync();
        if (active.current && isBootstrapAcceptancePayload(payload)) {
          navigate("/", { replace: true });
        }
      } catch {
        return;
      }
    },
    onError: (err) => {
      if (!active.current) return;
      const nextFeedback = mapInviteAuthFeedback(err, authMode, email);
      if (getAuthErrorCode(err) === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        setAuthMode("sign_in");
        setPassword("");
      }
      setAuthFeedback(nextFeedback);
    },
  });

  const joinButtonLabel = useMemo(() => {
    if (!invite) return inviteT("inviteUi.continue");
    if (isCurrentMember) return inviteT("inviteUi.openOrganization");
    if (invite.inviteType === "bootstrap_ceo") return inviteT("inviteUi.accept");
    if (showsAgentForm) return inviteT("inviteUi.submitRequest");
    return sessionQuery.data ? inviteT("inviteUi.accept") : inviteT("inviteUi.continue");
  }, [invite, isCurrentMember, sessionQuery.data, showsAgentForm, t]);

  if (!token) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-destructive">{inviteT("inviteUi.invalidToken")}</div>;
  }

  if (inviteQuery.isLoading || healthQuery.isLoading || sessionQuery.isLoading) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">{inviteT("inviteUi.loading")}</div>;
  }

  if (healthQuery.isError || sessionQuery.isError || companiesQuery.isError) {
    return <p role="alert" className="p-6">{t("auth.unavailable")}</p>;
  }

  if (isCheckingExistingMembership) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">{inviteT("inviteUi.checkingAccess")}</div>;
  }

  if (inviteQuery.error || !invite) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="border border-border bg-card p-6" data-testid="invite-error">
          <h1 className="text-lg font-semibold">{inviteT("inviteUi.unavailable")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{inviteT("inviteUi.unavailableHelp")}</p>
        </div>
      </div>
    );
  }

  if (
    inviteJoinRequestStatus === "approved" &&
    inviteJoinRequestType === "human" &&
    isCurrentMember
  ) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">{inviteT("inviteUi.opening")}</div>;
  }

  if (inviteJoinRequestStatus === "pending_approval" && !canCompleteAcceptedHumanInvite) {
    return (
      <AwaitingJoinApprovalPanel
        companyDisplayName={companyDisplayName}
        companyLogoUrl={companyLogoUrl}
        invitedByUserName={invitedByUserName}
      />
    );
  }

  if (inviteJoinRequestStatus && !canCompleteAcceptedHumanInvite) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="border border-border bg-card p-6" data-testid="invite-error">
          <h1 className="text-lg font-semibold">{inviteT("inviteUi.unavailable")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {inviteJoinRequestStatus === "rejected"
              ? inviteT("inviteUi.notApproved")
              : inviteT("inviteUi.used")}
          </p>
        </div>
      </div>
    );
  }

  if (result?.kind === "bootstrap") {
    return (
      <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
        <div className="mx-auto max-w-md border border-zinc-800 bg-zinc-950 p-6">
          <h1 className="text-lg font-semibold">{inviteT("inviteUi.bootstrapComplete")}</h1>
          <div className="mt-4">
            <Button asChild className="rounded-none">
              <Link to="/">{inviteT("inviteUi.openBoard")}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (result?.kind === "join") {
    const payload = result.payload as JoinRequest & {
      claimSecret?: string;
      claimApiKeyPath?: string;
      onboarding?: Record<string, unknown>;
    };
    const claimSecret = typeof payload.claimSecret === "string" ? payload.claimSecret : null;
    const claimApiKeyPath = typeof payload.claimApiKeyPath === "string" ? payload.claimApiKeyPath : null;
    const onboardingTextUrl = readNestedString(payload.onboarding, ["textInstructions", "url"]);
    const joinedNow = !showsAgentForm && payload.status === "approved";

    return (
      joinedNow ? (
        <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
          <div className="mx-auto max-w-md border border-zinc-800 bg-zinc-950 p-6">
            <div className="flex items-center gap-3">
              <InviteCompanyLogo
                companyDisplayName={companyDisplayName}
                companyLogoUrl={companyLogoUrl}
                className="h-12 w-12 border border-zinc-800 rounded-none"
              />
              <h1 className="text-lg font-semibold">{inviteT("inviteUi.joined")}</h1>
            </div>
            <div className="mt-4">
              <Button asChild className="w-full h-auto whitespace-normal rounded-none">
                <Link to="/">{inviteT("inviteUi.openBoard")}</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <AwaitingJoinApprovalPanel
          companyDisplayName={companyDisplayName}
          companyLogoUrl={companyLogoUrl}
          invitedByUserName={invitedByUserName}
          claimSecret={claimSecret}
          claimApiKeyPath={claimApiKeyPath}
          onboardingTextUrl={onboardingTextUrl}
        />
      )
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-(--gtc-36)">
          <section className={`${panelClassName} space-y-6`}>
            <div className="flex items-start gap-4">
              <InviteCompanyLogo
                companyDisplayName={companyDisplayName}
                companyLogoUrl={companyLogoUrl}
                className="h-16 w-16 rounded-none border border-zinc-800"
              />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-(--tracking-caps) text-zinc-500">{inviteT("inviteUi.invited")}</p>
                <h1 className="mt-2 text-2xl font-semibold">
                  {invite.inviteType === "bootstrap_ceo" ? inviteT("inviteUi.setup") : inviteT("inviteUi.join", { company: companyDisplayName })}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                  {showsAgentForm
                    ? inviteT("inviteUi.agentIntro")
                    : requiresHumanAccount
                      ? t("inviteAuth.chooseMethod")
                      : inviteT("inviteUi.accountReady")}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-zinc-800 p-3">
                <div className="text-xs uppercase tracking-(--tracking-caps) text-zinc-500">{inviteT("inviteUi.organization")}</div>
                <div className="mt-1 text-sm text-zinc-100">{companyDisplayName}</div>
              </div>
              <div className="border border-zinc-800 p-3">
                <div className="text-xs uppercase tracking-(--tracking-caps) text-zinc-500">{inviteT("inviteUi.invitedBy")}</div>
                <div className="mt-1 text-sm text-zinc-100">{invitedByUserName ?? inviteT("inviteUi.board")}</div>
              </div>
              <div className="border border-zinc-800 p-3">
                <div className="text-xs uppercase tracking-(--tracking-caps) text-zinc-500">{inviteT("inviteUi.requestedAccess")}</div>
                <div className="mt-1 text-sm text-zinc-100">
                  {showsAgentForm ? inviteT("inviteUi.agentRequest") : requestedHumanRole ?? inviteT("inviteUi.organizationAccess")}
                </div>
              </div>
              <div className="border border-zinc-800 p-3">
                <div className="text-xs uppercase tracking-(--tracking-caps) text-zinc-500">{inviteT("inviteUi.expires")}</div>
                <div className="mt-1 text-sm text-zinc-100">{formatDate(invite.expiresAt)}</div>
              </div>
            </div>

            {inviteMessage ? (
              <div className="border border-amber-500/40 bg-amber-500/10 p-4">
                <div className="text-xs uppercase tracking-(--tracking-caps) text-amber-200/80">{inviteT("inviteUi.inviterMessage")}</div>
                <p className="mt-2 text-sm leading-6 text-amber-50">{inviteMessage}</p>
              </div>
            ) : null}

            {sessionQuery.data ? (
              <div className="border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                {inviteT("inviteUi.signedIn", { account: sessionLabel })}
              </div>
            ) : null}
          </section>

          <section className={`${panelClassName} h-fit`}>
            {showsAgentForm ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">{inviteT("inviteUi.agentDetails")}</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {inviteT("inviteUi.agentDetailsHelp", { company: companyDisplayName })}
                  </p>
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-400">{inviteT("inviteUi.agentName")}</span>
                  <input
                    className={fieldClassName}
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-400">{inviteT("inviteUi.adapterType")}</span>
                  <select
                    className={fieldClassName}
                    value={adapterType}
                    onChange={(event) => setAdapterType(event.target.value as AgentAdapterType)}
                  >
                    {joinAdapterOptions.map((type) => (
                      <option key={type} value={type} disabled={!ENABLED_INVITE_ADAPTERS.has(type)}>
                        {getAdapterLabel(type)}{!ENABLED_INVITE_ADAPTERS.has(type) ? inviteT("inviteUi.comingSoon") : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-400">{inviteT("inviteUi.capabilities")}</span>
                  <textarea
                    className={fieldClassName}
                    rows={4}
                    value={capabilities}
                    onChange={(event) => setCapabilities(event.target.value)}
                  />
                </label>
                {error ? <p className="text-xs text-red-400">{renderApiUiMessage(error)}</p> : null}
                <Button
                  className="w-full h-auto whitespace-normal rounded-none"
                  disabled={acceptMutation.isPending || agentName.trim().length === 0}
                  onClick={() => acceptMutation.mutate()}
                >
                  {acceptMutation.isPending ? inviteT("inviteUi.working") : joinButtonLabel}
                </Button>
              </div>
            ) : requiresHumanAccount ? (
              <InviteAuthMethods key={token} token={token} cloud={healthQuery.data?.cloud}>
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    {authMode === "sign_up" ? inviteT("inviteUi.createYourAccount") : inviteT("inviteUi.signInContinue")}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {authMode === "sign_up"
                      ? inviteT("inviteUi.createHelp", { company: companyDisplayName })
                      : inviteT("inviteUi.existingHelp")}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`${modeButtonBaseClassName} ${
                      authMode === "sign_up"
                        ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                        : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                    }`}
                    onClick={() => {
                      setAuthFeedback(null);
                      setAuthMode("sign_up");
                    }}
                  >{inviteT("inviteUi.createAccount")}</button>
                  <button
                    type="button"
                    className={`${modeButtonBaseClassName} ${
                      authMode === "sign_in"
                        ? "border-zinc-100 bg-zinc-100 text-zinc-950"
                        : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                    }`}
                    onClick={() => {
                      setAuthFeedback(null);
                      setAuthMode("sign_in");
                    }}
                  >{inviteT("inviteUi.haveAccount")}</button>
                </div>

                <form
                  className="space-y-4"
                  method="post"
                  action={authMode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (authMutation.isPending) return;
                    if (!authCanSubmit) {
                      setAuthFeedback(localizedInviteFeedback("error", "required"));
                      return;
                    }
                    authMutation.mutate();
                  }}
                  data-testid="invite-inline-auth"
                >
                  {authMode === "sign_up" ? (
                    <label className="block text-sm" htmlFor="invite-name">
                      <span className="mb-1 block text-zinc-400">{inviteT("inviteUi.name")}</span>
                      <input
                        id="invite-name"
                        name="name"
                        className={fieldClassName}
                        value={name}
                        onChange={(event) => {
                          setName(event.target.value);
                          setAuthFeedback(null);
                        }}
                        autoComplete="name"
                        required
                        aria-required="true"
                        aria-invalid={authFeedback?.tone === "error" ? true : undefined}
                        aria-describedby={authFeedback ? authErrorId : undefined}
                        autoFocus
                      />
                    </label>
                  ) : null}
                  <label className="block text-sm" htmlFor="invite-email">
                    <span className="mb-1 block text-zinc-400">{inviteT("inviteUi.email")}</span>
                    <input
                      id="invite-email"
                      name="email"
                      type="email"
                      className={fieldClassName}
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setAuthFeedback(null);
                      }}
                      autoComplete="username"
                      required
                      aria-required="true"
                      aria-invalid={authFeedback?.tone === "error" ? true : undefined}
                      aria-describedby={authFeedback ? authErrorId : undefined}
                      autoFocus={authMode === "sign_in"}
                    />
                  </label>
                  <label className="block text-sm" htmlFor="invite-password">
                    <span className="mb-1 block text-zinc-400">{inviteT("inviteUi.password")}</span>
                    <input
                      id="invite-password"
                      name="password"
                      type="password"
                      className={fieldClassName}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setAuthFeedback(null);
                      }}
                      autoComplete={authMode === "sign_in" ? "current-password" : "new-password"}
                      required
                      aria-required="true"
                      aria-invalid={authFeedback?.tone === "error" ? true : undefined}
                      aria-describedby={authFeedback ? authErrorId : undefined}
                    />
                  </label>
                  {authFeedback ? (
                    <p
                      id={authErrorId}
                      role="alert"
                      className={`text-xs ${
                        authFeedback.tone === "info" ? "text-amber-300" : "text-red-400"
                      }`}
                    >
                      {authFeedback.translationKey ? inviteT(authFeedback.translationKey, authFeedback.values) : authFeedback.message}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    className="w-full h-auto whitespace-normal rounded-none"
                    disabled={authMutation.isPending}
                    aria-disabled={!authCanSubmit || authMutation.isPending}
                  >
                    {authMutation.isPending
                      ? inviteT("inviteUi.working")
                      : authMode === "sign_in"
                        ? inviteT("inviteUi.signInAndContinue")
                        : inviteT("inviteUi.createAndContinue")}
                  </Button>
                </form>

                <p className="text-xs leading-5 text-zinc-500">
                  {authMode === "sign_up"
                    ? inviteT("inviteUi.existingReminder")
                    : inviteT("inviteUi.newReminder")}
                </p>
              </div>
              </InviteAuthMethods>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {isCurrentMember
                      ? inviteT("inviteUi.alreadyMember")
                      : shouldAutoAcceptHumanInvite
                      ? inviteT("inviteUi.completing")
                      : invite.inviteType === "bootstrap_ceo"
                        ? inviteT("inviteUi.acceptBootstrap")
                        : inviteT("inviteUi.acceptOrganization")}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {shouldAutoAcceptHumanInvite
                      ? inviteT("inviteUi.granting", { company: companyDisplayName })
                      : isCurrentMember
                      ? inviteT("inviteUi.memberHelp", { company: companyDisplayName })
                      : (invite.inviteType === "bootstrap_ceo" ? inviteT("inviteUi.bootstrapHelp") : inviteT("inviteUi.acceptHelp", { company: companyDisplayName }))}
                  </p>
                </div>
                {error ? <p className="text-xs text-red-400">{renderApiUiMessage(error)}</p> : null}
                {shouldAutoAcceptHumanInvite ? (
                  <div className="text-sm text-zinc-400">
                    {acceptMutation.isPending ? inviteT("inviteUi.submitting") : inviteT("inviteUi.finishingSignIn")}
                  </div>
                ) : (
                  <Button
                    className="w-full h-auto whitespace-normal rounded-none"
                    disabled={acceptMutation.isPending}
                    onClick={() => {
                      if (isCurrentMember && invite.companyId) {
                        clearPendingInviteToken(token);
                        setSelectedCompanyId(invite.companyId, { source: "manual" });
                        navigate("/", { replace: true });
                        return;
                      }
                      acceptMutation.mutate();
                    }}
                  >
                    {acceptMutation.isPending ? inviteT("inviteUi.working") : joinButtonLabel}
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
