import { useSyncExternalStore } from "react";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearLocalSignOutNotice, hasLocalSignOutNotice, subscribeLocalSignOutNotice } from "@/lib/local-sign-out-notice";

export function LocalSignOutNotice({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(subscribeLocalSignOutNotice, hasLocalSignOutNotice, () => false);
  if (!visible) return null;

  return <div className={cn("mb-4 max-w-xl space-y-2 rounded-md border border-border bg-muted p-4", className)}>
    <div role="status" className="space-y-2 text-sm">
      <p className="font-medium">{t("auth.localSignOutComplete")}</p>
      <p className="text-muted-foreground">{t("auth.globalSignOutUnconfirmed")}</p>
    </div>
    <Button type="button" variant="outline" size="sm" onClick={clearLocalSignOutNotice}>
      {t("auth.dismissSignOutNotice")}
    </Button>
  </div>;
}
