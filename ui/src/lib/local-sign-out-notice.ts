// This is a presentation hint, never proof of authentication or IdP logout.
// Store only a fixed status in this tab: no account, URL, token or callback data.
const STORAGE_KEY = "paperclip.local-sign-out";
const LOCAL_COMPLETE = "local-complete-global-unconfirmed";
let inMemoryNotice = false;
let storageUnavailable = false;
let noticeEpoch = 0;
const listeners = new Set<() => void>();

export function hasLocalSignOutNotice(): boolean {
  if (storageUnavailable) return inMemoryNotice;
  try { return window.sessionStorage.getItem(STORAGE_KEY) === LOCAL_COMPLETE; }
  catch { return inMemoryNotice; }
}

function updateNotice(show: boolean) {
  if (show) noticeEpoch += 1;
  inMemoryNotice = show;
  try {
    if (show) window.sessionStorage.setItem(STORAGE_KEY, LOCAL_COMPLETE);
    else window.sessionStorage.removeItem(STORAGE_KEY);
    storageUnavailable = false;
  } catch { storageUnavailable = true; }
  listeners.forEach(listener => listener());
}

/** Call only after the local sign-out response explicitly reports success. */
export function rememberLocalSignOut() { updateNotice(true); }
export function clearLocalSignOutNotice() { updateNotice(false); }

/** Memory-only generation; neither this number nor session data is persisted. */
export function localSignOutNoticeEpoch(): number | null {
  return hasLocalSignOutNotice() ? noticeEpoch : null;
}

function onPageShow(event: PageTransitionEvent) {
  // BFCache can restore an old QueryClient while storage was changed by a newer
  // document. Never reuse that restored document's previous verification result.
  if (event.persisted && hasLocalSignOutNotice()) noticeEpoch += 1;
  listeners.forEach(listener => listener());
}

export function subscribeLocalSignOutNotice(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("pageshow", onPageShow);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("pageshow", onPageShow);
  };
}
