// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RotundaEnvironmentId } from "./types.js";
import { getSharedRotundaAudioContext } from "./xr-session.js";

export type AmbientAccentKind = "glass-shimmer" | "birdsong" | "pneumatic" | "studio-chime" | "sonar" | "none";

export interface AmbientSoundscapeProfile {
  readonly id: RotundaEnvironmentId;
  readonly label: string;
  /** Filtered pink-noise bed filter mode. */
  readonly noiseFilterType: BiquadFilterType;
  /** Base center/cutoff frequency of the pink-noise bed (Hz). */
  readonly noiseCutoffHz: number;
  /** Filter Q factor for the pink-noise bed. */
  readonly noiseQ: number;
  /** Gain of the pink-noise bed (0..1, kept gentle for VR headphones). */
  readonly noiseGain: number;
  /** Slow LFO modulation rate (Hz) that makes the air/breeze gently breathe. */
  readonly lfoRateHz: number;
  /** Slow LFO sweep depth (Hz) applied to the pink-noise filter cutoff. */
  readonly lfoDepthHz: number;
  /** 3 warm harmonic drone sine frequencies (Hz). */
  readonly droneFrequenciesHz: readonly [number, number, number];
  /** Lowpass cutoff (Hz) softening the harmonic pad. */
  readonly droneCutoffHz: number;
  /** Gain of the harmonic drone pad (0..1). */
  readonly droneGain: number;
  /** Overall profile gain scaling (0..1). */
  readonly masterGain: number;
  /** Periodic organic micro-accent played softly in the background. */
  readonly accentKind: AmbientAccentKind;
  /** Minimum & maximum interval (ms) between periodic micro-accents. */
  readonly accentIntervalMs: readonly [number, number];
}

/**
 * Calm, non-fatiguing procedural ambient soundscapes tailored to each of the
 * 6 VR Rotunda environments. 100% synthesized via Web Audio API with zero
 * network asset fetches.
 */
export const AMBIENT_SOUNDSCAPE_PROFILES: Record<RotundaEnvironmentId, AmbientSoundscapeProfile> = {
  atrium: {
    id: "atrium",
    label: "Sunlit Glass Atrium",
    noiseFilterType: "bandpass",
    noiseCutoffHz: 460,
    noiseQ: 0.65,
    noiseGain: 0.022,
    lfoRateHz: 0.09,
    lfoDepthHz: 95,
    droneFrequenciesHz: [110, 165, 247.5],
    droneCutoffHz: 420,
    droneGain: 0.015,
    masterGain: 0.85,
    accentKind: "glass-shimmer",
    accentIntervalMs: [8000, 14000],
  },
  outdoors: {
    id: "outdoors",
    label: "Meadow Proving Pad Breeze",
    noiseFilterType: "lowpass",
    noiseCutoffHz: 410,
    noiseQ: 0.7,
    noiseGain: 0.032,
    lfoRateHz: 0.11,
    lfoDepthHz: 145,
    droneFrequenciesHz: [98, 147, 196],
    droneCutoffHz: 320,
    droneGain: 0.008,
    masterGain: 0.9,
    accentKind: "birdsong",
    accentIntervalMs: [6500, 11500],
  },
  warehouse: {
    id: "warehouse",
    label: "Calm Industrial Bay HVAC",
    noiseFilterType: "lowpass",
    noiseCutoffHz: 185,
    noiseQ: 0.6,
    noiseGain: 0.036,
    lfoRateHz: 0.06,
    lfoDepthHz: 32,
    droneFrequenciesHz: [60, 120, 180],
    droneCutoffHz: 240,
    droneGain: 0.014,
    masterGain: 0.82,
    accentKind: "pneumatic",
    accentIntervalMs: [10000, 16500],
  },
  office: {
    id: "office",
    label: "Quiet Design Studio Room Tone",
    noiseFilterType: "bandpass",
    noiseCutoffHz: 310,
    noiseQ: 0.7,
    noiseGain: 0.018,
    lfoRateHz: 0.07,
    lfoDepthHz: 45,
    droneFrequenciesHz: [146.83, 220, 293.66],
    droneCutoffHz: 480,
    droneGain: 0.012,
    masterGain: 0.8,
    accentKind: "studio-chime",
    accentIntervalMs: [11000, 18000],
  },
  "dark-lab": {
    id: "dark-lab",
    label: "Cleanroom Laminar Hum & Sonar",
    noiseFilterType: "bandpass",
    noiseCutoffHz: 520,
    noiseQ: 0.85,
    noiseGain: 0.024,
    lfoRateHz: 0.08,
    lfoDepthHz: 65,
    droneFrequenciesHz: [82.41, 123.47, 164.81],
    droneCutoffHz: 340,
    droneGain: 0.016,
    masterGain: 0.86,
    accentKind: "sonar",
    accentIntervalMs: [7500, 13000],
  },
  passthrough: {
    id: "passthrough",
    label: "MR Passthrough Whisper",
    noiseFilterType: "bandpass",
    noiseCutoffHz: 400,
    noiseQ: 0.7,
    noiseGain: 0.006,
    lfoRateHz: 0.06,
    lfoDepthHz: 20,
    droneFrequenciesHz: [110, 165, 220],
    droneCutoffHz: 280,
    droneGain: 0.003,
    masterGain: 0.35,
    accentKind: "none",
    accentIntervalMs: [15000, 22000],
  },
};

