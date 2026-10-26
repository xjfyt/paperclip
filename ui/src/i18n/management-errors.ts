import { t } from "./index";

/** Preserve local keys until display; never translate opaque server messages. */
export type ManagementErrorDescriptor = string | { key: string };
export class ManagementUiError extends Error {
  constructor(readonly translationKey: string) { super(translationKey); }
}
export function describeManagementError(error: unknown, fallbackKey: string): ManagementErrorDescriptor {
  if (error instanceof ManagementUiError) return { key: error.translationKey };
  return error instanceof Error ? error.message : { key: fallbackKey };
}
export function renderManagementError(error: ManagementErrorDescriptor): string {
  return typeof error === "string" ? error : t(error.key);
}
export function managementErrorText(error: unknown, fallbackKey: string): string {
  return renderManagementError(describeManagementError(error, fallbackKey));
}
