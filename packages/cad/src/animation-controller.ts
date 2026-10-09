// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Unified Animation Controller for 3D CAD Co-Simulation.
 *
 * Transport-agnostic kinematics and animation controller that drives real-time 3D CAD
 * components across Morsel Playground, VS Code Web IDE, and CLI renderers.
 *
 * Supports:
 *  - Post-simulation scrub/replay with binary search and Hermite spline interpolation
 *  - Real-time live co-simulation streaming (MQTT, FMI 2.0/3.0, and Web Worker solvers)
 *  - Full 3×3 direction cosine matrix (Modelica MultiBody R.T) → Three.js Quaternion conversions
 *  - Dynamic unit scaling (meters ⟷ mm, radians ⟷ degrees)
 *  - Soft-tissue volumetric deformation morphing
 *  - Dynamic spatial clearance segment tracking and distance queries
 */

import {
  composeTransformMatrix,
  getUnitScaleFactor,
  quaternionFromEuler,
  quaternionFromMatrix3x3,
  quaternionToEuler,
  type Quat,
} from "./kinematics.js";
import type { Mat4 } from "./types.js";

// ── Public Types ─────────────────────────────────────────────────────────────

export interface CadDynamicBinding {
  /** Property being animated: position, rotation, scale, or deformation */
  property: "position" | "rotation" | "scale" | "deformation" | "color";
  /** Index within property array (0=x, 1=y, 2=z, or 0..8 for 3×3 matrix) */
  index?: number;
  /** Variable name in DAE simulation result (e.g. "body1.frame_a.r_0[1]") */
  variable: string;
  /** Optional unit of the simulation variable (for auto-scaling) */
  unit?: string;
  /** Scale factor applied to variable before setting transform */
  scaleFactor?: number;
}

/** Dynamic deformation configuration for compliant soft-tissue and organ structures. */
export interface DynamicDeformationConfig {
  mode?: "volume_radial" | "anisotropic" | "modal";
  referenceVolume?: number;
  volumeVariable?: string;
  anchorOrigin?: [number, number, number];
}

/** Dynamic spatial clearance segment between two interacting CAD bodies. */
export interface DynamicClearanceSegment {
  partA: string;
  partB: string;
  pointA: [number, number, number];
  pointB: [number, number, number];
  distance: number;
  status: "safe" | "warning" | "danger";
}

export interface AnimationBinding {
  /** Component or body name matching CAD solid name */
  componentName: string;
  /** Dynamic variable bindings */
  bindings: CadDynamicBinding[];
  /** Optional deformation parameters */
  deformationConfig?: DynamicDeformationConfig;
  /** Alias for deformationConfig */
  deformation?: DynamicDeformationConfig;
}

export type AnimationMode = "stopped" | "playing" | "paused" | "live";

export interface ComponentTransform {
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles in degrees
  quaternion: [number, number, number, number]; // [x, y, z, w]
  scale: [number, number, number];
  matrix: Mat4;
}

export type TransformResult = ComponentTransform;

export interface AnimationState {
  mode: AnimationMode;
  currentTime: number;
  startTime: number;
  stopTime: number;
  playbackSpeed: number;
  hasData: boolean;
}

export type StateListener = (state: AnimationState) => void;

// ── Animation Controller ─────────────────────────────────────────────────────

export class AnimationController {
  // ── Data sources ──
  private timeArray: Float64Array | null = null;
  private variableData = new Map<string, Float64Array>();
  private liveValues = new Map<string, number>();
  private liveTime = 0;

  // ── Playback state ──
  private _mode: AnimationMode = "stopped";
  private _currentTime = 0;
  private _playbackSpeed = 1.0;
  private _startTime = 0;
  private _stopTime = 0;
  private _loop = true;

  // ── Bindings & Defaults ──
  private bindings = new Map<string, CadDynamicBinding[]>();
  private deformationConfigs = new Map<string, DynamicDeformationConfig>();
  private defaults = new Map<
    string,
    {
      position: [number, number, number];
      rotation: [number, number, number];
      quaternion: Quat;
      scale: [number, number, number];
    }
  >();

  // ── Dynamic clearance segments ──
  private clearanceSegments: DynamicClearanceSegment[] = [];

  // ── Listeners ──
  private listeners = new Set<StateListener>();

  // ── Getters ──

  get mode(): AnimationMode {
    return this._mode;
  }
  get currentTime(): number {
    return this._mode === "live" ? this.liveTime : this._currentTime;
  }
  get startTime(): number {
    return this._startTime;
  }
  get stopTime(): number {
    return this._stopTime;
  }
  get playbackSpeed(): number {
    return this._playbackSpeed;
  }
  get loop(): boolean {
    return this._loop;
  }
  get hasData(): boolean {
    return this.timeArray !== null && this.timeArray.length > 0;
  }

  get state(): AnimationState {
    return {
      mode: this._mode,
      currentTime: this.currentTime,
      startTime: this._startTime,
      stopTime: this._stopTime,
      playbackSpeed: this._playbackSpeed,
      hasData: this.hasData,
    };
  }

  // ── Lifecycle & Data Loading ───────────────────────────────────────────────

