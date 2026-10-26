import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { IssueRetryNowOutcome, IssueRetryNowResponse } from "@paperclipai/shared";
import { ApiError } from "../api/client";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { t, useTranslation } from "../i18n";

export type RetryNowError = {
  message: string;
  outcomeMessage: string | null;
  status: number | null;
};

function readErrorMessage(error: unknown, missingIssueError: Error): string {
  if (error === missingIssueError) return t("issueRetryUi.missingIssueId");
  if (error instanceof ApiError) {
    if (typeof error.message === "string" && error.message.trim().length > 0) return error.message;
    return t("issueRetryUi.requestFailedStatus", { status: error.status });
  }
  if (error instanceof Error && error.message) return error.message;
  return t("issueRetryUi.requestFailed");
}

// Legacy exported English labels remain compatible; rendered toast titles use translation keys.
export const RETRY_NOW_OUTCOME_HEADLINE: Record<IssueRetryNowOutcome, string> = {
  promoted: "Retry promoted",
  already_promoted: "Retry already running",
  waiting: "Retry waiting",
  no_scheduled_retry: "No scheduled retry",
  gate_suppressed: "Couldn't retry now",
};

export function useRetryNowMutation(
  issueId: string | null | undefined,
): UseMutationResult<IssueRetryNowResponse, unknown, void, unknown> & {
  lastError: RetryNowError | null;
} {
  useTranslation();
  const missingIssueError = useMemo(() => new Error("Missing issue id"), []);
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  const mutation = useMutation({
    mutationFn: () => {
      if (!issueId) throw missingIssueError;
      return issuesApi.retryScheduledRetryNow(issueId);
    },
    onSuccess: (response) => {
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId) });
      }
      if (response.outcome === "promoted") {
        pushToast({
          title: t("issueRetryUi.retryPromoted"),
          body: response.message,
          tone: "success",
        });
      } else if (response.outcome === "gate_suppressed") {
        pushToast({
          title: t("issueRetryUi.couldNotRetry"),
          body: response.message,
          tone: "error",
        });
      }
    },
    onError: (error) => {
      pushToast({
        title: t("issueRetryUi.couldNotRetry"),
        body: readErrorMessage(error, missingIssueError),
        tone: "error",
      });
    },
  });

  const reset = mutation.reset;
  const wrappedReset = useCallback(() => reset(), [reset]);

  const lastError: RetryNowError | null = (() => {
    if (mutation.error) {
      const apiError = mutation.error instanceof ApiError ? mutation.error : null;
      return {
        message: readErrorMessage(mutation.error, missingIssueError),
        outcomeMessage: null,
        status: apiError?.status ?? null,
      };
    }
    if (mutation.data && mutation.data.outcome === "gate_suppressed") {
      return {
        message: mutation.data.message,
        outcomeMessage: mutation.data.message,
        status: null,
      };
    }
    return null;
  })();

  return {
    ...mutation,
    reset: wrappedReset,
    lastError,
  } as UseMutationResult<IssueRetryNowResponse, unknown, void, unknown> & {
    lastError: RetryNowError | null;
  };
}
