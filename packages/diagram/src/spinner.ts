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

let safetyTimer: ReturnType<typeof setTimeout> | null = null;

/** Show the spinner overlay and start the safety timeout. */
export function show(): void {
  const el = document.getElementById("spinner");
  if (el) el.style.display = "block";

  // Reset the safety timer on every show() call
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(() => {
    const s = document.getElementById("spinner");
    if (s && s.style.display !== "none") {
      console.warn("[diagram] Spinner safety timeout — auto-hiding after 10s");
      s.style.display = "none";
    }
    safetyTimer = null;
  }, SAFETY_TIMEOUT_MS);
}

/** Hide the spinner overlay and clear the safety timeout. */
export function hide(): void {
  const el = document.getElementById("spinner");
  if (el) el.style.display = "none";

  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

/** Check whether the spinner is currently visible. */
export function isVisible(): boolean {
  const el = document.getElementById("spinner");
  return el ? el.style.display !== "none" : false;
}
