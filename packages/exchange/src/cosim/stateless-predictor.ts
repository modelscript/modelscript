// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Stateless Predictor-Corrector & Passivity Damping for Co-Simulation.
 *
 * Provides high-order polynomial input extrapolation, dynamic Aitken relaxation,
 * and interface energy dissipation injection for cyber-physical algebraic loops
 * when participants do not support state rollback (canGetAndSetState = false).
 *
 * Academic Citations:
 * - Arnold, M. (2014). Multi-rate and co-simulation methods. Oberwolfach Reports 11(1), 589-591.
 * - Stettinger, G., et al. (2014). Energy-based passivity observer and controller for
 *   co-simulation. Proceedings of the 53rd IEEE Conference on Decision and Control, 5634-5639.
 *   https://doi.org/10.1109/CDC.2014.7040270
 */

import { convertUnit, type CosimValue, type PassivityObserver, type VariableCoupling } from "./coupling.js";

/** 3-point history entry for polynomial extrapolation. */
interface HistoryPoint {
  time: number;
  value: number;
}

/** Options for configuring the stateless loop predictor. */
export interface StatelessPredictorOptions {
  /** Maximum relaxation factor under Aitken damping (default: 1.0). */
  maxRelaxation?: number | undefined;
  /** Minimum relaxation factor under Aitken damping (default: 0.1). */
  minRelaxation?: number | undefined;
  /** Whether to inject passivity damping when non-physical energy is detected (default: true). */
  enablePassivityDamping?: boolean | undefined;
}

/**
 * Predictor-corrector extrapolator for algebraic loops lacking state save/restore.
 */
export class StatelessLoopPredictor {
  private readonly history = new Map<string, HistoryPoint[]>();
  private readonly prevErrors = new Map<string, number>();
  private readonly relaxationFactors = new Map<string, number>();
  private readonly options: Required<StatelessPredictorOptions>;

  constructor(options: StatelessPredictorOptions = {}) {
    this.options = {
      maxRelaxation: options.maxRelaxation ?? 1.0,
      minRelaxation: options.minRelaxation ?? 0.1,
      enablePassivityDamping: options.enablePassivityDamping ?? true,
    };
  }

  /**
   * Predicts input values at the upcoming macro-step t + h using Adams-Bashforth-2
   * polynomial extrapolation from historical output trajectory.
   */
  predictInputs(
    couplings: readonly VariableCoupling[],
    currentOutputs: Map<string, Map<string, CosimValue>>,
    currentTime: number,
    stepSize: number,
  ): Map<string, Map<string, CosimValue>> {
    const predictedInputs = new Map<string, Map<string, CosimValue>>();

    for (const coupling of couplings) {
      const srcOutputs = currentOutputs.get(coupling.from.participantId);
      if (!srcOutputs) continue;

      let value = srcOutputs.get(coupling.from.variableName);
      if (value === undefined) continue;

      const key = `${coupling.from.participantId}.${coupling.from.variableName}`;

      if (typeof value === "number") {
        // Record history
        let hist = this.history.get(key);
        if (!hist) {
          hist = [];
          this.history.set(key, hist);
        }

        // Avoid duplicate timestamps
        if (hist.length === 0 || Math.abs(hist[hist.length - 1]!.time - currentTime) > 1e-12) {
          hist.push({ time: currentTime, value });
          if (hist.length > 5) hist.shift();
        }

        // Extrapolate value at t + h
        value = this.extrapolateValue(hist, currentTime, stepSize);

        // Auto unit conversion if applicable
        const fromUnit = coupling.from.unit;
        const toUnit = coupling.to.unit;
        if (fromUnit && toUnit && fromUnit !== toUnit) {
          value = convertUnit(value, fromUnit, toUnit);
        }
      }

      let targetInputs = predictedInputs.get(coupling.to.participantId);
      if (!targetInputs) {
        targetInputs = new Map();
        predictedInputs.set(coupling.to.participantId, targetInputs);
      }
      targetInputs.set(coupling.to.variableName, value);
    }

    return predictedInputs;
  }

