// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef, useState } from "react";

export interface UseWheelZoomOptions {
  /** Reference to the scrollable/pannable container element */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Current zoom level */
  zoom: number;
  /** Setter for zoom level */
  setZoom: React.Dispatch<React.SetStateAction<number>> | ((zoom: number | ((prev: number) => number)) => void);
  /** Optional current pan coordinates { x, y } */
  pan?: { x: number; y: number } | undefined;
  /** Optional setter for pan coordinates */
  setPan?:
    | React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
    | ((pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void)
    | undefined;
  /** Whether the viewer is currently rendered in fullscreen */
  isFullScreen?: boolean | undefined;
  /** Minimum allowed zoom multiplier (default: 0.3) */
  minZoom?: number | undefined;
  /** Maximum allowed zoom multiplier (default: 4.0) */
  maxZoom?: number | undefined;
  /** Duration in ms to display the feed scroll protection hint (default: 1800) */
  hintDurationMs?: number | undefined;
  /** Whether wheel zoom is temporarily disabled */
  disabled?: boolean | undefined;
}

export interface UseWheelZoomReturn {
  showHint: boolean;
  setShowHint: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Hook to provide smooth focal-point zoom on Control/Cmd + scroll wheel or trackpad pinch,
 * while protecting feed scrolling when embedded inside social posts.
 */
export function useWheelZoom({
  containerRef,
  zoom,
  setZoom,
  pan,
  setPan,
  isFullScreen = false,
  minZoom = 0.3,
  maxZoom = 4.0,
  hintDurationMs = 1800,
  disabled = false,
}: UseWheelZoomOptions): UseWheelZoomReturn {
  const [showHint, setShowHint] = useState(false);
  const hintTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Live mutable refs to avoid stale closures in high-frequency wheel events
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    const handleWheel = (e: WheelEvent) => {
      // Zoom gesture is triggered by Ctrl/Cmd + wheel, or anytime when in fullscreen mode.
      // Trackpad pinch gestures are converted by browsers to WheelEvent with e.ctrlKey === true.
      const isZoomGesture = e.ctrlKey || e.metaKey || isFullScreen;

      if (isZoomGesture) {
        // Prevent default browser zoom of the whole page
        e.preventDefault();
        e.stopPropagation();

        const currentZoom = zoomRef.current;
        // Clamp wheel delta to protect against trackpad inertia or high-DPI mouse spikes
        const delta = Math.max(-120, Math.min(120, e.deltaY));
        const factor = Math.exp(-delta * 0.0018);
        const nextZoom = Math.min(maxZoom, Math.max(minZoom, Number((currentZoom * factor).toFixed(3))));

        if (nextZoom === currentZoom) return;

        // Immediately update ref so consecutive rapid events don't read stale zoom
        zoomRef.current = nextZoom;
        setZoom(nextZoom);

        // Focal point zooming: shift pan offset so the coordinate under the cursor stays fixed
        if (setPan && panRef.current) {
          const rect = el.getBoundingClientRect();
          const offsetX = e.clientX - (rect.left + rect.width / 2);
          const offsetY = e.clientY - (rect.top + rect.height / 2);
          const currentPan = panRef.current;
          const ratio = nextZoom / currentZoom;
          const nextPanX = offsetX - (offsetX - currentPan.x) * ratio;
          const nextPanY = offsetY - (offsetY - currentPan.y) * ratio;

          const updatedPan = {
            x: Math.round(nextPanX),
            y: Math.round(nextPanY),
          };
          panRef.current = updatedPan;
          setPan(updatedPan);
        }
      } else {
        // Feed scroll protection: user is scrolling down the post feed without holding modifier.
        // Do NOT preventDefault — let native page scroll proceed smoothly.
        setShowHint(true);
        if (hintTimeoutRef.current) {
          clearTimeout(hintTimeoutRef.current);
        }
        hintTimeoutRef.current = setTimeout(() => {
          setShowHint(false);
        }, hintDurationMs);
      }
    };

    // Non-passive listener required to allow e.preventDefault()
    el.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
    };
  }, [containerRef, disabled, hintDurationMs, isFullScreen, maxZoom, minZoom, setPan, setZoom]);

  return { showHint, setShowHint };
}

export { ZoomHintBadge, type ZoomHintBadgeProps } from "./ZoomHintBadge";
export default useWheelZoom;
