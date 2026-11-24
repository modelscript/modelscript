// SPDX-License-Identifier: AGPL-3.0-or-later

import { createXRStore, type XRStore, type XRStoreOptions } from "@react-three/xr";
import { useEffect, useState } from "react";

/**
 * Canonical `@react-three/xr` store configuration for the Engineering Rotunda.
 *
 * Explicitly requests `"immersive-vr"` for `offerSession` (preventing `@pmndrs/xr`'s
 * `offerSession: true` default from launching Meta Quest Browser into passthrough AR),
 * and enables full Meta Quest 2 bare-hand tracking and controller pointers.
 */
export const SHARED_XR_STORE_CONFIG = {
  emulate: false,
  offerSession: "immersive-vr",
  handTracking: true,
  foveation: 0.75,
  hand: {
    model: true,
    rayPointer: true,
    touchPointer: true,
    grabPointer: true,
    teleportPointer: true,
  },
  controller: {
    model: true,
    rayPointer: true,
    grabPointer: true,
    teleportPointer: true,
  },
} as const satisfies XRStoreOptions;

let sharedXrStore: XRStore | null = null;

/**
 * Returns a lazily-created singleton `@react-three/xr` store configured for
 * immersive VR by default, full Quest 2 bare-hand tracking, controllers,
 * teleportation, and optional passthrough AR via `enterAR()`.
 */
export function getSharedXrStore(): XRStore {
  if (!sharedXrStore) {
    sharedXrStore = createXRStore(SHARED_XR_STORE_CONFIG);
  }
  return sharedXrStore;
}

export interface XrCapabilities {
  checked: boolean;
  vrSupported: boolean;
  arSupported: boolean;
  isSandboxedIframe: boolean;
}

/**
 * Detects whether the current window is inside a cross-origin or sandboxed iframe
 * (such as VS Code webviews) where `navigator.xr` is blocked by Permissions-Policy.
 */
export function detectSandboxedIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.self === window.top) return false;
    // Reading window.top.location throws in cross-origin iframes (like vscode-webview://)
    void window.top?.location.href;
    return false;
  } catch {
    return true;
  }
}

/**
 * React hook that safely probes WebXR `immersive-vr` and `immersive-ar` support inside `useEffect`
 * (never during render) and detects iframe sandboxing so UI can offer a top-level tab handoff.
 */
export function useXrCapabilities(): XrCapabilities {
  const [caps, setCaps] = useState<XrCapabilities>(() => ({
    checked: false,
    vrSupported: false,
    arSupported: false,
    isSandboxedIframe: detectSandboxedIframe(),
  }));

  useEffect(() => {
    let cancelled = false;
    const isSandboxedIframe = detectSandboxedIframe();

    if (typeof navigator === "undefined" || !("xr" in navigator) || !navigator.xr) {
      setCaps({ checked: true, vrSupported: false, arSupported: false, isSandboxedIframe });
      return;
    }

    const xr = navigator.xr;
    Promise.all([
      xr.isSessionSupported("immersive-vr").catch(() => false),
      xr.isSessionSupported("immersive-ar").catch(() => false),
    ]).then(([vr, ar]) => {
      if (!cancelled) {
        setCaps({
          checked: true,
          vrSupported: Boolean(vr),
          arSupported: Boolean(ar),
          isSandboxedIframe,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return caps;
}

export type RotundaCueKind = "tick" | "page" | "snap" | "click" | "env";

let sharedAudioCtx: AudioContext | null = null;

/**
 * Plays a subtle, muted procedural micro-audio cue (mechanical detent tick, orbital page whoosh,
 * glass click, or environment shimmer) using Web Audio API with zero asset downloads.
 * Silently no-ops in headless/SSR or when audio autoplay is locked.
 */
export function playRotundaCue(kind: RotundaCueKind): void {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume().catch(() => undefined);
    }
    const now = sharedAudioCtx.currentTime;
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    switch (kind) {
      case "tick": {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(640, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.035);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.045);
        break;
      }
      case "page": {
        osc.type = "sine";
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
        gain.gain.setValueAtTime(0.035, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      }
      case "snap": {
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1120, now + 0.05);
        gain.gain.setValueAtTime(0.028, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }
      case "env": {
        osc.type = "sine";
        osc.frequency.setValueAtTime(330, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.18);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
        break;
      }
      case "click":
      default: {
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(380, now + 0.04);
        gain.gain.setValueAtTime(0.025, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      }
    }
  } catch {
    // Audio feedback is purely optional enhancement
  }
}

/**
 * Triggers a brief haptic pulse on active WebXR gamepad actuators if an XR session is running.
 */
export function pulseXrHaptics(store: XRStore, intensity = 0.25, durationMs = 28): void {
  try {
    const session = store.getState().session;
    if (!session) return;
    for (const source of session.inputSources) {
      const actuator = source.gamepad?.hapticActuators?.[0] as
        { pulse?: (value: number, duration: number) => Promise<boolean> } | undefined;
      if (actuator && typeof actuator.pulse === "function") {
        void actuator.pulse(intensity, durationMs).catch(() => undefined);
      }
    }
  } catch {
    // Haptics are optional
  }
}