const pinkNoiseCache = new WeakMap<AudioContext, AudioBuffer>();

/**
 * Synthesizes a seamless 4-second looping pink-noise buffer using Paul Kellet's
 * 7-stage filter with a 200 ms end-to-start crossfade so the loop seam is click-free.
 */
function getSeamlessPinkNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  const cached = pinkNoiseCache.get(ctx);
  if (cached) return cached;
  try {
    const durationSec = 4;
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1024, Math.floor(sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const sample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.065;
      b6 = white * 0.115926;
      data[i] = Math.max(-1, Math.min(1, sample));
    }

    // Seamless 200 ms equal-power crossfade at the loop seam
    const fadeSamples = Math.min(Math.floor(sampleRate * 0.2), Math.floor(length / 4));
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      const tailIdx = length - fadeSamples + i;
      const head = data[i] ?? 0;
      const tail = data[tailIdx] ?? 0;
      data[i] = head * Math.sin(t * Math.PI * 0.5) + tail * Math.cos(t * Math.PI * 0.5);
    }

    pinkNoiseCache.set(ctx, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Triggers one subtle, organic background micro-accent matching the active environment.
 */
function playEnvironmentAccent(ctx: AudioContext, destination: AudioNode, kind: AmbientAccentKind): void {
  if (kind === "none") return;
  try {
    const now = ctx.currentTime;

    if (kind === "birdsong") {
      // Soft distant 2-note meadow birdsong chirp
      const notes = [2450, 2920];
      notes.forEach((baseHz, idx) => {
        const start = now + idx * 0.14;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(baseHz, start);
        osc.frequency.exponentialRampToValueAtTime(baseHz * (idx === 0 ? 1.14 : 0.92), start + 0.095);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.011, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(start);
        osc.stop(start + 0.12);
      });
      return;
    }

    if (kind === "glass-shimmer") {
      // Airy architectural glass harmonic shimmer (A5 + E6)
      for (const [hz, offset, peak] of [
        [880, 0, 0.009],
        [1318.5, 0.12, 0.006],
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(hz, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.linearRampToValueAtTime(peak, now + offset + 0.22);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 1.45);
        osc.connect(gain);
        gain.connect(destination);
        osc.start(now + offset);
        osc.stop(now + offset + 1.5);
      }
      return;
    }

    if (kind === "sonar") {
      // Quiet cleanroom telemetry ping (E5 -> B4 harmonic)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(654, now + 0.9);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.012, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(now + 1.0);
      return;
    }

    if (kind === "studio-chime") {
      // Gentle warm studio harmonic bell (D5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(587.33, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.008, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(now + 1.15);
      return;
    }

    if (kind === "pneumatic") {
      // Distant soft bay ventilation / pneumatic sigh
      const buf = getSeamlessPinkNoiseBuffer(ctx);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.setValueAtTime(2.2, now);
      filter.frequency.setValueAtTime(920, now);
      filter.frequency.exponentialRampToValueAtTime(340, now + 0.65);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.016, now + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      src.start(now);
      src.stop(now + 0.72);
    }
  } catch {
    // Web Audio unavailable or suspended — ignore silently.
  }
}

/**
 * Persistent, Quest-2-friendly procedural ambient soundscape engine for the
 * VR Engineering Rotunda. Shares the single `AudioContext` from `xr-session.ts`,
 * smoothly crossfades between environments, and cleanly releases all nodes on `dispose()`.
 */
export class RotundaAmbientSoundscape {
  private ctx: AudioContext | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;
  private lfoOsc: OscillatorNode | null = null;
  private lfoDepthGain: GainNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private profileMasterGain: GainNode | null = null;
  private muteGain: GainNode | null = null;

  private activeEnv: RotundaEnvironmentId = "atrium";
  private muted = false;
  private started = false;
  private disposed = false;
  private accentTimer: ReturnType<typeof setTimeout> | null = null;

  public start(env: RotundaEnvironmentId): void {
    if (this.disposed) return;
    this.activeEnv = env;

    const ctx = getSharedRotundaAudioContext();
    if (!ctx) return;

    if (this.started && this.ctx === ctx) {
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
      }
      this.applyProfile(AMBIENT_SOUNDSCAPE_PROFILES[env], 0.85);
      return;
    }

    try {
      const profile = AMBIENT_SOUNDSCAPE_PROFILES[env];
      const now = ctx.currentTime;

      const muteGain = ctx.createGain();
      muteGain.gain.setValueAtTime(this.muted ? 0.0001 : 1, now);
      muteGain.connect(ctx.destination);

      const profileMasterGain = ctx.createGain();
      profileMasterGain.gain.setValueAtTime(0.0001, now);
      profileMasterGain.gain.linearRampToValueAtTime(profile.masterGain, now + 0.85);
      profileMasterGain.connect(muteGain);

      // 1. Seamless looping pink-noise air/breeze bed with gentle breathing LFO
      const noiseBuf = getSeamlessPinkNoiseBuffer(ctx);
      let noiseSource: AudioBufferSourceNode | null = null;
      let noiseFilter: BiquadFilterNode | null = null;
      let noiseGain: GainNode | null = null;
      let lfoOsc: OscillatorNode | null = null;
      let lfoDepthGain: GainNode | null = null;

      if (noiseBuf) {
        noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;
        noiseSource.loop = true;

        noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = profile.noiseFilterType;
        noiseFilter.frequency.setValueAtTime(profile.noiseCutoffHz, now);
        noiseFilter.Q.setValueAtTime(profile.noiseQ, now);

        noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(profile.noiseGain, now);

        lfoOsc = ctx.createOscillator();
        lfoOsc.type = "sine";
        lfoOsc.frequency.setValueAtTime(profile.lfoRateHz, now);

        lfoDepthGain = ctx.createGain();
        lfoDepthGain.gain.setValueAtTime(profile.lfoDepthHz, now);

        lfoOsc.connect(lfoDepthGain);
        lfoDepthGain.connect(noiseFilter.frequency);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(profileMasterGain);

        noiseSource.start(now);
        lfoOsc.start(now);
      }

      // 2. Warm 3-voice harmonic pad softly low-passed so it never fatigues ears
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.setValueAtTime(profile.droneCutoffHz, now);
      droneFilter.Q.setValueAtTime(0.7, now);

      const droneGain = ctx.createGain();
      droneGain.gain.setValueAtTime(profile.droneGain, now);

      droneFilter.connect(droneGain);
      droneGain.connect(profileMasterGain);

      const detunes = [-2.5, 0, 2.8];
      const droneOscs = profile.droneFrequenciesHz.map((hz, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(hz, now);
        osc.detune.setValueAtTime(detunes[i] ?? 0, now);
        osc.connect(droneFilter);
        osc.start(now);
        return osc;
      });

      this.ctx = ctx;
      this.noiseSource = noiseSource;
      this.noiseFilter = noiseFilter;
      this.noiseGain = noiseGain;
      this.lfoOsc = lfoOsc;
      this.lfoDepthGain = lfoDepthGain;
      this.droneOscs = droneOscs;
      this.droneFilter = droneFilter;
      this.droneGain = droneGain;
      this.profileMasterGain = profileMasterGain;
      this.muteGain = muteGain;
      this.started = true;

      this.scheduleNextAccent();
    } catch {
      // Ignore environments where Web Audio nodes cannot be constructed.
    }
  }

  public setEnvironment(env: RotundaEnvironmentId): void {
    if (this.disposed) return;
    const changed = this.activeEnv !== env;
    this.activeEnv = env;
    if (!this.started || !this.ctx) return;
    this.applyProfile(AMBIENT_SOUNDSCAPE_PROFILES[env], 0.85);
    if (changed) {
      this.scheduleNextAccent();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.started || !this.ctx || !this.muteGain) return;
    try {
      const now = this.ctx.currentTime;
      this.muteGain.gain.cancelScheduledValues(now);
      this.muteGain.gain.setValueAtTime(Math.max(0.0001, this.muteGain.gain.value), now);
      this.muteGain.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, now + 0.25);
    } catch {
      // Ignore scheduling errors.
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public getActiveEnvironment(): RotundaEnvironmentId {
    return this.activeEnv;
  }

  public dispose(): void {
    this.disposed = true;
    this.started = false;
    if (this.accentTimer !== null) {
      clearTimeout(this.accentTimer);
      this.accentTimer = null;
    }
    const stopAndDisconnect = (node: { stop?: () => void; disconnect?: () => void } | null) => {
      if (!node) return;
      try {
        node.stop?.();
      } catch {
        // Already stopped
      }
      try {
        node.disconnect?.();
      } catch {
        // Already disconnected
      }
    };
    stopAndDisconnect(this.noiseSource);
    stopAndDisconnect(this.lfoOsc);
    for (const osc of this.droneOscs) {
      stopAndDisconnect(osc);
    }
    stopAndDisconnect(this.noiseFilter);
    stopAndDisconnect(this.noiseGain);
    stopAndDisconnect(this.lfoDepthGain);
    stopAndDisconnect(this.droneFilter);
    stopAndDisconnect(this.droneGain);
    stopAndDisconnect(this.profileMasterGain);
    stopAndDisconnect(this.muteGain);

    this.noiseSource = null;
    this.noiseFilter = null;
    this.noiseGain = null;
    this.lfoOsc = null;
    this.lfoDepthGain = null;
    this.droneOscs = [];
    this.droneFilter = null;
    this.droneGain = null;
    this.profileMasterGain = null;
    this.muteGain = null;
    this.ctx = null;
  }

  private applyProfile(profile: AmbientSoundscapeProfile, rampSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const end = now + Math.max(0.05, rampSec);

      if (this.noiseFilter) {
        this.noiseFilter.type = profile.noiseFilterType;
        this.noiseFilter.frequency.cancelScheduledValues(now);
        this.noiseFilter.frequency.setValueAtTime(Math.max(40, this.noiseFilter.frequency.value), now);
        this.noiseFilter.frequency.exponentialRampToValueAtTime(Math.max(40, profile.noiseCutoffHz), end);
        this.noiseFilter.Q.cancelScheduledValues(now);
        this.noiseFilter.Q.setValueAtTime(this.noiseFilter.Q.value, now);
        this.noiseFilter.Q.linearRampToValueAtTime(profile.noiseQ, end);
      }

      if (this.noiseGain) {
        this.noiseGain.gain.cancelScheduledValues(now);
        this.noiseGain.gain.setValueAtTime(Math.max(0.0001, this.noiseGain.gain.value), now);
        this.noiseGain.gain.linearRampToValueAtTime(profile.noiseGain, end);
      }

      if (this.lfoOsc) {
        this.lfoOsc.frequency.cancelScheduledValues(now);
        this.lfoOsc.frequency.setValueAtTime(Math.max(0.01, this.lfoOsc.frequency.value), now);
        this.lfoOsc.frequency.linearRampToValueAtTime(profile.lfoRateHz, end);
      }

      if (this.lfoDepthGain) {
        this.lfoDepthGain.gain.cancelScheduledValues(now);
        this.lfoDepthGain.gain.setValueAtTime(this.lfoDepthGain.gain.value, now);
        this.lfoDepthGain.gain.linearRampToValueAtTime(profile.lfoDepthHz, end);
      }

      if (this.droneFilter) {
        this.droneFilter.frequency.cancelScheduledValues(now);
        this.droneFilter.frequency.setValueAtTime(Math.max(60, this.droneFilter.frequency.value), now);
        this.droneFilter.frequency.exponentialRampToValueAtTime(Math.max(60, profile.droneCutoffHz), end);
      }

      if (this.droneGain) {
        this.droneGain.gain.cancelScheduledValues(now);
        this.droneGain.gain.setValueAtTime(Math.max(0.0001, this.droneGain.gain.value), now);
        this.droneGain.gain.linearRampToValueAtTime(profile.droneGain, end);
      }

      this.droneOscs.forEach((osc, i) => {
        const targetHz = profile.droneFrequenciesHz[i] ?? profile.droneFrequenciesHz[0];
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setValueAtTime(Math.max(30, osc.frequency.value), now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, targetHz), end);
      });

      if (this.profileMasterGain) {
        this.profileMasterGain.gain.cancelScheduledValues(now);
        this.profileMasterGain.gain.setValueAtTime(Math.max(0.0001, this.profileMasterGain.gain.value), now);
        this.profileMasterGain.gain.linearRampToValueAtTime(profile.masterGain, end);
      }
    } catch {
      // Ignore scheduling errors.
    }
  }

  private scheduleNextAccent(): void {
    if (this.accentTimer !== null) {
      clearTimeout(this.accentTimer);
      this.accentTimer = null;
    }
    if (this.disposed || !this.started) return;

    const profile = AMBIENT_SOUNDSCAPE_PROFILES[this.activeEnv];
    if (profile.accentKind === "none") return;

    const [minMs, maxMs] = profile.accentIntervalMs;
    const delayMs = minMs + Math.random() * Math.max(0, maxMs - minMs);

    this.accentTimer = setTimeout(() => {
      this.accentTimer = null;
      if (this.disposed || !this.started) return;
      if (!this.muted && this.ctx && this.ctx.state === "running" && this.profileMasterGain) {
        const activeProfile = AMBIENT_SOUNDSCAPE_PROFILES[this.activeEnv];
        playEnvironmentAccent(this.ctx, this.profileMasterGain, activeProfile.accentKind);
      }
      this.scheduleNextAccent();
    }, delayMs);
  }
}
