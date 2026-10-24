// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Rich simulation callback and dynamic control protocol.
 *
 * Provides continuous root-finding event detection, discrete step callbacks,
 * periodic control actions, state reinitialization, and invariant manifold projections.
 */

export interface SimulationStepControls {
  /** Reinitializes a state variable by index or string name. */
  reinit(varIndexOrName: number | string, newValue: number): void;
  /** Sets a parameter or input value dynamically during simulation. */
  setParameter(paramName: string, newValue: number): void;
  /** Immediately halts integration with an optional reason. */
  terminate(reason?: string): void;
  /** Rejects the current adaptive step and suggests an adjusted step size dt. */
  rejectStep(suggestedDt?: number): void;
}

export interface ContinuousCallback {
  type: "continuous";
  /** Root-finding zero-crossing indicator function g(t, y). */
  condition: (t: number, y: Float64Array) => number;
  /**
   * Crossing direction to trigger the event:
   *  -1 = positive -> negative only
   *  +1 = negative -> positive only
   *   0 = both directions (default)
   */
  direction?: -1 | 0 | 1 | undefined;
  /** Action executed when the zero-crossing root is reached. */
  affect: (t: number, y: Float64Array, controls: SimulationStepControls) => void;
}

export interface DiscreteCallback {
  type: "discrete";
  /** Condition predicate evaluated at each integration step. */
  condition: (t: number, y: Float64Array) => boolean;
  /** Action executed when the condition evaluates to true. */
  affect: (t: number, y: Float64Array, controls: SimulationStepControls) => void;
}

export interface PeriodicCallback {
  type: "periodic";
  /** Periodic time interval (seconds). */
  interval: number;
  /** Action executed on each periodic interval boundary. */
  affect: (t: number, y: Float64Array, controls: SimulationStepControls) => void;
}

export interface ManifoldProjectionCallback {
  type: "manifold";
  /** Projects the state vector onto a physical invariant manifold (e.g. unit quaternion normalization). */
  project: (t: number, y: Float64Array) => void;
}

export type IntegratorCallback = ContinuousCallback | DiscreteCallback | PeriodicCallback | ManifoldProjectionCallback;

/**
 * Internal implementation of `SimulationStepControls`.
 */
export class StepControlsImpl implements SimulationStepControls {
  public discontinuityOccurred = false;
  public terminated = false;
  public terminateReason?: string | undefined;
  public stepRejected = false;
  public suggestedDt?: number | undefined;

  constructor(
    private readonly y: Float64Array,
    private readonly stateIndexMap?: Map<string, number> | undefined,
    private readonly parameters?: Map<string, number> | undefined,
  ) {}

  reinit(varIndexOrName: number | string, newValue: number): void {
    let idx = -1;
    if (typeof varIndexOrName === "number") {
      idx = varIndexOrName;
    } else if (this.stateIndexMap) {
      idx = this.stateIndexMap.get(varIndexOrName) ?? -1;
    }
    if (idx >= 0 && idx < this.y.length) {
      this.y[idx] = newValue;
      this.discontinuityOccurred = true;
    }
  }

  setParameter(paramName: string, newValue: number): void {
    if (this.parameters) {
      this.parameters.set(paramName, newValue);
      this.discontinuityOccurred = true;
    }
  }

  terminate(reason?: string): void {
    this.terminated = true;
    this.terminateReason = reason;
  }

  rejectStep(suggestedDt?: number): void {
    this.stepRejected = true;
    this.suggestedDt = suggestedDt;
  }
}

/**
 * Manages dispatching of registered callbacks during the numerical simulation loop.
 */
export class CallbackDispatcher {
  private continuous: { cb: ContinuousCallback; prevValue: number }[] = [];
  private discrete: DiscreteCallback[] = [];
  private periodic: { cb: PeriodicCallback; nextTime: number }[] = [];
  private manifold: ManifoldProjectionCallback[] = [];
  private initialized = false;

  constructor(callbacks?: IntegratorCallback[] | undefined, startTime = 0) {
    if (!callbacks || callbacks.length === 0) return;

    for (const cb of callbacks) {
      switch (cb.type) {
        case "continuous":
          this.continuous.push({ cb, prevValue: 0 });
          break;
        case "discrete":
          this.discrete.push(cb);
          break;
        case "periodic":
          this.periodic.push({ cb, nextTime: startTime + cb.interval });
          break;
        case "manifold":
          this.manifold.push(cb);
          break;
      }
    }
  }

  get hasCallbacks(): boolean {
    return (
      this.continuous.length > 0 || this.discrete.length > 0 || this.periodic.length > 0 || this.manifold.length > 0
    );
  }

  /**
   * Evaluates callbacks after an integration step.
   *
   * @param t - Current time instant.
   * @param y - Current state vector (mutated in place by callbacks).
   * @param stateIndexMap - Map from state names to column indices in y.
   * @param parameters - Active parameters map.
   * @returns Controller object tracking termination or state reinitializations.
   */
  step(
    t: number,
    y: Float64Array,
    stateIndexMap?: Map<string, number>,
    parameters?: Map<string, number>,
  ): StepControlsImpl {
    const controls = new StepControlsImpl(y, stateIndexMap, parameters);
    if (!this.hasCallbacks) return controls;

    if (!this.initialized) {
      for (const item of this.continuous) {
        item.prevValue = item.cb.condition(t, y);
      }
      this.initialized = true;
      return controls;
    }

    // 1. Check continuous root zero-crossings
    for (const item of this.continuous) {
      const currVal = item.cb.condition(t, y);
      const prevVal = item.prevValue;
      const dir = item.cb.direction ?? 0;

      let triggered = false;
      if (dir === 0) {
        triggered = (prevVal < 0 && currVal >= 0) || (prevVal > 0 && currVal <= 0);
      } else if (dir === 1) {
        triggered = prevVal < 0 && currVal >= 0;
      } else if (dir === -1) {
        triggered = prevVal > 0 && currVal <= 0;
      }

      if (triggered) {
        item.cb.affect(t, y, controls);
        if (controls.terminated) return controls;
        item.prevValue = item.cb.condition(t, y);
      } else {
        item.prevValue = currVal;
      }
    }

    // 2. Check discrete step callbacks
    for (const cb of this.discrete) {
      if (cb.condition(t, y)) {
        cb.affect(t, y, controls);
        if (controls.terminated) return controls;
      }
    }

    // 3. Check periodic callbacks
    for (const item of this.periodic) {
      if (t >= item.nextTime - 1e-9) {
        item.cb.affect(t, y, controls);
        item.nextTime += item.cb.interval;
        if (controls.terminated) return controls;
      }
    }

    // 4. Enforce manifold projections
    for (const cb of this.manifold) {
      cb.project(t, y);
    }

    return controls;
  }
}