  /**
   * Applies Aitken delta-squared acceleration to dynamic coupling values to stabilize
   * stiff algebraic oscillations between steps.
   */
  applyAitkenRelaxation(couplingKey: string, calculatedValue: number, previousValue: number): number {
    const error = calculatedValue - previousValue;
    const prevError = this.prevErrors.get(couplingKey);
    let omega = this.relaxationFactors.get(couplingKey) ?? 1.0;

    if (prevError !== undefined) {
      const deltaError = error - prevError;
      if (Math.abs(deltaError) > 1e-12) {
        // Aitken relaxation: omega_k = -omega_{k-1} * (prevError / deltaError)
        const computedOmega = -omega * (prevError / deltaError);
        omega = Math.max(
          this.options.minRelaxation ?? 0.1,
          Math.min(this.options.maxRelaxation ?? 1.5, Math.abs(computedOmega)),
        );
      }
    }

    this.prevErrors.set(couplingKey, error);
    this.relaxationFactors.set(couplingKey, omega);

    // Relaxed value: u_relaxed = omega * calculated + (1 - omega) * previous
    return omega * calculatedValue + (1.0 - omega) * previousValue;
  }

  private readonly previousInputs = new Map<string, number>();

  /**
   * Relaxes target input using dynamic Aitken acceleration against previous step input.
   */
  relaxInput(key: string, targetValue: number): number {
    const prev = this.previousInputs.get(key);
    if (prev === undefined) {
      this.previousInputs.set(key, targetValue);
      return targetValue;
    }
    const relaxed = this.applyAitkenRelaxation(key, targetValue, prev);
    this.previousInputs.set(key, relaxed);
    return relaxed;
  }

  /**
   * Evaluates passivity metrics and computes numerical damping correction
   * if communication discretization generated non-physical active energy.
   */
  applyPassivityCorrection(
    observer: PassivityObserver,
    time: number,
    effort: number,
    flow: number,
  ): { effortDamped: number; dampingResistance: number } {
    if (!this.options.enablePassivityDamping) {
      return { effortDamped: effort, dampingResistance: 0.0 };
    }

    // Check passivity status
    const metrics = observer.step(time, effort, flow);
    if (metrics.isPassive || metrics.energyInjectedJoules <= 0.0) {
      return { effortDamped: effort, dampingResistance: 0.0 };
    }

    // Non-physical energy injected -> compute virtual damping resistance
    // R_diss = E_injected / (flow^2 * dt + eps)
    const flowSq = flow * flow;
    const rDiss = Math.min(1e4, metrics.energyInjectedJoules / Math.max(1e-4, flowSq));
    const effortDamped = effort - rDiss * flow;

    return { effortDamped, dampingResistance: rDiss };
  }

  /**
   * Evaluates Adams-Bashforth-2 quadratic polynomial extrapolation.
   */
  private extrapolateValue(hist: HistoryPoint[], _currentTime: number, stepSize: number): number {
    const n = hist.length;
    if (n === 0) return 0.0;
    if (n === 1) return hist[0]!.value;

    const pLast = hist[n - 1]!;
    const pPrev = hist[n - 2]!;
    const dtPrev = Math.max(1e-9, pLast.time - pPrev.time);
    const d1 = (pLast.value - pPrev.value) / dtPrev;

    if (n === 2) {
      // Linear tangent extrapolation
      return pLast.value + d1 * stepSize;
    }

    // 2nd-order quadratic polynomial extrapolation using 3 points
    const pPrev2 = hist[n - 3]!;
    const dtPrev2 = Math.max(1e-9, pPrev.time - pPrev2.time);
    const d2 = (pPrev.value - pPrev2.value) / dtPrev2;
    const ddt = (d1 - d2) / ((dtPrev + dtPrev2) * 0.5);

    // Midpoint derivative correction to estimate instantaneous tangent at pLast
    const dLast = d1 + 0.5 * ddt * dtPrev;
    return pLast.value + dLast * stepSize + 0.5 * ddt * stepSize * stepSize;
  }

  /** Clear all history and predictor state. */
  clear(): void {
    this.history.clear();
    this.prevErrors.clear();
    this.relaxationFactors.clear();
    this.previousInputs.clear();
  }
}
