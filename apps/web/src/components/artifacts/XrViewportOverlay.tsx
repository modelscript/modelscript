// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  enterXrSession,
  getSharedXrStore,
  playRotundaCue,
  useXrCapabilities,
  type XrCapabilities,
} from "@modelscript/editor/workbench/vr-rotunda/xr-session.js";
import { XR } from "@react-three/xr";
import React, { Suspense, useCallback, useMemo, useState } from "react";

export interface XrSceneBridgeProps {
  children: React.ReactNode;
}

/**
 * Lightweight WebXR bridge mounted inside any R3F `<Canvas>` so standalone 3D
 * CAD, FEA, CFD, Multibody, G-Code, and QIF viewers can enter headset VR/MR
 * sessions via the shared `@react-three/xr` store without disrupting desktop
 * orbit controls or thumbnail capture.
 */
export const XrSceneBridge: React.FC<XrSceneBridgeProps> = ({ children }) => {
  const store = useMemo(() => getSharedXrStore() as unknown as React.ComponentProps<typeof XR>["store"], []);
  return (
    <Suspense fallback={null}>
      <XR store={store}>
        <Suspense fallback={null}>{children}</Suspense>
      </XR>
    </Suspense>
  );
};

export interface XrViewportOverlayProps {
  /** Corner placement inside the 3D viewport container (defaults to `"bottom-right"`). */
  position?: "top-right" | "bottom-right" | undefined;
  /** Optional callback to open the full Engineering Rotunda VR workstation. */
  onOpenVrRotunda?: (() => void) | undefined;
  /** Optional style overrides for viewer-specific HUD clearance (e.g., color legends). */
  style?: React.CSSProperties | undefined;
  /** Optional override for capability detection (primarily for deterministic SSR/tests). */
  capabilitiesOverride?: Partial<XrCapabilities> | undefined;
}

/**
 * Compact, unobtrusive WebXR action pill rendered over standalone 3D artifact viewports.
 * Displays `"Enter VR"` when `immersive-vr` is supported, `"MR"` when `immersive-ar`
 * passthrough is supported, and an optional `"VR Rotunda"` handoff button.
 * Returns `null` when no actions are available so desktop browsers remain clutter-free.
 */
export const XrViewportOverlay: React.FC<XrViewportOverlayProps> = ({
  position = "bottom-right",
  onOpenVrRotunda,
  style,
  capabilitiesOverride,
}) => {
  const detectedCaps = useXrCapabilities();
  const vrSupported = capabilitiesOverride?.vrSupported ?? detectedCaps.vrSupported;
  const arSupported = capabilitiesOverride?.arSupported ?? detectedCaps.arSupported;
  const [xrError, setXrError] = useState<string | null>(null);

  const handleEnterVr = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setXrError(null);
    playRotundaCue("env");
    void enterXrSession(getSharedXrStore(), "vr").then((result) => {
      if (!result.ok && result.error) {
        setXrError(result.error);
      }
    });
  }, []);

  const handleEnterAr = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setXrError(null);
    playRotundaCue("env");
    void enterXrSession(getSharedXrStore(), "ar").then((result) => {
      if (!result.ok && result.error) {
        setXrError(result.error);
      }
    });
  }, []);

  const handleOpenRotunda = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      playRotundaCue("click");
      onOpenVrRotunda?.();
    },
    [onOpenVrRotunda],
  );

  if (!vrSupported && !arSupported && !onOpenVrRotunda) {
    return null;
  }

  const anchorStyle: React.CSSProperties =
    position === "top-right" ? { top: 12, right: 12 } : { bottom: 14, right: 14 };

  return (
    <div
      data-testid="xr-viewport-overlay"
      data-xr-position={position}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        ...anchorStyle,
        zIndex: 14,
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
        userSelect: "none",
        ...style,
      }}
    >
      {xrError && (
        <div
          role="alert"
          data-testid="xr-overlay-error"
          style={{
            padding: "4px 10px",
            borderRadius: 8,
            border: "1px solid rgba(248, 113, 113, 0.55)",
            background: "rgba(127, 29, 29, 0.92)",
            color: "#fecaca",
            fontSize: 11,
            maxWidth: 280,
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.4)",
          }}
        >
          {xrError}
        </div>
      )}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 6px",
          borderRadius: 999,
          border: "1px solid rgba(129, 140, 248, 0.35)",
          background: "rgba(9, 15, 29, 0.84)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.38)",
        }}
      >
        {vrSupported && (
          <button
            type="button"
            data-testid="xr-overlay-enter-vr"
            onClick={handleEnterVr}
            title="Enter immersive WebXR VR session"
            style={{
              border: "none",
              borderRadius: 999,
              padding: "4px 10px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.01em",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Enter VR
          </button>
        )}
        {arSupported && (
          <button
            type="button"
            data-testid="xr-overlay-enter-ar"
            onClick={handleEnterAr}
            title="Enter Mixed Reality (AR passthrough) session"
            style={{
              border: "1px solid rgba(168, 85, 247, 0.55)",
              borderRadius: 999,
              padding: "3px 9px",
              background: "rgba(88, 28, 135, 0.72)",
              color: "#f5d0fe",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            MR
          </button>
        )}
        {onOpenVrRotunda && (
          <button
            type="button"
            data-testid="xr-overlay-vr-rotunda"
            onClick={handleOpenRotunda}
            title="Open in Engineering Rotunda 3D/VR Workstation"
            style={{
              border: "1px solid rgba(56, 189, 248, 0.45)",
              borderRadius: 999,
              padding: "3px 9px",
              background: "rgba(14, 116, 144, 0.35)",
              color: "#e0f2fe",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            VR Rotunda
          </button>
        )}
      </div>
    </div>
  );
};

export default XrViewportOverlay;
