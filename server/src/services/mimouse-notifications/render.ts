export const NOTIFICATION_EVENT_TYPES = ["approval.requested", "run.failed", "coding.mr_ready", "coding.ci_failed", "coding.artifact_ready", "budget.threshold_reached"] as const;
export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];
const titles: Record<string, Record<NotificationEventType, string>> = {
  en: { "approval.requested": "Approval requested", "run.failed": "Agent run failed", "coding.mr_ready": "Merge request ready for review", "coding.ci_failed": "Coding checks failed", "coding.artifact_ready": "Artifact manifest ready", "budget.threshold_reached": "Budget threshold reached" },
  "zh-CN": { "approval.requested": "有审批待处理", "run.failed": "Agent 运行失败", "coding.mr_ready": "合并请求待审阅", "coding.ci_failed": "编码检查失败", "coding.artifact_ready": "产物清单已就绪", "budget.threshold_reached": "已达到预算阈值" },
  es: { "approval.requested": "Aprobación solicitada", "run.failed": "Falló la ejecución del agente", "coding.mr_ready": "Solicitud de fusión lista para revisión", "coding.ci_failed": "Fallaron las comprobaciones de código", "coding.artifact_ready": "Manifiesto de artefactos listo", "budget.threshold_reached": "Se alcanzó el umbral del presupuesto" },
  ja: { "approval.requested": "承認待ちの項目があります", "run.failed": "エージェントの実行に失敗しました", "coding.mr_ready": "マージリクエストのレビュー待ち", "coding.ci_failed": "コード検証に失敗しました", "coding.artifact_ready": "成果物一覧の準備ができました", "budget.threshold_reached": "予算のしきい値に達しました" },
};
const notices: Record<string, string> = { en: "Open Paperclip to review. This notification is not business approval.", "zh-CN": "请打开 Paperclip 核对；通知不代表业务已获批准。", es: "Revísalo en Paperclip. Esta notificación no constituye una aprobación.", ja: "Paperclip で確認してください。この通知は業務上の承認を意味しません。" };
export function renderNotification(type: NotificationEventType, resourceId: string, locale: string, companyPrefix: string, publicBase?: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(resourceId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(companyPrefix)) throw Error("invalid_notification_reference");
  const language = titles[locale] ? locale : "en";
  const title = titles[language][type];
  if (!title) throw Error("unsupported_notification_event");
  let detailUrl: string | undefined;
  if (publicBase) {
    const base = new URL(publicBase);
    if (base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) throw Error("invalid_notification_public_origin");
    const route = type === "approval.requested" ? `approvals/${resourceId}` : type.startsWith("coding.") ? "coding" : type === "run.failed" ? "activity" : "costs";
    detailUrl = new URL(`/${companyPrefix.toUpperCase()}/${route}`, base.origin).href;
  }
  return { title, text: `${title}\n${resourceId}\n${notices[language]}`, ...(detailUrl ? { detailUrl } : {}) };
}
