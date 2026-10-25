import { useTranslation } from "@/i18n";

// Display-only qualification ledger. It never changes dispatch permissions or
// promotes a configured/installed adapter to a live-tested capability.
export const capabilityNames = ["localExecution", "remoteExecution", "sessionResume", "confirmedCancellation", "toolApproval", "workspaceRoundTrip", "usageReporting"] as const;
type CapabilityName = typeof capabilityNames[number];
type Qualification = { status: "fixture" | "unsupported" | "unknown"; note: string };
export function adapterQualifications(adapterType: string): Record<CapabilityName, Qualification> {
  const unknown = (): Qualification => ({ status: "unknown", note: "notQualified" });
  const base = Object.fromEntries(capabilityNames.map(name => [name, unknown()])) as Record<CapabilityName, Qualification>;
  if (adapterType === "qoder_cn") return {
    localExecution: { status: "fixture", note: "qoderLocal" },
    remoteExecution: { status: "unsupported", note: "noRemote" },
    sessionResume: { status: "fixture", note: "qoderSession" },
    confirmedCancellation: { status: "fixture", note: "qoderStop" },
    toolApproval: { status: "unsupported", note: "noToolApproval" },
    workspaceRoundTrip: { status: "unsupported", note: "noRoundTrip" },
    usageReporting: { status: "fixture", note: "unpricedUsage" },
  };
  if (adapterType === "workbuddy") return {
    localExecution: { status: "unsupported", note: "remoteOnly" },
    remoteExecution: { status: "fixture", note: "workbuddyRemote" },
    sessionResume: { status: "fixture", note: "workbuddySession" },
    confirmedCancellation: { status: "unsupported", note: "noRemoteStop" },
    toolApproval: { status: "unsupported", note: "denyToolApproval" },
    workspaceRoundTrip: { status: "unsupported", note: "noRoundTrip" },
    usageReporting: { status: "unknown", note: "unpricedUsage" },
  };
  return base;
}
export function MimouseAdapterCapabilities({ adapterType }: { adapterType: string }) {
  const { t } = useTranslation(); const qualifications = adapterQualifications(adapterType);
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("adapterCapabilities.title")}>
    <h3 className="text-sm font-medium">{t("adapterCapabilities.title")}</h3>
    <p className="text-xs text-muted-foreground">{t("adapterCapabilities.disclaimer", { adapter: adapterType })}</p>
    <dl className="space-y-3">{capabilityNames.map(name => {
      const item = qualifications[name];
      return <div key={name} data-capability={name} data-qualification={item.status}>
        <dt className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{t(`adapterCapabilities.${name}`)}</span><span className="rounded border border-border px-2 py-0.5 text-xs">{t(`adapterCapabilities.${item.status}`)}</span></dt>
        <dd className="mt-1 text-xs text-muted-foreground">{t(`adapterCapabilities.${item.note}`)}</dd>
      </div>;
    })}</dl>
  </section>;
}
