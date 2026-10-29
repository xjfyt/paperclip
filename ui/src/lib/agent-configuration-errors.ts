import { t } from "@/i18n";
import { LocalizedUiError } from "./localized-ui-error";

const contextErrorKeys = {
  createSecret: "agentConfigurationUi.createSecretOrganization",
  uploadImage: "agentConfigurationUi.uploadImageOrganization",
  detectModel: "agentConfigurationUi.detectModelOrganization",
} as const;

/** Local action codes, never inferred from provider text. Legacy consumers retain
 * the action-time message; descriptor-aware consumers can translate the key. */
export function agentConfigurationContextError(action: keyof typeof contextErrorKeys) {
  const key = contextErrorKeys[action];
  return new LocalizedUiError(key, t(key));
}