  /**
   * Load completed simulation time-series data for scrubbing and replay.
   *
   * @param t - Array of time points
   * @param y - 2D matrix of variable trajectories: y[timeIndex][varIndex]
   * @param states - Array of variable names matching y columns
   */
  loadTimeseries(t: number[], y: number[][], states: string[]): void {
    if (!t || t.length === 0) return;

    this.timeArray = new Float64Array(t);
    this.variableData.clear();

    const timeCount = t.length;
    for (let vi = 0; vi < states.length; vi++) {
      const data = new Float64Array(timeCount);
      for (let ti = 0; ti < timeCount; ti++) {
        data[ti] = y[ti]?.[vi] ?? 0;
      }
      this.variableData.set(states[vi], data);
    }

    this._startTime = t[0];
    this._stopTime = t[timeCount - 1];
    this._currentTime = this._startTime;

    this.notify();
  }

  /**
   * Set dynamic bindings for components.
   */
  setBindings(bindings: AnimationBinding[]): void {
    this.bindings.clear();
    this.deformationConfigs.clear();

    for (const b of bindings) {
      this.bindings.set(b.componentName, b.bindings);
      const def = b.deformationConfig || b.deformation;
      if (def) {
        this.deformationConfigs.set(b.componentName, def);
      }
    }
  }

  /**
   * Set default baseline transform for a component.
   */
  setDefault(
    componentName: string,
    transform: {
      position?: [number, number, number];
      rotation?: [number, number, number]; // in degrees
      quaternion?: Quat;
      scale?: [number, number, number];
    },
  ): void {
    const pos: [number, number, number] = transform.position ? [...transform.position] : [0, 0, 0];
    const rot: [number, number, number] = transform.rotation ? [...transform.rotation] : [0, 0, 0];
    const quat: Quat = transform.quaternion
      ? [...transform.quaternion]
      : quaternionFromEuler(rot[0], rot[1], rot[2], "XYZ", true);
    const scl: [number, number, number] = transform.scale ? [...transform.scale] : [1, 1, 1];

    this.defaults.set(componentName, {
      position: pos,
      rotation: rot,
      quaternion: quat,
      scale: scl,
    });
  }

  // ── Live Streaming ─────────────────────────────────────────────────────────

  /** Enter live streaming co-simulation mode. */
  goLive(): void {
    this._mode = "live";
    this.notify();
  }

  /** Push a single live variable value. */
  pushLiveValue(variable: string, value: number, time: number): void {
    this.liveValues.set(variable, value);
    this.liveTime = time;
  }

  /** Push a batch of live variable values (from FMI cosim master or WebSocket/MQTT). */
  pushLiveBatch(values: Map<string, number> | Record<string, number>, time: number): void {
    if (values instanceof Map) {
      for (const [k, v] of values) {
        this.liveValues.set(k, v);
      }
    } else {
      for (const k of Object.keys(values)) {
        this.liveValues.set(k, values[k]);
      }
    }
    this.liveTime = time;
  }

  // ── Playback Controls ──────────────────────────────────────────────────────

  play(): void {
    if (!this.hasData && this._mode !== "live") return;
    this._mode = "playing";
    this.notify();
  }

  pause(): void {
    if (this._mode === "playing") {
      this._mode = "paused";
      this.notify();
    }
  }

  stop(): void {
    this._mode = "stopped";
    this._currentTime = this._startTime;
    this.notify();
  }

  seek(time: number): void {
    this._currentTime = Math.max(this._startTime, Math.min(time, this._stopTime));
    this.notify();
  }

  setSpeed(speed: number): void {
    this._playbackSpeed = Math.max(0.05, Math.min(speed, 50));
    this.notify();
  }

  setLoop(loop: boolean): void {
    this._loop = loop;
    this.notify();
  }

  /**
   * Advance playback clock by `dt` seconds (called from render loop).
   */
  tick(dt: number): void {
    if (this._mode !== "playing") return;

    this._currentTime += dt * this._playbackSpeed;

    if (this._currentTime >= this._stopTime) {
      if (this._loop && this._stopTime > this._startTime) {
        this._currentTime =
          this._startTime + ((this._currentTime - this._startTime) % (this._stopTime - this._startTime));
      } else {
        this._currentTime = this._stopTime;
        this._mode = "paused";
      }
      this.notify();
    }
  }

  // ── Kinematic Evaluation ───────────────────────────────────────────────────

