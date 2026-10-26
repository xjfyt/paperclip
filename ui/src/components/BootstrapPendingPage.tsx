import { t as gateT, useTranslation } from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import type { ReactNode } from "react";
import { Loader2, ShieldCheck, Terminal, TriangleAlert } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { BOOTSTRAP_FALLBACK_COMMAND } from "@/bootstrapSetup";
import type { AuthSession } from "@paperclipai/shared";
import { Card } from "@/components/ui/card";

type BootstrapPendingPageProps = {
  claimAvailable: boolean;
  hasActiveInvite?: boolean;
  session: AuthSession | null | undefined;
  claimState: "idle" | "claiming" | "success";
  claimError?: { status?: number; message?: string } | null;
  onClaim: () => void;
  onSwitchAccount?: () => void;
  switchingAccount?: boolean;
  signOutFailed?: boolean;
};

function CliFallback({ hasActiveInvite = false }: { hasActiveInvite?: boolean }) {
  useTranslation();
  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Terminal className="size-4 text-muted-foreground" aria-hidden />
        <span>{gateT("authGate.hostSetup")}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasActiveInvite
          ? gateT("authGate.activeInvite")
          : gateT("authGate.hostCommand")}
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
{BOOTSTRAP_FALLBACK_COMMAND}
      </pre>
    </div>
  );
}

function StateChrome({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Card className="block p-6"><div className="mb-4 flex justify-end"><LanguageSelector /></div>{children}</Card>
    </div>
  );
}

function displayIdentity(session: AuthSession) {
  return session.user.email || session.user.name || session.user.id;
}

function claimErrorCopy(error: BootstrapPendingPageProps["claimError"]) {
  if (error?.status === 409) {
    return {
      title: gateT("authGate.claimed"),
      body: gateT("authGate.claimedHelp"),
    };
  }
  if (error?.status === 401) {
    return {
      title: gateT("authGate.expired"),
      body: "",
    };
  }
  return {
    title: gateT("authGate.reachFailed"),
    body: "",
  };
}

export function BootstrapPendingPage({
  claimAvailable,
  hasActiveInvite = false,
  session,
  claimState,
  claimError,
  onClaim, onSwitchAccount, switchingAccount = false, signOutFailed = false,
}: BootstrapPendingPageProps) {
  useTranslation();
  if (!claimAvailable) {
    return (
      <StateChrome>
        <h1 className="text-xl font-semibold">{gateT("authGate.waitingAdmin")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {gateT("authGate.inviteOnly")}
        </p>
        <CliFallback hasActiveInvite={hasActiveInvite} />
        <p className="mt-4 text-xs text-muted-foreground">
          {gateT("authGate.publicClaimDisabled")}
        </p>
      </StateChrome>
    );
  }

  if (claimState === "success") {
    return (
      <StateChrome>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{gateT("authGate.youAreAdmin")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {gateT("authGate.setupComplete")}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">{gateT("authGate.redirecting")}</span>
        </div>
        <div className="mt-5">
          <Button asChild variant="outline">
            <a href="/">{gateT("authGate.continue")}</a>
          </Button>
        </div>
      </StateChrome>
    );
  }

  if (!session) {
    return (
      <StateChrome>
        <h1 className="text-xl font-semibold">{gateT("authGate.finishSetup")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {gateT("authGate.signInClaim")}
        </p>
        <div className="mt-5">
          <Button asChild>
            <Link to="/auth?next=/">{gateT("authGate.signInCreate")}</Link>
          </Button>
        </div>
        <CliFallback hasActiveInvite={hasActiveInvite} />
      </StateChrome>
    );
  }

  const errorCopy = claimErrorCopy(claimError);
  const isClaiming = claimState === "claiming";
  return (
    <StateChrome>
      <h1 className="text-xl font-semibold">{gateT("authGate.finishSetup")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {gateT("authGate.claimHelp")}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={onClaim} disabled={isClaiming}>
          {isClaiming && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          {isClaiming ? gateT("authGate.claiming") : gateT("authGate.claim")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {gateT("authGate.signedIn")} <span className="font-medium text-foreground">{displayIdentity(session)}</span>
        </span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {gateT("authGate.wrongAccount")}{" "}
        <Button variant="link" className="h-auto whitespace-normal p-0" onClick={onSwitchAccount} disabled={isClaiming || switchingAccount || !onSwitchAccount}>{gateT(switchingAccount ? "authGate.signingOut" : "authGate.switchAccount")}</Button>
        .
      </p>
      {signOutFailed && <p role="alert" className="mt-2 text-sm text-destructive">{gateT("authGate.signOutError")}</p>}
      {claimError && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{errorCopy.title}</p>
            {errorCopy.body && <p className="mt-1 text-destructive/90">{errorCopy.body}</p>}
          </div>
        </div>
      )}
      <CliFallback hasActiveInvite={hasActiveInvite} />
    </StateChrome>
  );
}
