// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef } from "react";

export interface UseFocusTrapOptions {
  /** Callback invoked when the user presses Escape. */
  onEscape?: () => void;
  /** Explicit element to focus when the trap activates. Defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Whether to restore focus to the previously active element upon deactivation. Defaults to true. */
  returnFocus?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Traps keyboard Tab navigation inside a modal dialog container and optionally
 * handles the Escape key and focus restoration on close.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isActive = true,
  options: UseFocusTrapOptions = {},
): void {
  const { onEscape, initialFocusRef, returnFocus = true } = options;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive || typeof window === "undefined") return;

    // Capture the currently focused element before activating the trap
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    const container = containerRef.current;
    if (!container) return;

    // Set initial focus
    const focusTarget =
      initialFocusRef?.current || (container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? container);

    if (focusTarget && typeof focusTarget.focus === "function") {
      // Use requestAnimationFrame to ensure the modal DOM has mounted/unhidden
      requestAnimationFrame(() => {
        focusTarget.focus();
      });
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }

      if (e.key !== "Tab") return;

      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const focusableElements = Array.from(currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el.getClientRects().length > 0,
      );

      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab: if on the first element or outside the container, cycle to the last
        if (document.activeElement === firstElement || !currentContainer.contains(document.activeElement)) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on the last element, cycle to the first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      // Restore focus to the trigger element
      if (
        returnFocus &&
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === "function" &&
        document.body.contains(previousFocusRef.current)
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isActive, containerRef, onEscape, initialFocusRef, returnFocus]);
}
