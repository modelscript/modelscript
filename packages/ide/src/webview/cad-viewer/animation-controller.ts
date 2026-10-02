// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transport-agnostic animation controller for 3D CAD visualization.
 *
 * Manages simulation data (from post-simulation replay or live MQTT/cosim
 * streams) and exposes per-frame interpolated transforms that drive
 * Three.js object position, rotation, and scale via the CadViewer's
 * `useFrame` loop.
 *
 * Supports two primary modes:
 *   - **Replay**: scrub through completed simulation timeseries data
 *   - **Live**: stream real-time variable values from MQTT or step cosim
 */

// ── Public types ──────────────────────────────────────────────────────

/** A single dynamic binding mapping a CAD transform property to a simulation variable. */
export interface CadDynamicBinding {
  /** CAD property being animated: "position", "rotation", or "scale" */
  property: "position" | "rotation" | "scale";
  /** Index within the property array (0=x, 1=y, 2=z, or -1 for uniform scale) */
  index: number;
  /** Fully qualified simulation variable name, e.g. "body1.frame_a.r[1]" */
  variable: string;
}

/** Dynamic deformation configuration for compliant soft-tissue and organ structures. */
export interface DynamicDeformationConfig {
  /**
   * Scaling mode for soft-tissue/cavity deformations:
   * - "volume_radial": uniform scaling s = (V / V_ref)^(1/3) relative to reference volume
   * - "anisotropic": independent directional scaling along x, y, and z axes
   * - "modal": displacement along pre-computed shape modes
   */
  mode?: "volume_radial" | "anisotropic" | "modal";
  /** Reference initial volume V0 for volume_radial scaling (default: 1.0) */
  referenceVolume?: number;
  /** State variable or constant driving cavity volume V(t) */
  volumeVariable?: string;
  /** Anchor point / center of deformation */
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

/** All animation bindings for a single CAD component. */
export interface AnimationBinding {
  /** Component name matching CadComponent.name */
  componentName: string;
  /** Dynamic bindings for this component */
  bindings: CadDynamicBinding[];
  /** Optional deformation/morphing binding for soft tissue / organ plant */
  deformation?: DynamicDeformationConfig;
}

/** Animation playback mode. */
export type AnimationMode = "stopped" | "playing" | "paused" | "live";

/** Per-component transform output. */
export interface ComponentTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** Alias for ComponentTransform matching clinical studio specifications. */
export type TransformResult = ComponentTransform;

/** Animation state snapshot for UI. */
export interface AnimationState {
  mode: AnimationMode;
  currentTime: number;
  startTime: number;
  stopTime: number;
  playbackSpeed: number;
  hasData: boolean;
}

// ── Listener type ─────────────────────────────────────────────────────

type StateListener = (state: AnimationState) => void;

// ── Controller ────────────────────────────────────────────────────────

export class AnimationController {
  // ── Data sources ──
  private timeArray: Float64Array | null = null;
  /** Map from variable name → typed array of values (same length as timeArray). */
  private variableData = new Map<string, Float64Array>();
  /** Live mode: latest known value for each variable. */
  private liveValues = new Map<string, number>();
  /** Live mode: current simulation time. */
  private liveTime = 0;

  // ── Playback state ──
  private _mode: AnimationMode = "stopped";
  private _currentTime = 0;
  private _playbackSpeed = 1.0;
  private _startTime = 0;
  private _stopTime = 0;
  private _loop = true;

  // ── Bindings ──
  private bindings = new Map<string, CadDynamicBinding[]>();
  private deformations = new Map<string, DynamicDeformationConfig>();
  /** Default transforms for components (from static CAD annotations). */
  private defaults = new Map<string, ComponentTransform>();
  /** Clearance point segments */
  private clearanceSegments: DynamicClearanceSegment[] = [];

  // ── State listeners ──
  private listeners = new Set<StateListener>();

  // ── Public getters ──

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

  // ── State snapshot ──

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

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Load completed simulation results for replay.
   *
   * @param t - Array of time points
   * @param y - 2D array of variable values (y[timeIndex][varIndex])
   * @param states - Array of variable names (matching y columns)
   */
  loadTimeseries(t: number[], y: number[][], states: string[]): void {
    this.timeArray = new Float64Array(t);
    this.variableData.clear();

    // Transpose: from y[timeIndex][varIndex] to per-variable arrays
    for (let vi = 0; vi < states.length; vi++) {
      const data = new Float64Array(t.length);
      for (let ti = 0; ti < t.length; ti++) {
        data[ti] = y[ti]?.[vi] ?? 0;
      }
      this.variableData.set(states[vi], data);
    }

    this._startTime = t.length > 0 ? t[0] : 0;
    this._stopTime = t.length > 0 ? t[t.length - 1] : 0;
    this._currentTime = this._startTime;

    this.notify();
  }

  /**
   * Register animation bindings from CAD annotations.
   *
   * @param bindings - Array of component → dynamic binding mappings
   */
  setBindings(bindings: AnimationBinding[]): void {
    this.bindings.clear();
    this.deformations.clear();
    for (const b of bindings) {
      this.bindings.set(b.componentName, b.bindings);
      if (b.deformation) {
        this.deformations.set(b.componentName, b.deformation);
      }
    }
  }

  /**
   * Set the default (static) transform for a component.
   * Used as the base when no dynamic binding overrides a given axis.
   */
  setDefault(componentName: string, transform: ComponentTransform): void {
    this.defaults.set(componentName, transform);
  }

