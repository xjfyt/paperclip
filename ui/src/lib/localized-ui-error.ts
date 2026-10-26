/** Keep local UI failures translatable without changing request/effect dependencies. */
export type LocalizedUiMessage = string | { key: string };

export class LocalizedUiError extends Error {
  constructor(readonly translationKey: string, fallbackMessage: string) {
    super(fallbackMessage);
  }
}

export function localizedUiErrorMessage(error: unknown, fallbackKey: string): LocalizedUiMessage {
  return error instanceof LocalizedUiError
    ? { key: error.translationKey }
    : error instanceof Error ? error.message : { key: fallbackKey };
}
