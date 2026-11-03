// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef } from "react";

export interface UseClickOutsideOptions {
  /**
   * Additional refs or elements to ignore when checking for outside clicks.
   * Useful for trigger/toggle buttons so clicking them toggles cleanly.
   */
  ignoreRefs?: Array<React.RefObject<HTMLElement | null | undefined>>;
  /**
   * CSS selector for elements to ignore (e.g. '[data-menu-trigger]').
   */
  ignoreSelector?: string;
  /**
   * Whether to also trigger the callback when the user presses Escape. Defaults to true.
   */
  closeOnEscape?: boolean;
  /**
   * Whether to capture pointer events during the capture phase. Defaults to false.
   */
  capture?: boolean;
}

/**
 * Invokes `onClickOutside` when a pointerdown event occurs outside the `targetRef` container(s),
 * or when the user presses Escape. Works reliably across layout and stacking context boundaries.
 */
export function useClickOutside(
  targetRef: React.RefObject<HTMLElement | null | undefined> | Array<React.RefObject<HTMLElement | null | undefined>>,
  onClickOutside: () => void,
  isActive = true,
  options: UseClickOutsideOptions = {},
): void {
  const handlerRef = useRef(onClickOutside);
  const targetRefRef = useRef(targetRef);
  const optionsRef = useRef(options);

  useEffect(() => {
    handlerRef.current = onClickOutside;
  }, [onClickOutside]);

  useEffect(() => {
    targetRefRef.current = targetRef;
  }, [targetRef]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const capture = options.capture ?? false;
  const closeOnEscape = options.closeOnEscape ?? true;

  useEffect(() => {
    if (!isActive || typeof window === "undefined") return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const currentTarget = targetRefRef.current;
      const refs = Array.isArray(currentTarget) ? currentTarget : [currentTarget];
      for (const ref of refs) {
        if (ref.current && ref.current.contains(target)) {
          return;
        }
      }

      const currentOptions = optionsRef.current;
      const currentIgnoreRefs = currentOptions.ignoreRefs || [];
      for (const ref of currentIgnoreRefs) {
        if (ref.current && ref.current.contains(target)) {
          return;
        }
      }

      if (currentOptions.ignoreSelector && target instanceof Element && target.closest(currentOptions.ignoreSelector)) {
        return;
      }

      handlerRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === "Escape") {
        event.stopPropagation();
        handlerRef.current();
      }
    };

    document.addEventListener("mousedown", handlePointerDown, capture);
    document.addEventListener("touchstart", handlePointerDown, capture);
    if (closeOnEscape) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, capture);
      document.removeEventListener("touchstart", handlePointerDown, capture);
      if (closeOnEscape) {
        window.removeEventListener("keydown", handleKeyDown);
      }
    };
  }, [isActive, capture, closeOnEscape]);
}
