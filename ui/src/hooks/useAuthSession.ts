import { useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type { AuthSession } from "@paperclipai/shared";
import { authApi } from "@/api/auth";
import { queryKeys } from "@/lib/queryKeys";
import { clearLocalSignOutNotice, localSignOutNoticeEpoch, subscribeLocalSignOutNotice } from "@/lib/local-sign-out-notice";

let nextObserver = 0;
type Options = Pick<UseQueryOptions<AuthSession | null>, "enabled" | "refetchInterval" | "refetchIntervalInBackground"> & { cloud?: boolean };

/** A warm pre-logout cache is not evidence of a newly authenticated session. */
export function useAuthSession({ cloud, ...options }: Options = {}) {
  const queryClient = useQueryClient();
  const epoch = useSyncExternalStore(subscribeLocalSignOutNotice, localSignOutNoticeEpoch, () => null);
  const [observer] = useState(() => ++nextObserver);
  const verify = cloud === false && epoch !== null;
  return useQuery<AuthSession | null>({
    ...options,
    // A new observer/exit/restore gets a cache-independent request. Keep the
    // session prefix so ordinary sign-in invalidation also retries a null check.
    queryKey: verify ? [...queryKeys.auth.session, "after-sign-out", observer, epoch] : queryKeys.auth.session,
    queryFn: verify ? async ({ signal }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.auth.session, exact: true });
      if (signal.aborted || localSignOutNoticeEpoch() !== epoch) return null;
      queryClient.setQueryData(queryKeys.auth.session, null);
      const baseline = queryClient.getQueryState(queryKeys.auth.session);
      const session = await authApi.getSession();
      // Another observer, sign-in or reset can supersede this read. State
      // identity is a version fence even when reset rewinds update counters.
      if (signal.aborted || localSignOutNoticeEpoch() !== epoch
        || queryClient.getQueryState(queryKeys.auth.session) !== baseline) return null;
      queryClient.setQueryData(queryKeys.auth.session, session);
      // Only this actual fresh response can clear the notice, never cached
      // isSuccess/data or isFetchedAfterMount counters resetQueries rewinds.
      if (session) clearLocalSignOutNotice();
      return session;
    } : () => authApi.getSession(),
    retry: false,
  });
}
