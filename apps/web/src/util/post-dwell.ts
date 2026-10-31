// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimum continuous dwell time (in milliseconds) a post must remain in the
 * viewport (with >= 40% visibility and active tab) before counting as an impression.
 * Filters out rapid scroll gestures while registering deliberate viewing.
 * Defaults to 750ms, overridable via VITE_POST_DWELL_MS, process.env, or window.__MODELSCRIPT_POST_DWELL_MS__.
 */
const resolveDefaultDwellMs = (): number => {
  try {
    if (
      typeof window !== "undefined" &&
      typeof (window as unknown as { __MODELSCRIPT_POST_DWELL_MS__?: unknown }).__MODELSCRIPT_POST_DWELL_MS__ ===
        "number"
    ) {
      const wDwell = (window as unknown as { __MODELSCRIPT_POST_DWELL_MS__: number }).__MODELSCRIPT_POST_DWELL_MS__;
      if (Number.isFinite(wDwell) && wDwell >= 0) return wDwell;
    }
  } catch {}
  try {
    if (
      typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: { VITE_POST_DWELL_MS?: string } }).env?.VITE_POST_DWELL_MS
    ) {
      const v = Number((import.meta as unknown as { env: { VITE_POST_DWELL_MS: string } }).env.VITE_POST_DWELL_MS);
      if (Number.isFinite(v) && v >= 0) return v;
    }
  } catch {}
  try {
    if (typeof process !== "undefined" && process.env?.["VITE_POST_DWELL_MS"]) {
      const p = Number(process.env["VITE_POST_DWELL_MS"]);
      if (Number.isFinite(p) && p >= 0) return p;
    }
  } catch {}
  return 750;
};

export const POST_VIEW_DWELL_TIME_MS = resolveDefaultDwellMs();

export const VIEWED_POSTS_SESSION_KEY = "modelscript:viewed_post_ids";

export const viewedPostIds: Set<number> = (() => {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(VIEWED_POSTS_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set<number>(parsed.filter((id): id is number => typeof id === "number"));
        }
      }
    }
  } catch {}
  return new Set<number>();
})();

export function isPostViewedInSession(postId: number): boolean {
  return viewedPostIds.has(postId);
}

export function clearViewedPostsSession(): void {
  viewedPostIds.clear();
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(VIEWED_POSTS_SESSION_KEY);
    }
  } catch {}
}

export function markPostViewedInSession(postId: number): void {
  viewedPostIds.add(postId);
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const arr = Array.from(viewedPostIds).slice(-500);
      window.sessionStorage.setItem(VIEWED_POSTS_SESSION_KEY, JSON.stringify(arr));
    }
  } catch {}
}

export interface PostDwellOptions {
  postId: number;
  isDetail?: boolean | undefined;
  onView: () => void;
  dwellTimeMs?: number | undefined;
  threshold?: number | undefined;
}

/**
 * Sets up intersection observation and continuous dwell-time gating for a post element.
 * Returns a cleanup function that disposes the observer, timers, and event listeners.
 */
export function setupPostDwellObservation(element: HTMLElement | null, options: PostDwellOptions): () => void {
  const { postId, isDetail = false, onView, dwellTimeMs = POST_VIEW_DWELL_TIME_MS, threshold = 0.4 } = options;

  if (!postId || isPostViewedInSession(postId)) {
    return () => {};
  }

  // On direct detail view navigation, record immediately without dwell delay
  if (isDetail || typeof IntersectionObserver === "undefined" || !element) {
    markPostViewedInSession(postId);
    onView();
    return () => {};
  }

  let dwellTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDwellTimer = () => {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (isPostViewedInSession(postId)) {
          clearDwellTimer();
          observer.disconnect();
          break;
        }

        if (entry.isIntersecting) {
          // Start dwell-time gating timer if not already running
          if (!dwellTimer) {
            dwellTimer = setTimeout(() => {
              dwellTimer = null;
              if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                return;
              }
              if (!isPostViewedInSession(postId)) {
                markPostViewedInSession(postId);
                onView();
                observer.disconnect();
              }
            }, dwellTimeMs);
          }
        } else {
          // User scrolled past before dwell threshold elapsed: cancel timer
          clearDwellTimer();
        }
      }
    },
    { threshold },
  );

  const handleVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      clearDwellTimer();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  observer.observe(element);

  return () => {
    clearDwellTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    observer.disconnect();
  };
}
