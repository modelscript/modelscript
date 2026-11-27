// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * VR mode wrapper — adds WebXR VR/AR support and VS Code webview external VR handoff
 * to 3D CAD, STEP, FEA, CFD, GCode, and Multibody viewports.
 *
 * Wraps Three.js scene contents in `<XR>` from @react-three/xr and renders
 * native "Enter VR" / "Enter AR" controls when WebXR is available, or a sleek
 * "Open in VR Headset ↗" handoff button when running inside VS Code's sandboxed
 * cross-origin webview iframe.
 */

import {
  enterXrSession,
  getSharedXrStore,
  detectSandboxedIframe as sharedDetectSandboxedIframe,
} from "@modelscript/rotunda/xr-session.js";
import { XR } from "@react-three/xr";
import React, { useCallback, useEffect, useState } from "react";

type VrXrStore = ReturnType<typeof getSharedXrStore>;

/** Lazily returns the shared `@react-three/xr` store configured for `immersive-vr`, hand tracking, and foveation. */
export function getVrStore(): VrXrStore {
  return getSharedXrStore();
}

interface VsCodeWebviewApiLike {
  postMessage(message: unknown): void;
}

const VSCODE_API_CACHE_KEY = "__modelscriptVsCodeApi";

/**
 * Registers an already-acquired VS Code webview API instance on `window` so shared
 * child components (such as `ModelScript3DViewport` or `CadViewer`) can safely post
 * messages without invoking `acquireVsCodeApi()` a second time.
 */
export function registerSharedVsCodeApi(api: VsCodeWebviewApiLike | undefined): void {
  if (api && typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>)[VSCODE_API_CACHE_KEY] = api;
  }
}

/**
 * Returns the VS Code webview API if available in the current environment, caching it
 * on `window` so repeated lookups never throw "already acquired" errors.
 */
export function getSharedVsCodeApi(): VsCodeWebviewApiLike | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as Record<string, unknown> & {
    acquireVsCodeApi?: () => VsCodeWebviewApiLike;
  };
  const existing = win[VSCODE_API_CACHE_KEY] as VsCodeWebviewApiLike | undefined;
  if (existing && typeof existing.postMessage === "function") {
    return existing;
  }
  if (typeof win.acquireVsCodeApi === "function") {
    try {
      const acquired = win.acquireVsCodeApi();
      win[VSCODE_API_CACHE_KEY] = acquired;
      return acquired;
    } catch {
      // Already acquired by a parent entry point that did not call registerSharedVsCodeApi
      return undefined;
    }
  }
  return undefined;
}

/**
 * Detects whether the current window is executing inside a cross-origin or sandboxed
 * iframe (such as VS Code / VS Code for Web webviews) where `navigator.xr` is blocked.
 */
export function detectSandboxedIframe(): boolean {
  return sharedDetectSandboxedIframe();
}

export interface VrModeProps {
  children: React.ReactNode;
  enabled?: boolean | undefined;
}

export interface VrButtonProps {
  /** Triggered when launching a top-level browser WebXR VR session outside a sandboxed webview iframe. */
  onOpenExternalVr?: (() => void) | undefined;
  /** Optional callback to toggle the inline 3D Engineering Rotunda presentation mode. */
  onToggleRotunda3D?: (() => void) | undefined;
  /** Optional style overrides for the floating button container. */
  style?: React.CSSProperties | undefined;
}

interface XrSupportState {
  checked: boolean;
  vrSupported: boolean;
  arSupported: boolean;
  isSandboxed: boolean;
}

const baseButtonStyle: React.CSSProperties = {
  padding: "7px 14px",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "#fff",
  letterSpacing: "0.3px",
  transition: "transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  backdropFilter: "blur(8px)",
};

/**
 * Floating WebXR VR/AR & External VR Headset handoff overlay button group.
 *
 * - Probes `immersive-vr` and `immersive-ar` inside `useEffect` (with cancellation guard).
 * - Renders native `"Enter VR"` / `"Enter MR"` when WebXR is natively available.
 * - Renders `"Open in Browser for VR ↗"` when inside a sandboxed VS Code webview iframe
 *   (or when WebXR is unavailable) and `onOpenExternalVr` is provided.
 */
