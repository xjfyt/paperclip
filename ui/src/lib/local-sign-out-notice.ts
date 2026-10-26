// This is a presentation hint, never proof of authentication or IdP logout.
// Store only a fixed status in this tab: no account, URL, token or callback data.
const STORAGE_KEY = "paperclip.local-sign-out";
const LOCAL_COMPLETE = "local-complete-global-unconfirmed";
let inMemoryNotice = false;
let storageUnavailable = false;
const listeners = new Set<() => void>();

export function hasLocalSignOutNotice(): boolean {
  if (storageUnavailable) return inMemoryNotice;
  try { return window.sessionStorage.getItem(STORAGE_KEY) === LOCAL_COMPLETE; }
  catch { return inMemoryNotice; }
}

function updateNotice(show: boolean) {
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

export function subscribeLocalSignOutNotice(listener: () => void): () => void {
  listeners.add(listener);
  // A restored document must reread the hint instead of retaining old UI state.
  window.addEventListener("pageshow", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("pageshow", listener);
  };
}
