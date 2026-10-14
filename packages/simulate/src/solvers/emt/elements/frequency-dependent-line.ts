// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Frequency-Dependent Transmission Line Model (FDPM).
 *
 * Implements J. Marti / Vector Fitting rational function approximations for
 * transmission lines and underground cables where high-frequency skin effect
 * and ground return frequency dependence cause wave attenuation and dispersion.
 *
 * Mathematical Formulation:
 * 1. Characteristic Admittance:
 *    Y_c(s) = Y_0 + sum_{m=1}^M [ c_m / (s - a_m) ]
 *
 * 2. Propagation Function:
 *    H(s) = sum_{k=1}^K [ r_k / (s - p_k) ] * exp(-s * tau)
 *
 * 3. Recursive Convolution / Discrete State-Space Filter:
 *    At time step Delta t, convolution integrals are evaluated recursively:
 *    x_m(t) = alpha_m * x_m(t - Delta t) + beta_m * v(t - Delta t)
 *    where alpha_m = exp(a_m * Delta t), beta_m = (c_m / a_m) * (exp(a_m * Delta t) - 1)
 */

export interface RationalPoleResidue {
  pole: number; // Real or negative real part of pole a_m
  residue: number; // Residue c_m
}

export interface FrequencyDependentLineConfig {
  id: string;
  fromNode: number;
  toNode: number;
  lengthKm: number;
  tauSec: number; // Minimal travel delay tau = length / v_wave
  y0: number; // High-frequency asymptotic surge admittance (1 / Z_inf)
  yPoles: RationalPoleResidue[]; // Poles and residues for Y_c(s)
  hPoles: RationalPoleResidue[]; // Poles and residues for propagation function H(s)
}

export interface FdLineState {
  config: FrequencyDependentLineConfig;
  delaySteps: number;
  gc: number; // Equivalent instantaneous conductance stamped into [G]
  // Recursive state vectors for sending (from) and receiving (to) terminals
  statesYFrom: Float64Array; // Dimension M
  statesYTo: Float64Array; // Dimension M
  statesHFrom: Float64Array; // Dimension K
  statesHTo: Float64Array; // Dimension K
  // Delay buffers for traveling waves a_from(t) and a_to(t)
  bufferFrom: Float64Array;
  bufferTo: Float64Array;
  bufferIdx: number;
  // History currents injected into nodal linear system [G][v] = [i] - [I_hist]
  iHistFrom: number;
  iHistTo: number;
}

/**
 * Initializes the state of a Frequency-Dependent Line Model.
 */
export function createFdLineState(config: FrequencyDependentLineConfig, dt: number): FdLineState {
  const delaySteps = Math.max(1, Math.round(config.tauSec / dt));

  // Compute instantaneous companion conductance G_c:
  // G_c = Y_0 + sum_{m=1}^M [ beta_0_m ] where beta_0_m is the trapezoidal or exact impulse response
  let gc = config.y0;
  for (const pr of config.yPoles) {
    if (Math.abs(pr.pole) > 1e-12) {
      // Integration of c / (s - a):
      const alpha = Math.exp(pr.pole * dt);
      const beta0 = (pr.residue / pr.pole) * (alpha - 1.0);
      gc += Math.abs(beta0);
    } else {
      gc += pr.residue * dt * 0.5;
    }
  }

  return {
    config,
    delaySteps,
    gc,
    statesYFrom: new Float64Array(config.yPoles.length),
    statesYTo: new Float64Array(config.yPoles.length),
    statesHFrom: new Float64Array(config.hPoles.length),
    statesHTo: new Float64Array(config.hPoles.length),
    bufferFrom: new Float64Array(delaySteps + 2),
    bufferTo: new Float64Array(delaySteps + 2),
    bufferIdx: 0,
    iHistFrom: 0,
    iHistTo: 0,
  };
}

/**
 * Updates the historical states of the frequency-dependent line at time t.
 *
 * @param state Line state object
 * @param vFrom Solved voltage at sending terminal
 * @param vTo Solved voltage at receiving terminal
 * @param dt Time step in seconds
 */
export function updateFdLine(state: FdLineState, vFrom: number, vTo: number, dt: number): void {
  const { config, delaySteps } = state;
  const nY = config.yPoles.length;
  const nH = config.hPoles.length;

  // 1. Update Characteristic Admittance Y_c recursive convolution
  let iYFrom = 0;
  let iYTo = 0;
  for (let m = 0; m < nY; m++) {
    const p = config.yPoles[m]!;
    const alpha = Math.exp(p.pole * dt);
    const beta = Math.abs(p.pole) > 1e-12 ? (p.residue / p.pole) * (alpha - 1.0) : p.residue * dt;

    state.statesYFrom[m] = alpha * state.statesYFrom[m]! + beta * vFrom;
    state.statesYTo[m] = alpha * state.statesYTo[m]! + beta * vTo;

    iYFrom += state.statesYFrom[m]!;
    iYTo += state.statesYTo[m]!;
  }

  // 2. Incident forward waves launched into the line at sending and receiving terminals
  // a_k(t) = 2 * v_k(t) * G_c - i_k(t)
  const aFrom = 2 * vFrom * state.gc - iYFrom;
  const aTo = 2 * vTo * state.gc - iYTo;

  // Store into circular delay buffers
  state.bufferFrom[state.bufferIdx] = aFrom;
  state.bufferTo[state.bufferIdx] = aTo;

  // Retrieve delayed wave arriving from the other end
  const delayedIdx = (state.bufferIdx - delaySteps + state.bufferFrom.length) % state.bufferFrom.length;
  const delayedWaveAtFrom = state.bufferTo[delayedIdx] ?? 0;
  const delayedWaveAtTo = state.bufferFrom[delayedIdx] ?? 0;

  // 3. Update Propagation Function H(s) recursive convolution (attenuation & dispersion)
  let bFrom = 0;
  let bTo = 0;
  for (let k = 0; k < nH; k++) {
    const p = config.hPoles[k]!;
    const alpha = Math.exp(p.pole * dt);
    const beta = Math.abs(p.pole) > 1e-12 ? (p.residue / p.pole) * (alpha - 1.0) : p.residue * dt;

    state.statesHFrom[k] = alpha * state.statesHFrom[k]! + beta * delayedWaveAtFrom;
    state.statesHTo[k] = alpha * state.statesHTo[k]! + beta * delayedWaveAtTo;

    bFrom += state.statesHFrom[k]!;
    bTo += state.statesHTo[k]!;
  }

  // 4. Update history currents for next step:
  // I_hist,k = - (i_Y,k + b_k)
  state.iHistFrom = -(iYFrom + bFrom);
  state.iHistTo = -(iYTo + bTo);

  // Advance circular buffer index
  state.bufferIdx = (state.bufferIdx + 1) % state.bufferFrom.length;
}