export function VrButton({ onOpenExternalVr, onToggleRotunda3D, style }: VrButtonProps = {}) {
  const [xrState, setXrState] = useState<XrSupportState>(() => ({
    checked: false,
    vrSupported: false,
    arSupported: false,
    isSandboxed: detectSandboxedIframe(),
  }));
  const [xrError, setXrError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isSandboxed = detectSandboxedIframe();

    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const xr = nav && "xr" in nav ? nav.xr : undefined;

    if (!xr || typeof xr.isSessionSupported !== "function") {
      setXrState({
        checked: true,
        vrSupported: false,
        arSupported: false,
        isSandboxed,
      });
      return;
    }

    void Promise.all([
      xr.isSessionSupported("immersive-vr").catch(() => false),
      xr.isSessionSupported("immersive-ar").catch(() => false),
    ]).then(([vr, ar]) => {
      if (!cancelled) {
        setXrState({
          checked: true,
          vrSupported: Boolean(vr),
          arSupported: Boolean(ar),
          isSandboxed,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLaunchXr = useCallback((mode: "vr" | "ar") => {
    setXrError(null);
    void enterXrSession(getVrStore(), mode).then((result) => {
      if (!result.ok && result.error) {
        setXrError(result.error);
      }
    });
  }, []);

  const canEnterNativeVr = !xrState.isSandboxed && xrState.vrSupported;
  const canEnterNativeAr = !xrState.isSandboxed && xrState.arSupported;
  const showExternalVr =
    Boolean(onOpenExternalVr) &&
    (xrState.isSandboxed || (xrState.checked && !xrState.vrSupported && !xrState.arSupported));

  if (!canEnterNativeVr && !canEnterNativeAr && !showExternalVr && !onToggleRotunda3D) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        zIndex: 20,
        fontFamily: "system-ui, -apple-system, sans-serif",
        ...style,
      }}
    >
      {xrError && (
        <div
          role="alert"
          data-testid="vr-mode-error"
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            background: "rgba(127, 29, 29, 0.92)",
            border: "1px solid rgba(248, 113, 113, 0.55)",
            color: "#fecaca",
            fontSize: 11,
            maxWidth: 360,
            textAlign: "center",
          }}
        >
          {xrError}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {canEnterNativeVr && (
          <button
            type="button"
            onClick={() => handleLaunchXr("vr")}
            title="Enter native WebXR VR headset session"
            style={{
              ...baseButtonStyle,
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              boxShadow: "0 4px 14px rgba(102, 126, 234, 0.45)",
            }}
          >
            <span>🥽</span>
            <span>Enter VR</span>
          </button>
        )}

        {canEnterNativeAr && (
          <button
            type="button"
            onClick={() => handleLaunchXr("ar")}
            title="Enter native WebXR MR passthrough session"
            style={{
              ...baseButtonStyle,
              background: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
              boxShadow: "0 4px 14px rgba(6, 182, 212, 0.4)",
            }}
          >
            <span>✨</span>
            <span>Enter MR</span>
          </button>
        )}

        {showExternalVr && onOpenExternalVr && (
          <button
            type="button"
            onClick={onOpenExternalVr}
            title="Launch in a top-level browser tab for WebXR VR/MR headset access (bypasses VS Code webview iframe sandbox)"
            style={{
              ...baseButtonStyle,
              background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
              boxShadow: "0 4px 14px rgba(99, 102, 241, 0.45)",
            }}
          >
            <span>🥽</span>
            <span>Open in Browser for VR ↗</span>
          </button>
        )}

        {onToggleRotunda3D && (
          <button
            type="button"
            onClick={onToggleRotunda3D}
            title="Toggle 3D Engineering Rotunda view"
            style={{
              ...baseButtonStyle,
              background: "rgba(15, 23, 42, 0.82)",
              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.35)",
            }}
          >
            <span>🌐</span>
            <span>3D Rotunda</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** VR wrapper — wraps Three.js / R3F scene children in `<XR>` context. */
export default function VrMode({ children, enabled = true }: VrModeProps) {
  if (!enabled) return <React.Suspense fallback={null}>{children}</React.Suspense>;

  return (
    <React.Suspense fallback={null}>
      <XR store={getVrStore() as unknown as React.ComponentProps<typeof XR>["store"]}>
        <React.Suspense fallback={null}>{children}</React.Suspense>
      </XR>
    </React.Suspense>
  );
}
