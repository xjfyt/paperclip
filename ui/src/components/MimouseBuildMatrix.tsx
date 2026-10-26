import { MIMOUSE_BUILD_TARGETS, type MimouseBuildMatrix as BuildMatrix } from "@paperclipai/shared";
import { formatNumber, useTranslation } from "@/i18n";
export function MimouseBuildMatrix({ matrix, companyId, deliveryId, commitSha }: {
  matrix?: BuildMatrix; companyId: string; deliveryId: string; commitSha: string;
}) {
  const { t } = useTranslation();
  const matches = matrix?.schemaVersion === 1 && matrix.companyId === companyId && matrix.deliveryId === deliveryId && matrix.commitSha === commitSha;
  return <section className="space-y-3 rounded-md border border-border p-3" aria-label={t("buildMatrixUi.title")}>
    <h3 className="font-medium">{t("buildMatrixUi.title")}</h3>
    <p className="text-sm text-muted-foreground">{t("buildMatrixUi.boundary")}</p>
    {!matches ? <p role="status">{t("buildMatrixUi.unavailable")}</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        {MIMOUSE_BUILD_TARGETS.map(target => {
          const row = matrix.targets.find(item => item.platform === target.platform && item.arch === target.arch);
          return <div key={`${target.platform}/${target.arch}`} data-build-target={`${target.platform}/${target.arch}`} className="min-w-0 space-y-2 rounded-md border border-border p-3">
            <h4 className="font-medium">{({ windows: "Windows", macos: "macOS", linux: "Linux" })[target.platform]} / {target.arch}</h4>
            <p className="text-sm">{t("buildMatrixUi.blocked")}</p>
            <p className="text-xs text-muted-foreground">{t(row?.artifactEvidence === "local_bytes_hashed" ? "buildMatrixUi.hashed" : "buildMatrixUi.none")}</p>
            {(row?.blockers ?? ["manifest_missing"]).map(reason => <p key={reason} className="text-xs">{t(`buildMatrixUi.${reason}`, { defaultValue: reason })}</p>)}
            {row?.artifacts.map((item, index) => <div key={`${item.sha256}:${item.fileName}:${index}`} className="space-y-1 break-all text-xs">
              <p>{item.fileName} · {t("buildMatrixUi.size", { amount: formatNumber(item.sizeBytes) })}</p>
              <p>{t("buildMatrixUi.declaredJob", { job: item.declaredBuildJob })}</p>
              <p className="font-mono">SHA-256: {item.sha256}</p>
            </div>)}
          </div>;
        })}
      </div>
      <p className="text-sm">{t("buildMatrixUi.upload")}</p>
    </>}
  </section>;
}