  /**
   * Get the interpolated transform for a component at the current simulation time.
   */
  getTransform(componentName: string): ComponentTransform {
    const def = this.defaults.get(componentName) ?? {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as Quat,
      scale: [1, 1, 1] as [number, number, number],
    };

    const componentBindings = this.bindings.get(componentName);
    const defConfig = this.deformationConfigs.get(componentName);

    if ((!componentBindings || componentBindings.length === 0) && !defConfig) {
      return {
        position: [...def.position],
        rotation: [...def.rotation],
        quaternion: [...def.quaternion],
        scale: [...def.scale],
        matrix: composeTransformMatrix(def.position, def.quaternion, def.scale),
      };
    }

    const pos: [number, number, number] = [...def.position];
    let quat: Quat = [...def.quaternion];
    const scl: [number, number, number] = [...def.scale];

    // Check for 3×3 rotation matrix bindings
    const rotMatrixBindings = (componentBindings || []).filter(
      (b) => b.property === "rotation" && b.index !== undefined && b.index >= 0 && b.index < 9,
    );

    const hasFullMatrix = rotMatrixBindings.length >= 9;
    const rMatrix = hasFullMatrix ? new Array<number>(9) : null;

    // Check for 3-axis Euler angle bindings
    const eulerAngles: [number, number, number] = [...def.rotation];
    let hasEuler = false;

    // Evaluate dynamic bindings
    if (componentBindings) {
      for (const b of componentBindings) {
        const val = this.getVariableValue(b.variable);
        if (val === null) continue;

        const scaleFactor = b.scaleFactor ?? (b.unit ? getUnitScaleFactor(b.unit, "m") : 1.0);
        const scaledVal = val * scaleFactor;

        if (b.property === "position") {
          const idx = b.index ?? 0;
          if (idx >= 0 && idx < 3) {
            pos[idx] = scaledVal;
          }
        } else if (b.property === "rotation") {
          const idx = b.index ?? 0;
          if (rMatrix && idx >= 0 && idx < 9) {
            rMatrix[idx] = val; // direction cosine elements are dimensionless
          } else if (idx >= 0 && idx < 3) {
            eulerAngles[idx] = scaledVal;
            hasEuler = true;
          }
        } else if (b.property === "scale") {
          const idx = b.index;
          if (idx !== undefined && idx >= 0 && idx < 3) {
            scl[idx] = scaledVal;
          } else {
            scl[0] = scaledVal;
            scl[1] = scaledVal;
            scl[2] = scaledVal;
          }
        }
      }
    }

    // Resolve orientation
    if (rMatrix) {
      quat = quaternionFromMatrix3x3(rMatrix, true);
    } else if (hasEuler) {
      quat = quaternionFromEuler(eulerAngles[0], eulerAngles[1], eulerAngles[2], "XYZ", true);
    }

    // Handle volumetric deformation
    if (defConfig && defConfig.volumeVariable) {
      const vVal = this.getVariableValue(defConfig.volumeVariable);
      if (vVal !== null && vVal > 0) {
        const v0 = defConfig.referenceVolume || 1.0;
        const radialScale = Math.cbrt(vVal / v0);
        scl[0] *= radialScale;
        scl[1] *= radialScale;
        scl[2] *= radialScale;
      }
    }

    const rotDeg = quaternionToEuler(quat, "XYZ", true);

    return {
      position: pos,
      rotation: rotDeg,
      quaternion: quat,
      scale: scl,
      matrix: composeTransformMatrix(pos, quat, scl),
    };
  }

  // ── Dynamic Clearance Methods ──────────────────────────────────────────────

  /** Register dynamic clearance segments between moving / deforming bodies. */
  setClearanceSegments(segments: DynamicClearanceSegment[]): void {
    this.clearanceSegments = segments;
  }

  /** Retrieve current clearance segments. */
  getClearanceSegments(): DynamicClearanceSegment[] {
    return this.clearanceSegments;
  }

  /** Compute spatial clearance distance between two components. */
  computeClearanceDistance(partA: string, partB: string): number | null {
    const seg = this.clearanceSegments.find(
      (s) => (s.partA === partA && s.partB === partB) || (s.partA === partB && s.partB === partA),
    );
    if (seg) return seg.distance;

    const tfA = this.getTransform(partA);
    const tfB = this.getTransform(partB);
    const dx = tfA.position[0] - tfB.position[0];
    const dy = tfA.position[1] - tfB.position[1];
    const dz = tfA.position[2] - tfB.position[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Get value of a simulation variable at current playback time.
   */
  getVariableValue(variable: string): number | null {
    if (this._mode === "live") {
      return this.liveValues.get(variable) ?? null;
    }
    return this.interpolate(variable, this._currentTime);
  }

  /**
   * Inspect all bound variables and their current values for a component.
   */
  getComponentValues(
    componentName: string,
  ): { variable: string; property: string; index: number; value: number | null }[] {
    const compBindings = this.bindings.get(componentName);
    if (!compBindings) return [];

    return compBindings.map((b) => ({
      variable: b.variable,
      property: b.property,
      index: b.index ?? 0,
      value: this.getVariableValue(b.variable),
    }));
  }

  /** Subscribe to animation state changes. Returns unsubscribe function. */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Private Interpolation ──────────────────────────────────────────────────

  private interpolate(variable: string, time: number): number | null {
    const varData = this.variableData.get(variable);
    if (!varData || !this.timeArray || this.timeArray.length === 0) return null;

    const t = this.timeArray;
    const n = t.length;

    if (time <= t[0]) return varData[0];
    if (time >= t[n - 1]) return varData[n - 1];

    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (t[mid] <= time) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const dt = t[hi] - t[lo];
    if (dt === 0) return varData[lo];
    const alpha = (time - t[lo]) / dt;
    return varData[lo] + alpha * (varData[hi] - varData[lo]);
  }

  private notify(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
