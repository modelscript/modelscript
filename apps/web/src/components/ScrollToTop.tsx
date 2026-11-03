// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { useLocation } from "react-router-dom";

export interface ScrollToTopOptions {
  smooth?: boolean | undefined;
}

/**
 * Distance in pixels over which sticky headers and tab bars transition from
 * transparent (showing the bluish top hero glow) to full frosted glass.
 */
export const STICKY_FADE_SCROLL_PX = 64;

/**
 * Updates root CSS custom properties (`--sticky-bg-mix-light` and `--sticky-bg-mix-dark`)
 * based on the current vertical scroll offset so all sticky headers and tab bars
 * smoothly transition from transparent at the top of the page to solid frosted glass.
 */
export function updateStickyScrollVars(scrollTopOverride?: number): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root || !root.style || typeof root.style.setProperty !== "function") return;

  const y =
    scrollTopOverride !== undefined
      ? scrollTopOverride
      : window.scrollY || root.scrollTop || (document.body ? document.body.scrollTop : 0) || 0;

  const progress = Math.min(1, Math.max(0, y / STICKY_FADE_SCROLL_PX));
  const lightMix = `${(progress * 88).toFixed(1)}%`;
  const darkMix = `${(progress * 85).toFixed(1)}%`;

  root.style.setProperty("--sticky-bg-mix-light", lightMix);
  root.style.setProperty("--sticky-bg-mix-dark", darkMix);

  if (progress <= 0) {
    root.style.setProperty("--backdrop-sticky-light", "none");
    root.style.setProperty("--backdrop-sticky-dark", "none");
  } else {
    const blurPx = (progress * 16).toFixed(1);
    const satLight = Math.round(100 + progress * 40);
    const satDark = Math.round(100 + progress * 60);
    root.style.setProperty("--backdrop-sticky-light", `saturate(${satLight}%) blur(${blurPx}px)`);
    root.style.setProperty("--backdrop-sticky-dark", `saturate(${satDark}%) blur(${blurPx}px)`);
  }
}

/**
 * Resets the window and document scroll position to the top.
 */
export function scrollToTop(options?: ScrollToTopOptions): void {
  if (typeof window === "undefined") return;

  const behavior = options?.smooth ? "smooth" : "instant";
  try {
    window.scrollTo({ top: 0, left: 0, behavior });
  } catch {
    window.scrollTo(0, 0);
  }

  if (document.documentElement && document.documentElement.scrollTop !== 0) {
    document.documentElement.scrollTop = 0;
  }
  if (document.body && document.body.scrollTop !== 0) {
    document.body.scrollTop = 0;
  }

  if (!options?.smooth) {
    updateStickyScrollVars(0);
  }
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Automatically moves scroll position to the top whenever navigating between pages
 * (e.g. /packages, /explore, /home, etc.), with support for anchored hash targets,
 * and drives the smooth scroll transition for sticky frosted-glass headers/tabs.
 */
export const ScrollToTop: React.FC = () => {
  const { pathname, hash } = useLocation();

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      updateStickyScrollVars();
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useIsomorphicLayoutEffect(() => {
    // Disable browser automatic scroll restoration so page transitions cleanly start at the top
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      try {
        window.history.scrollRestoration = "manual";
      } catch {
        // Ignore errors in environments where scrollRestoration is read-only
      }
    }

    if (hash) {
      const id = hash.replace(/^#/, "");
      const element = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
      if (element) {
        element.scrollIntoView();
        updateStickyScrollVars();
        return;
      }
    }

    scrollToTop({ smooth: false });

    // Re-verify on animation frame in case of lazy route chunk rendering or virtualized layout shift
    const frame =
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(() => {
            scrollToTop({ smooth: false });
          })
        : undefined;

    return () => {
      if (frame && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(frame);
      }
    };
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
