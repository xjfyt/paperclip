import { useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import type { CloudInstanceHealthStatus } from "@/api/health";
import { navigateTopLevel } from "@/lib/browserNavigation";
import { safeOidcReturnPath } from "@/lib/oidc-navigation";
import { useTranslation } from "@/i18n";
import { CloudSignIn } from "./CloudSignIn";
import { Button } from "./ui/button";

/** Only reveal password fields after the instance has explicitly advertised them. */
export function InviteAuthMethods({ token, cloud, children }: {
  token: string; cloud?: CloudInstanceHealthStatus | null; children: ReactNode;
}) {
  const { t } = useTranslation();
  const returnTo = safeOidcReturnPath(`/invite/${encodeURIComponent(token)}`);
  const currentReturnTo = useRef(returnTo); currentReturnTo.current = returnTo;
  const capabilities = useQuery({ queryKey: ["auth-capabilities"], queryFn: authApi.capabilities, enabled: !cloud, retry: false, staleTime: 0 });
  const pendingRequest = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sso = useMutation({
    mutationFn: async (path: string) => ({ path, url: await authApi.signInCasdoor(path) }),
    onSuccess: ({ path, url }) => { if (mounted.current && currentReturnTo.current === path) navigateTopLevel(url); },
    onSettled: () => { pendingRequest.current = false; },
  });
  if (cloud) return <CloudSignIn cloud={cloud} returnTo={returnTo} />;
  if (capabilities.isPending || capabilities.isFetching) return <p role="status">{t("inviteAuth.checking")}</p>;
  if (capabilities.isError || !capabilities.data) return <div><p role="alert">{t("auth.unavailable")}</p><Button onClick={() => void capabilities.refetch()}>{t("inviteAuth.retry")}</Button></div>;
  const casdoor = capabilities.data.providers.some(provider => provider.id === "casdoor");
  const password = capabilities.data.password === true;
  return <div className="space-y-5" data-testid="invite-auth-methods">
    {casdoor && <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t("inviteAuth.title")}</h2>
      <p className="text-sm text-zinc-400">{t("inviteAuth.help")}</p>
      <Button className="w-full h-auto whitespace-normal" disabled={sso.isPending} onClick={() => {
        if (pendingRequest.current) return;
        pendingRequest.current = true; sso.mutate(returnTo);
      }}>{sso.isPending ? t("auth.working") : t("auth.casdoor")}</Button>
      {sso.isError && <p role="alert">{t("auth.failed")}</p>}
    </div>}
    {password ? children : <p className="text-sm">{t(casdoor ? "inviteAuth.ssoOnly" : "inviteAuth.noMethod")}</p>}
  </div>;
}
