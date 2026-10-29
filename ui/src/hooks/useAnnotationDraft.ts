import { useCallback, useState, type SetStateAction } from "react";

/** Keep per-resource annotation drafts when a mounted host changes documents. */
export function useAnnotationDraft<T>(scope: string, initial: T) {
  const [drafts, setDrafts] = useState<Record<string, T>>({});
  const setDraft = useCallback((value: SetStateAction<T>) => {
    setDrafts(current => ({
      ...current,
      [scope]: typeof value === "function"
        ? (value as (previous: T) => T)(current[scope] ?? initial)
        : value,
    }));
  }, [scope, initial]);
  return [drafts[scope] ?? initial, setDraft] as const;
}
