import type { OperationPreview, RequestOperationApprovalInput } from "@paperclipai/shared";
const messages = {
  en: { title: "Data dry-run review", period: "Period", zone: "Timezone", insert: "Insert", update: "Update", noop: "Unchanged", excluded: "Outside period", review: "Review the exact field differences in the linked immutable preview.", next: "Approval only records a review. No real write runs; the target adapter contract is not implemented.", risk: "Imported snapshots are declarations, not verified source connectivity or accounting advice.", open: "Open private administrator preview" },
  "zh-CN": { title: "数据 dry-run 审核", period: "业务期间", zone: "时区", insert: "新增", update: "更新", noop: "不变", excluded: "期间外", review: "请在关联的不可变预览中核对具体字段差异。", next: "审批仅记录审核结果，不触发真实写入；目标适配合同尚未实现。", risk: "导入快照是声明，不代表来源已连接或提供会计判断。", open: "打开仅管理员可见的预览" },
  es: { title: "Revisión de simulación de datos", period: "Período", zone: "Zona horaria", insert: "Insertar", update: "Actualizar", noop: "Sin cambios", excluded: "Fuera del período", review: "Revisa las diferencias exactas de campos en la vista previa inmutable enlazada.", next: "La aprobación solo registra la revisión. No se escribe nada; falta implementar el contrato del adaptador de destino.", risk: "Las instantáneas importadas son declaraciones, no conexiones verificadas ni asesoramiento contable.", open: "Abrir vista previa privada para administradores" },
  ja: { title: "データdry-runレビュー", period: "業務期間", zone: "タイムゾーン", insert: "追加", update: "更新", noop: "変更なし", excluded: "期間外", review: "リンク先の変更不可のプレビューで各フィールドの差分を確認してください。", next: "承認はレビュー結果の記録のみです。実際の書き込みは行わず、対象アダプターの契約は未実装です。", risk: "インポートしたスナップショットは申告データであり、接続確認や会計判断を意味しません。", open: "管理者限定のプレビューを開く" },
};
export function operationApprovalPayload(id: string, companyPrefix: string, preview: OperationPreview, locale: RequestOperationApprovalInput["locale"]) {
  const m = messages[locale], c = preview.counts;
  return { title: `${m.title}: ${preview.period}`, summary: `${m.period}: ${preview.period}; ${m.zone}: ${preview.timeZone}. ${m.insert}: ${c.insert}; ${m.update}: ${c.update}; ${m.noop}: ${c.noop}; ${m.excluded}: ${c.excluded}.\n\n[${m.open}](/${encodeURIComponent(companyPrefix)}/data-operations?preview=${id})`,
    recommendedAction: m.review, nextActionOnApproval: m.next, risks: [m.risk],
    mimouseDataPreview: { schemaVersion: 1, id, previewHash: preview.previewHash, mode: "dry_run_only" } };
}
