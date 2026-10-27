import type { TFunction } from "i18next";

// Model diagnostics remain stable for existing consumers; only known UI copy
// is translated at render time. Never reinterpret an unknown diagnostic.
const messageKeys: Readonly<Record<string, string>> = {
  "Invalid name — use letters, digits and _": "invalidName",
  "Duplicate name": "duplicateName",
  "Reserved prefix — provided automatically and may be overridden": "reservedName",
  "This secret no longer exists — runs will fail until you rebind.": "missingSecret",
  "Runs will fail until re-enabled or rebound.": "disabledSecret",
  "This user secret definition no longer exists — runs will fail until you rebind.": "missingUserSecret",
  "Runs will fail until this user secret definition is re-enabled or rebound.": "disabledUserSecret",
};

export function localizeEditorMessage(message: string, t: TFunction): string {
  const key = Object.hasOwn(messageKeys, message) ? messageKeys[message] : undefined;
  return key ? t(`environmentEditorUi.${key}`) : message;
}

export function localizeSecretStatus(status: string, t: TFunction): string {
  switch (status) {
    case "disabled": return t("agentSetupSharedUi.secretDisabled");
    case "archived": return t("agentSetupSharedUi.secretArchived");
    case "deleted": return t("agentSetupSharedUi.secretDeleted");
    default: return status;
  }
}
