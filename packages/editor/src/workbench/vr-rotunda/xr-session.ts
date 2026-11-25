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
  foveation: 1,
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

export type RotundaCueKind =
  | "tick"
  | "hover"
  | "page"
  | "snap"
  | "click"
  | "env"
  | "grab"
  | "release"
  | "whoosh"
  | "magnet-lock"
  | "magnet-reject"
  | "materialize"
  | "wire-pop";

let sharedAudioCtx: AudioContext | null = null;
let sharedNoiseBuf: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  try {
    if (sharedNoiseBuf && sharedNoiseBuf.sampleRate === ctx.sampleRate) return sharedNoiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    sharedNoiseBuf = buf;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Plays a subtle, muted procedural micro-audio cue (mechanical detent tick, orbital page whoosh,
 * glass click, environment shimmer, magnetic wire latch, force-pull whoosh, or 3D component materialization chime)
 * using Web Audio API with zero asset downloads. Silently no-ops in headless/SSR or when autoplay is locked.
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

    if (kind === "whoosh") {
      const noiseBuf = getNoiseBuffer(sharedAudioCtx);
      if (noiseBuf) {
        const src = sharedAudioCtx.createBufferSource();
        src.buffer = noiseBuf;
        const filter = sharedAudioCtx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.setValueAtTime(1.8, now);
        filter.frequency.setValueAtTime(320, now);
        filter.frequency.exponentialRampToValueAtTime(1650, now + 0.14);
        const gain = sharedAudioCtx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.055, now + 0.045);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        src.start(now);
        src.stop(now + 0.2);
        return;
      }
    }

    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    switch (kind) {
      case "hover": {
        osc.type = "sine";
        osc.frequency.setValueAtTime(1180, now);
        osc.frequency.exponentialRampToValueAtTime(840, now + 0.014);
        gain.gain.setValueAtTime(0.012, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
        osc.start(now);
        osc.stop(now + 0.02);
        break;
      }
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
      case "grab": {
        // Tactile physical latch: quick woody/metallic pop + upward confirmation chirp
        osc.type = "triangle";
        osc.frequency.setValueAtTime(310, now);
        osc.frequency.exponentialRampToValueAtTime(540, now + 0.032);
        gain.gain.setValueAtTime(0.038, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.042);
        osc.start(now);
        osc.stop(now + 0.048);
        const pop = sharedAudioCtx.createOscillator();
        const popGain = sharedAudioCtx.createGain();
        pop.connect(popGain);
        popGain.connect(sharedAudioCtx.destination);
        pop.type = "sine";
        pop.frequency.setValueAtTime(140, now);
        pop.frequency.exponentialRampToValueAtTime(65, now + 0.024);
        popGain.gain.setValueAtTime(0.045, now);
        popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
        pop.start(now);
        pop.stop(now + 0.032);
        break;
      }
      case "release": {
        osc.type = "sine";
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(250, now + 0.042);
        gain.gain.setValueAtTime(0.028, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.048);
        osc.start(now);
        osc.stop(now + 0.052);
        break;
      }
      case "magnet-lock": {
        // Neodymium connector click: sharp low clack + crisp fifth harmonic lock chime
        osc.type = "sine";
        osc.frequency.setValueAtTime(740, now);
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.055);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
        osc.start(now);
        osc.stop(now + 0.08);
        const osc2 = sharedAudioCtx.createOscillator();
        const gain2 = sharedAudioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(sharedAudioCtx.destination);
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(1480, now + 0.008);
        osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.062);
        gain2.gain.setValueAtTime(0.022, now + 0.008);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);
        osc2.start(now + 0.008);
        osc2.stop(now + 0.078);
        const clack = sharedAudioCtx.createOscillator();
        const clackGain = sharedAudioCtx.createGain();
        clack.connect(clackGain);
        clackGain.connect(sharedAudioCtx.destination);
        clack.type = "square";
        clack.frequency.setValueAtTime(220, now);
        clack.frequency.exponentialRampToValueAtTime(90, now + 0.015);
        clackGain.gain.setValueAtTime(0.025, now);
        clackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
        clack.start(now);
        clack.stop(now + 0.02);
        break;
      }
      case "magnet-reject": {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(195, now);
        osc.frequency.exponentialRampToValueAtTime(142, now + 0.075);
        gain.gain.setValueAtTime(0.022, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
        osc.start(now);
        osc.stop(now + 0.09);
        break;
      }
      case "materialize": {
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.055);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.036, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.16);
        const shimmer = sharedAudioCtx.createOscillator();
        const shimmerGain = sharedAudioCtx.createGain();
        shimmer.connect(shimmerGain);
        shimmerGain.connect(sharedAudioCtx.destination);
        shimmer.type = "triangle";
        shimmer.frequency.setValueAtTime(1320, now + 0.04);
        shimmer.frequency.exponentialRampToValueAtTime(1760, now + 0.13);
        shimmerGain.gain.setValueAtTime(0.018, now + 0.04);
        shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        shimmer.start(now + 0.04);
        shimmer.stop(now + 0.15);
        break;
      }
      case "wire-pop": {
        // Elastic suction unplug pop
        osc.type = "triangle";
        osc.frequency.setValueAtTime(680, now);
        osc.frequency.exponentialRampToValueAtTime(210, now + 0.045);
        gain.gain.setValueAtTime(0.036, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      }
      case "whoosh":
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

export interface XrSessionResult {
  ok: boolean;
  error?: string;
}

/**
 * Formats a WebXR session start failure into a concise, actionable user-facing message.
 */
export function formatXrSessionError(err: unknown, mode: "vr" | "ar"): string {
  const modeLabel = mode === "ar" ? "MR passthrough" : "VR";
  if (err && typeof err === "object") {
    const name = "name" in err && typeof err.name === "string" ? err.name : "";
    const message = "message" in err && typeof err.message === "string" ? err.message : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return `WebXR ${modeLabel} permission was denied or blocked by iframe policy.`;
    }
    if (name === "NotSupportedError") {
      return `WebXR ${modeLabel} is not supported on this device or browser.`;
    }
    if (name === "InvalidStateError") {
      return `A WebXR session is already active or transitioning.`;
    }
    if (message.trim()) {
      return `Unable to start ${modeLabel} session: ${message.trim()}`;
    }
  }
  return `Unable to start ${modeLabel} session. Connect a WebXR headset or open in a VR browser.`;
}

/**
 * Starts an immersive WebXR VR or AR session with structured error reporting instead of silent rejections.
 */
export async function enterXrSession(store: XRStore, mode: "vr" | "ar"): Promise<XrSessionResult> {
  try {
    const session = mode === "ar" ? await store.enterAR() : await store.enterVR();
    if (!session) {
      return {
        ok: false,
        error: `WebXR ${mode === "ar" ? "MR passthrough" : "VR"} session could not be started.`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatXrSessionError(err, mode) };
  }
}

/**
 * Cleanly terminates an active WebXR session from inside the headset or desktop HUD.
 */
export async function exitXrSession(store: XRStore): Promise<boolean> {
  try {
    const session = store.getState().session;
    if (!session) return false;
    await session.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Triggers a brief haptic pulse on active WebXR gamepad actuators if an XR session is running.
 * When `handedness` is provided, only pulses the matching hand's actuator.
 */
export function pulseXrHaptics(store: XRStore, intensity = 0.25, durationMs = 28, handedness?: "left" | "right"): void {
  try {
    const session = store.getState().session;
    if (!session) return;
    for (const source of session.inputSources) {
      if (handedness && source.handedness !== handedness) continue;
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