  // ── Live data ──────────────────────────────────────────────────────

  /** Push a single live variable value (MQTT / cosim). */
  pushLiveValue(variable: string, value: number, time: number): void {
    this.liveValues.set(variable, value);
    this.liveTime = time;
  }

  /** Push a batch of live variable values. */
  pushLiveBatch(values: Map<string, number>, time: number): void {
    for (const [k, v] of values) {
      this.liveValues.set(k, v);
    }
    this.liveTime = time;
  }

  // ── Playback controls ──────────────────────────────────────────────

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
    this._playbackSpeed = Math.max(0.1, Math.min(speed, 20));
    this.notify();
  }

  setLoop(loop: boolean): void {
    this._loop = loop;
    this.notify();
  }

  /** Enter live streaming mode. */
  goLive(): void {
    this._mode = "live";
    this.notify();
  }

  // ── Frame update ───────────────────────────────────────────────────

  /**
   * Advance the playback clock by `dt` seconds.
   * Called from `useFrame` in the Three.js render loop.
   *
   * @param dt - Delta time in seconds (from Three.js clock)
   */
  tick(dt: number): void {
    if (this._mode !== "playing") return;

    this._currentTime += dt * this._playbackSpeed;

    if (this._currentTime >= this._stopTime) {
      if (this._loop) {
        this._currentTime = this._startTime + (this._currentTime - this._stopTime);
      } else {
        this._currentTime = this._stopTime;
        this._mode = "paused";
      }
      this.notify();
    }
  }

  /**
   * Get the interpolated transform for a component at the current time.
   *
   * @param componentName - Name of the CAD component
   * @returns Position, rotation, and scale at the current time
   */
  getTransform(componentName: string): ComponentTransform {
    const defaultTf = this.defaults.get(componentName) ?? {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };

    const componentBindings = this.bindings.get(componentName);
    const deformation = this.deformations.get(componentName);
    if ((!componentBindings || componentBindings.length === 0) && !deformation) {
      return defaultTf;
    }

    // Start with defaults, then override bound axes
    const result: ComponentTransform = {
      position: [...defaultTf.position],
      rotation: [...defaultTf.rotation],
      scale: [...defaultTf.scale],
    };

    if (componentBindings) {
      for (const binding of componentBindings) {
        let value: number | null = null;

        if (this._mode === "live") {
          const liveVal = this.liveValues.get(binding.variable);
          if (liveVal !== undefined) value = liveVal;
        } else {
          value = this.interpolate(binding.variable, this._currentTime);
        }

        if (value !== null) {
          if (binding.property === "scale" && (binding.index < 0 || binding.index === undefined)) {
            result.scale = [value, value, value];
          } else {
            result[binding.property][binding.index] = value;
          }
        }
      }
    }

    // Apply soft-tissue / organ volume deformation if present
    if (deformation && deformation.volumeVariable) {
      let vVal: number | null = null;
      if (this._mode === "live") {
        const liveVal = this.liveValues.get(deformation.volumeVariable);
        if (liveVal !== undefined) vVal = liveVal;
      } else {
        vVal = this.interpolate(deformation.volumeVariable, this._currentTime);
      }

      if (vVal !== null && vVal > 0) {
        const v0 = deformation.referenceVolume && deformation.referenceVolume > 0 ? deformation.referenceVolume : 1.0;
        const radialScale = Math.cbrt(vVal / v0);
        result.scale = [result.scale[0] * radialScale, result.scale[1] * radialScale, result.scale[2] * radialScale];
      }
    }

    return result;
  }

  // ── Dynamic clearance vectors ───────────────────────────────────────

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
   * Get the current value of a specific simulation variable at the current time.
   * Useful for variable inspector overlays.
   */
  getVariableValue(variable: string): number | null {
    if (this._mode === "live") {
      return this.liveValues.get(variable) ?? null;
    }
    return this.interpolate(variable, this._currentTime);
  }

  /**
   * Get all bound variable names and their current values for a component.
   */
  getComponentValues(
    componentName: string,
  ): { variable: string; property: string; index: number; value: number | null }[] {
    const componentBindings = this.bindings.get(componentName);
    if (!componentBindings) return [];

    return componentBindings.map((b) => ({
      variable: b.variable,
      property: b.property,
      index: b.index,
      value: this.getVariableValue(b.variable),
    }));
  }

  // ── State listeners ────────────────────────────────────────────────

  /** Subscribe to animation state changes. Returns an unsubscribe function. */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Private ────────────────────────────────────────────────────────

  /** Interpolate a variable value at a given time using binary search + linear interpolation. */
  private interpolate(variable: string, time: number): number | null {
    const varData = this.variableData.get(variable);
    if (!varData || !this.timeArray || this.timeArray.length === 0) return null;

    const t = this.timeArray;
    const n = t.length;

    // Clamp to range
    if (time <= t[0]) return varData[0];
    if (time >= t[n - 1]) return varData[n - 1];

    // Binary search for the interval containing `time`
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

    // Linear interpolation between t[lo] and t[hi]
    const dt = t[hi] - t[lo];
    if (dt === 0) return varData[lo];
    const alpha = (time - t[lo]) / dt;
    return varData[lo] + alpha * (varData[hi] - varData[lo]);
  }

  /** Notify all listeners of state change. */
  private notify(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
