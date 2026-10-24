// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Centralized spinner (loading indicator) management for the diagram webview.
 *
 * Provides `show()`, `hide()`, and an automatic safety timeout that auto-hides
 * the spinner if it's been visible for too long (e.g., due to a dropped message
 * or unhandled error path in the extension↔webview bridge).
 *
 * Usage:
 * ```typescript
 * import { Spinner } from "./spinner.js";
 *
 * Spinner.show();      // Shows spinner + starts safety timeout
 * Spinner.hide();      // Hides spinner + clears safety timeout
 * Spinner.isVisible(); // Check current state
 * ```
 */

/** How long (ms) the spinner is allowed to remain visible before auto-hiding. */
const SAFETY_TIMEOUT_MS = 10_000;
/** Debounce delay before making spinner visible, preventing flash on fast operations. */
const SHOW_DELAY_MS = 160;
/** Minimum time spinner remains visible once shown, preventing visual flicker. */
const MIN_DISPLAY_MS = 250;

let showTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let shownAtTimestamp = 0;
let isCurrentlyShown = false;

function clearSafetyTimer(): void {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

function resetSafetyTimer(): void {
  clearSafetyTimer();
  safetyTimer = setTimeout(() => {
    console.warn("[diagram] Spinner safety timeout — auto-hiding after 10s");
    doHide();
  }, SAFETY_TIMEOUT_MS);
}

function doHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  isCurrentlyShown = false;
  shownAtTimestamp = 0;
  clearSafetyTimer();
  const el = document.getElementById("spinner");
  if (el) {
    el.style.display = "none";
  }
}

/** Show the spinner overlay with debounce and safety timeout. */
export function show(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  // If already visible, reset safety timer and keep visible
  if (isCurrentlyShown) {
    resetSafetyTimer();
    return;
  }

  // If already debouncing, don't schedule duplicate
  if (showTimer) return;

  showTimer = setTimeout(() => {
    showTimer = null;
    const el = document.getElementById("spinner");
    if (el) {
      el.style.display = "block";
    }
    isCurrentlyShown = true;
    shownAtTimestamp = Date.now();
    resetSafetyTimer();
  }, SHOW_DELAY_MS);
}

/** Hide the spinner overlay, enforcing minimum display time to prevent flicker. */
export function hide(): void {
  // If show() was scheduled but hasn't fired yet (fast operation completed), cancel it!
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }

  // If spinner never became visible, ensure it's hidden and return immediately
  if (!isCurrentlyShown) {
    const el = document.getElementById("spinner");
    if (el) el.style.display = "none";
    clearSafetyTimer();
    return;
  }

  // If spinner is visible, enforce MIN_DISPLAY_MS so it doesn't flash off as a glitch
  const elapsed = Date.now() - shownAtTimestamp;
  const remaining = MIN_DISPLAY_MS - elapsed;

  if (remaining > 0) {
    if (!hideTimer) {
      hideTimer = setTimeout(() => {
        doHide();
      }, remaining);
    }
  } else {
    doHide();
  }
}

/** Check whether the spinner is currently visible or scheduled to become visible. */
export function isVisible(): boolean {
  return isCurrentlyShown || showTimer !== null;
}
