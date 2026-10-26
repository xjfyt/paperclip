import { t as qualityT, useTranslation, i18n } from "@/i18n";
import type { CostByAgent } from "@paperclipai/shared";
import { Badge } from "./ui/badge";

/** Use this group's ledger counts, never the page-wide estimate count. */
export function CostEstimateLabel({
  eventCount,
  estimatedEventCount,
}: Partial<Pick<CostByAgent, "eventCount" | "estimatedEventCount">>) {
  useTranslation();
  if (!estimatedEventCount) return null;
  const allEstimated = estimatedEventCount === eventCount;
  return (
    <Badge
      variant="outline"
      className="font-normal text-muted-foreground"
      title={qualityT("costQuality.estimateTitle", { count: estimatedEventCount })}
    >
      {allEstimated ? qualityT("costQuality.estimated") : qualityT("costQuality.partial")}
    </Badge>
  );
}
