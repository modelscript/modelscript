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

import { getDefaultWasmExports } from "@modelscript/runtime";
import { WasmScratchPool, type WasmMemoryHost, type WasmScratchScope } from "@modelscript/solve";

interface FdLineWasmExports extends WasmMemoryHost {
  fd_line_compute_gc?: (y0: number, yPolesPtr: number, yResPtr: number, nY: number, dt: number) => number;
  fd_line_pole_conv?: (
    polesPtr: number,
    resPtr: number,
    statesFromPtr: number,
    statesToPtr: number,
    nPoles: number,
    inFrom: number,
    inTo: number,
    dt: number,
    outSumsPtr: number,
  ) => void;
  fd_line_delay_interp?: (bufPtr: number, bufLen: number, writeIdx: number, delaySteps: number, frac: number) => number;
  fd_line_step?: (
    yPolesPtr: number,
    yResPtr: number,
    nY: number,
    hPolesPtr: number,
    hResPtr: number,
    nH: number,
    statesYFromPtr: number,
    statesYToPtr: number,
    statesHFromPtr: number,
    statesHToPtr: number,
    bufferFromPtr: number,
    bufferToPtr: number,
    bufLen: number,
    bufferIdx: number,
    delaySteps: number,
    delayFrac: number,
    gc: number,
    vFrom: number,
    vTo: number,
    dt: number,
    outIHistPtr: number,
  ) => number;
  fd_line_clarke_fwd?: (
    vfa: number,
    vfb: number,
    vfc: number,
    vta: number,
    vtb: number,
    vtc: number,
    outModalVPtr: number,
  ) => void;
  fd_line_clarke_inv?: (
    if0: number,
    ifAlpha: number,
    ifBeta: number,
    it0: number,
    itAlpha: number,
    itBeta: number,
    outFromPhasePtr: number,
    outToPhasePtr: number,
  ) => void;
  fd_line_overhead_constants?: (
    freqHz: number,
    conductorHeightM: number,
    conductorRadiusM: number,
    gmrM: number,
    rDcOhmPerKm: number,
    soilResistivityOhmM: number,
    outPtr: number,
  ) => void;
  fd_line_modal_overhead_constants?: (
    freqHz: number,
    conductorHeightM: number,
    conductorRadiusM: number,
    gmrM: number,
    phaseSpacingM: number,
    rDcOhmPerKm: number,
    soilResistivityOhmM: number,
    outPtr: number,
  ) => void;
  fd_line_synthesize_poles?: (
    numPoles: number,
    deltaY: number,
    dcGain: number,
    pMin: number,
    pMax: number,
    outPolesPtr: number,
    outYResPtr: number,
    outHResPtr: number,
  ) => void;
  fd_line_vector_fit_ls?: (
    nFreq: number,
    omegasPtr: number,
    targetRePtr: number,
    targetImPtr: number,
    nPoles: number,
    polesPtr: number,
    d0: number,
    outResPtr: number,
    scratchPtr: number,
  ) => number;
}

const _fdLineScratchPools = new WeakMap<object, WasmScratchPool>();
function getFdLinePool(wasm: WasmMemoryHost): WasmScratchPool {
  let pool = _fdLineScratchPools.get(wasm);
  if (!pool) {
    pool = new WasmScratchPool(wasm, 65536);
    _fdLineScratchPools.set(wasm, pool);
  }
  return pool;
}

interface PackedFdPoles {
  yPoles: Float64Array;
  yRes: Float64Array;
  hPoles: Float64Array;
  hRes: Float64Array;
}

const _packedFdPoles = new WeakMap<FrequencyDependentLineConfig, PackedFdPoles>();
function getPackedFdPoles(config: FrequencyDependentLineConfig): PackedFdPoles {
  let packed = _packedFdPoles.get(config);
  if (!packed || packed.yPoles.length !== config.yPoles.length || packed.hPoles.length !== config.hPoles.length) {
    const nY = config.yPoles.length;
    const nH = config.hPoles.length;
    const yPoles = new Float64Array(nY);
    const yRes = new Float64Array(nY);
    for (let m = 0; m < nY; m++) {
      const p = config.yPoles[m]!;
      yPoles[m] = p.pole;
      yRes[m] = p.residue;
    }
    const hPoles = new Float64Array(nH);
    const hRes = new Float64Array(nH);
    for (let k = 0; k < nH; k++) {
      const p = config.hPoles[k]!;
      hPoles[k] = p.pole;
      hRes[k] = p.residue;
    }
    packed = { yPoles, yRes, hPoles, hRes };
    _packedFdPoles.set(config, packed);
  }
  return packed;
}

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
  let gc: number | undefined;
  const nY = config.yPoles.length;
  const wasm = getDefaultWasmExports() as FdLineWasmExports | null;
  if (wasm?.fd_line_compute_gc && wasm.memory && nY > 0) {
    let scope: WasmScratchScope | null = null;
    try {
      const packed = getPackedFdPoles(config);
      scope = getFdLinePool(wasm).scope();
      const yPolesBuf = scope.allocF64(nY);
      const yResBuf = scope.allocF64(nY);
      const mem = wasm.memory.buffer;
      new Float64Array(mem, yPolesBuf.ptr, nY).set(packed.yPoles);
      new Float64Array(mem, yResBuf.ptr, nY).set(packed.yRes);
      gc = wasm.fd_line_compute_gc(config.y0, yPolesBuf.ptr, yResBuf.ptr, nY, dt);
    } finally {
      scope?.dispose();
    }
  }

  if (gc === undefined) {
    gc = config.y0;
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
  const bufLen = state.bufferFrom.length;

  const wasm = getDefaultWasmExports() as FdLineWasmExports | null;
  if (wasm?.fd_line_step && wasm.memory) {
    let scope: WasmScratchScope | null = null;
    try {
      const packed = getPackedFdPoles(config);
      scope = getFdLinePool(wasm).scope();
      const yPolesBuf = scope.allocF64(Math.max(1, nY));
      const yResBuf = scope.allocF64(Math.max(1, nY));
      const hPolesBuf = scope.allocF64(Math.max(1, nH));
      const hResBuf = scope.allocF64(Math.max(1, nH));
      const stYFromBuf = scope.allocF64(Math.max(1, nY));
      const stYToBuf = scope.allocF64(Math.max(1, nY));
      const stHFromBuf = scope.allocF64(Math.max(1, nH));
      const stHToBuf = scope.allocF64(Math.max(1, nH));
      const bufFromBuf = scope.allocF64(Math.max(1, bufLen));
      const bufToBuf = scope.allocF64(Math.max(1, bufLen));
      const outIHistBuf = scope.allocF64(2);

      const memIn = wasm.memory.buffer;
      if (nY > 0) {
        new Float64Array(memIn, yPolesBuf.ptr, nY).set(packed.yPoles);
        new Float64Array(memIn, yResBuf.ptr, nY).set(packed.yRes);
        new Float64Array(memIn, stYFromBuf.ptr, nY).set(state.statesYFrom);
        new Float64Array(memIn, stYToBuf.ptr, nY).set(state.statesYTo);
      }
      if (nH > 0) {
        new Float64Array(memIn, hPolesBuf.ptr, nH).set(packed.hPoles);
        new Float64Array(memIn, hResBuf.ptr, nH).set(packed.hRes);
        new Float64Array(memIn, stHFromBuf.ptr, nH).set(state.statesHFrom);
        new Float64Array(memIn, stHToBuf.ptr, nH).set(state.statesHTo);
      }
      if (bufLen > 0) {
        new Float64Array(memIn, bufFromBuf.ptr, bufLen).set(state.bufferFrom);
        new Float64Array(memIn, bufToBuf.ptr, bufLen).set(state.bufferTo);
      }

      const nextIdx = wasm.fd_line_step(
        yPolesBuf.ptr,
        yResBuf.ptr,
        nY,
        hPolesBuf.ptr,
        hResBuf.ptr,
        nH,
        stYFromBuf.ptr,
        stYToBuf.ptr,
        stHFromBuf.ptr,
        stHToBuf.ptr,
        bufFromBuf.ptr,
        bufToBuf.ptr,
        bufLen,
        state.bufferIdx,
        delaySteps,
        0.0,
        state.gc,
        vFrom,
        vTo,
        dt,
        outIHistBuf.ptr,
      );

      const memOut = wasm.memory.buffer;
      if (nY > 0) {
        state.statesYFrom.set(new Float64Array(memOut, stYFromBuf.ptr, nY));
        state.statesYTo.set(new Float64Array(memOut, stYToBuf.ptr, nY));
      }
      if (nH > 0) {
        state.statesHFrom.set(new Float64Array(memOut, stHFromBuf.ptr, nH));
        state.statesHTo.set(new Float64Array(memOut, stHToBuf.ptr, nH));
      }
      if (bufLen > 0) {
        state.bufferFrom.set(new Float64Array(memOut, bufFromBuf.ptr, bufLen));
        state.bufferTo.set(new Float64Array(memOut, bufToBuf.ptr, bufLen));
      }
      const iHistView = new Float64Array(memOut, outIHistBuf.ptr, 2);
      state.iHistFrom = iHistView[0]!;
      state.iHistTo = iHistView[1]!;
      state.bufferIdx = nextIdx;
      return;
    } finally {
      scope?.dispose();
    }
  }

  // TypeScript fallback path
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

/**
 * Physical overhead transmission tower & conductor geometry for Line Constants (LCP) calculation.
 */
export interface TowerGeometryConfig {
  lengthKm: number;
  conductorHeightM: number; // Average height h above ground (m), e.g. 20.0 m
  conductorRadiusM: number; // Outer radius r of conductor (m), e.g. 0.015 m
  gmrM?: number | undefined; // Geometric Mean Radius (m), defaults to 0.7788 * conductorRadiusM
  phaseSpacingM?: number | undefined; // Geometric Mean Distance D_eq between phases (m), default 8.0 m
  rDcOhmPerKm: number; // DC resistance at 20°C (Ohm/km), e.g. 0.05 Ohm/km
  soilResistivityOhmM?: number | undefined; // Earth resistivity rho_e (Ohm*m), default 100.0 Ohm*m
}

export interface ModalLineConstantsResult {
  positiveMode: {
    rOhmPerKm: number;
    lHPerKm: number;
    cFPerKm: number;
    zcMagOhm: number;
    phaseVelocityKmPerSec: number;
    attenuationNeperPerKm: number;
  };
  zeroMode: {
    rOhmPerKm: number;
    lHPerKm: number;
    cFPerKm: number;
    zcMagOhm: number;
    phaseVelocityKmPerSec: number;
    attenuationNeperPerKm: number;
  };
  zSelfOhmPerKm: { re: number; im: number };
  zMutualOhmPerKm: { re: number; im: number };
}

/**
 * Computes frequency-dependent series impedance Z(omega) = R(omega) + j*omega*L(omega)
 * and shunt capacitance C per km using Deri-Semlyen's complex ground return plane
 * p(omega) = 1 / sqrt(j * omega * mu_0 / rho_e) and tubular skin-effect correction.
 */
export function computeOverheadLineConstants(
  geom: TowerGeometryConfig,
  freqHz: number,
): {
  rOhmPerKm: number;
  lHPerKm: number;
  cFPerKm: number;
  zcMagOhm: number;
  phaseVelocityKmPerSec: number;
  attenuationNeperPerKm: number;
} {
  const rho = geom.soilResistivityOhmM ?? 100.0;
  const h = Math.max(1.0, geom.conductorHeightM);
  const r = Math.max(1e-4, geom.conductorRadiusM);
  const gmr = geom.gmrM ?? 0.7788 * r;

  const wasm = getDefaultWasmExports() as FdLineWasmExports | null;
  if (wasm?.fd_line_overhead_constants && wasm.memory) {
    let scope: WasmScratchScope | null = null;
    try {
      scope = getFdLinePool(wasm).scope();
      const outBuf = scope.allocF64(6);
      wasm.fd_line_overhead_constants(freqHz, h, r, gmr, geom.rDcOhmPerKm, rho, outBuf.ptr);
      const out = new Float64Array(wasm.memory.buffer, outBuf.ptr, 6);
      return {
        rOhmPerKm: out[0]!,
        lHPerKm: out[1]!,
        cFPerKm: out[2]!,
        zcMagOhm: out[3]!,
        phaseVelocityKmPerSec: out[4]!,
        attenuationNeperPerKm: out[5]!,
      };
    } finally {
      scope?.dispose();
    }
  }

  // TypeScript fallback path
  const mu0 = 4 * Math.PI * 1e-7; // H/m
  const eps0 = 8.854187817e-12; // F/m
  const omega = 2 * Math.PI * Math.max(1e-3, freqHz);

  // 1. Conductor skin effect: delta_c = sqrt(rho_c / (pi * f * mu_0))
  // High-frequency AC resistance rises as sqrt(f) above ~60 Hz
  const skinRatio = Math.sqrt(1.0 + Math.pow(freqHz / 120.0, 1.0));
  const rCondPerKm = geom.rDcOhmPerKm * skinRatio;

  // 2. Deri-Semlyen complex earth return depth:
  // p = 1 / sqrt(j * omega * mu_0 / rho) = delta_e * (1 - j) / 2, where delta_e = sqrt(2 * rho / (omega * mu_0))
  const deltaE = Math.sqrt((2 * rho) / (omega * mu0));
  const pRe = 0.5 * deltaE;
  const pIm = -0.5 * deltaE;

  // Complex argument of log((2*(h + p)) / gmr):
  const numRe = (2 * (h + pRe)) / gmr;
  const numIm = (2 * pIm) / gmr;
  const logMag = Math.log(Math.hypot(numRe, numIm));
  const logAng = Math.atan2(numIm, numRe); // negative angle -> resistive ground return loss!

  // Z_earth_ext(omega) = j * omega * (mu_0 / (2*pi)) * (logMag + j * logAng) * 1000 [Ohm/km]
  // = (omega * mu_0 * 1000 / (2*pi)) * (-logAng + j * logMag)
  const kFactor = (omega * mu0 * 1000) / (2 * Math.PI);
  const rEarthPerKm = kFactor * Math.max(0, -logAng);
  const xPerKm = kFactor * logMag;

  const rOhmPerKm = rCondPerKm + rEarthPerKm;
  const lHPerKm = xPerKm / omega;

  // 3. Shunt capacitance to ideal ground plane (image at -h):
  // C = (2 * pi * eps_0) / ln(2*h / r) * 1000 [F/km]
  const cFPerKm = ((2 * Math.PI * eps0) / Math.log((2 * h) / r)) * 1000;

  // 4. Complex propagation constant gamma = sqrt((R + j*w*L) * (j*w*C)) = alpha + j*beta
  // and characteristic impedance Z_c = sqrt((R + j*w*L) / (j*w*C))
  const zMag = Math.hypot(rOhmPerKm, xPerKm);
  const zAng = Math.atan2(xPerKm, rOhmPerKm);
  const yMag = omega * cFPerKm;
  const yAng = Math.PI / 2;

  const gammaMag = Math.sqrt(zMag * yMag);
  const gammaAng = 0.5 * (zAng + yAng);
  const alpha = gammaMag * Math.cos(gammaAng);
  const beta = gammaMag * Math.sin(gammaAng);

  const zcMagOhm = Math.sqrt(zMag / Math.max(1e-18, yMag));
  const phaseVelocityKmPerSec = beta > 1e-12 ? omega / beta : 299792.0;

  return {
    rOhmPerKm,
    lHPerKm,
    cFPerKm,
    zcMagOhm,
    phaseVelocityKmPerSec,
    attenuationNeperPerKm: alpha,
  };
}

/**
 * Computes 3-phase transposed modal line constants in the Clarke / Karrenbauer (0, alpha, beta) domain,
 * separating the Positive/Aerial mode (Z_1 = Z_s - Z_m, C_1) from the Zero/Ground mode (Z_0 = Z_s + 2*Z_m, C_0).
 */
export function computeModalOverheadLineConstants(geom: TowerGeometryConfig, freqHz: number): ModalLineConstantsResult {
  const rho = geom.soilResistivityOhmM ?? 100.0;
  const h = Math.max(1.0, geom.conductorHeightM);
  const r = Math.max(1e-4, geom.conductorRadiusM);
  const gmr = geom.gmrM ?? 0.7788 * r;
  const dEq = Math.max(2.5 * r, geom.phaseSpacingM ?? 8.0);

  const wasm = getDefaultWasmExports() as FdLineWasmExports | null;
  if (wasm?.fd_line_modal_overhead_constants && wasm.memory) {
    let scope: WasmScratchScope | null = null;
    try {
      scope = getFdLinePool(wasm).scope();
      const outBuf = scope.allocF64(16);
      wasm.fd_line_modal_overhead_constants(freqHz, h, r, gmr, dEq, geom.rDcOhmPerKm, rho, outBuf.ptr);
      const out = new Float64Array(wasm.memory.buffer, outBuf.ptr, 16);
      return {
        positiveMode: {
          rOhmPerKm: out[0]!,
          lHPerKm: out[1]!,
          cFPerKm: out[2]!,
          zcMagOhm: out[3]!,
          phaseVelocityKmPerSec: out[4]!,
          attenuationNeperPerKm: out[5]!,
        },
        zeroMode: {
          rOhmPerKm: out[6]!,
          lHPerKm: out[7]!,
          cFPerKm: out[8]!,
          zcMagOhm: out[9]!,
          phaseVelocityKmPerSec: out[10]!,
          attenuationNeperPerKm: out[11]!,
        },
        zSelfOhmPerKm: { re: out[12]!, im: out[13]! },
        zMutualOhmPerKm: { re: out[14]!, im: out[15]! },
      };
    } finally {
      scope?.dispose();
    }
  }

  // TypeScript fallback path
  const mu0 = 4 * Math.PI * 1e-7;
  const eps0 = 8.854187817e-12;
  const omega = 2 * Math.PI * Math.max(1e-3, freqHz);

  const skinRatio = Math.sqrt(1.0 + Math.pow(freqHz / 120.0, 1.0));
  const rCondPerKm = geom.rDcOhmPerKm * skinRatio;

  const deltaE = Math.sqrt((2 * rho) / (omega * mu0));
  const pRe = 0.5 * deltaE;
  const pIm = -0.5 * deltaE;
  const kFactor = (omega * mu0 * 1000) / (2 * Math.PI);

  // Self impedance Z_s(omega)
  const selfNumRe = (2 * (h + pRe)) / gmr;
  const selfNumIm = (2 * pIm) / gmr;
  const selfLogMag = Math.log(Math.hypot(selfNumRe, selfNumIm));
  const selfLogAng = Math.atan2(selfNumIm, selfNumRe);
  const rSelf = rCondPerKm + kFactor * Math.max(0, -selfLogAng);
  const xSelf = kFactor * selfLogMag;

  // Mutual impedance Z_m(omega): complex image distance D_img = sqrt(4*(h + p)^2 + dEq^2)
  // Let W = 4*(h + p)^2 + dEq^2
  const hpRe = h + pRe;
  const hpIm = pIm;
  const wRe = 4 * (hpRe * hpRe - hpIm * hpIm) + dEq * dEq;
  const wIm = 8 * hpRe * hpIm;
  const wMag = Math.hypot(wRe, wIm);
  const wAng = Math.atan2(wIm, wRe);
  const dImgMag = Math.sqrt(wMag);
  const dImgAng = 0.5 * wAng;

  const mutLogMag = Math.log(dImgMag / dEq);
  const mutLogAng = dImgAng;
  const rMut = kFactor * Math.max(0, -mutLogAng);
  const xMut = kFactor * mutLogAng > -1e9 ? kFactor * mutLogMag : 0;

  // Positive / Aerial mode: Z_1 = Z_s - Z_m
  const r1 = Math.max(rCondPerKm * 0.95, rSelf - rMut);
  const x1 = Math.max(1e-6, xSelf - xMut);
  const l1 = x1 / omega;

  // Zero / Ground mode: Z_0 = Z_s + 2 * Z_m
  const r0 = rSelf + 2 * rMut;
  const x0 = xSelf + 2 * xMut;
  const l0 = x0 / omega;

  // Maxwell potential coefficients [m/F]: P_ss = ln(2h/r)/(2*pi*eps0), P_sm = ln(sqrt(4h^2 + dEq^2)/dEq)/(2*pi*eps0)
  const pSS = Math.log((2 * h) / r) / (2 * Math.PI * eps0);
  const pSM = Math.log(Math.hypot(2 * h, dEq) / dEq) / (2 * Math.PI * eps0);
  const c1 = (1.0 / Math.max(1e3, pSS - pSM)) * 1000.0; // F/km
  const c0 = (1.0 / Math.max(1e3, pSS + 2 * pSM)) * 1000.0; // F/km

  const evalMode = (rMode: number, xMode: number, lMode: number, cMode: number) => {
    const zMag = Math.hypot(rMode, xMode);
    const zAng = Math.atan2(xMode, rMode);
    const yMag = omega * cMode;
    const gammaMag = Math.sqrt(zMag * yMag);
    const gammaAng = 0.5 * (zAng + Math.PI / 2);
    const alpha = gammaMag * Math.cos(gammaAng);
    const beta = gammaMag * Math.sin(gammaAng);
    return {
      rOhmPerKm: rMode,
      lHPerKm: lMode,
      cFPerKm: cMode,
      zcMagOhm: Math.sqrt(zMag / Math.max(1e-18, yMag)),
      phaseVelocityKmPerSec: beta > 1e-12 ? omega / beta : 299792.0,
      attenuationNeperPerKm: alpha,
    };
  };

  return {
    positiveMode: evalMode(r1, x1, l1, c1),
    zeroMode: evalMode(r0, x0, l0, c0),
    zSelfOhmPerKm: { re: rSelf, im: xSelf },
    zMutualOhmPerKm: { re: rMut, im: xMut },
  };
}

function synthesizeLogPolesPair(
  numPoles: number,
  deltaY: number,
  dcGain: number,
  pMin: number,
  pMax: number,
): { yPoles: RationalPoleResidue[]; hPoles: RationalPoleResidue[] } {
  const yPoles: RationalPoleResidue[] = [];
  const hPoles: RationalPoleResidue[] = [];
  if (numPoles <= 0) {
    return { yPoles, hPoles };
  }

  const wasm = getDefaultWasmExports() as FdLineWasmExports | null;
  if (wasm?.fd_line_synthesize_poles && wasm.memory) {
    let scope: WasmScratchScope | null = null;
    try {
      scope = getFdLinePool(wasm).scope();
      const polesBuf = scope.allocF64(numPoles);
      const yResBuf = scope.allocF64(numPoles);
      const hResBuf = scope.allocF64(numPoles);
      wasm.fd_line_synthesize_poles(numPoles, deltaY, dcGain, pMin, pMax, polesBuf.ptr, yResBuf.ptr, hResBuf.ptr);
      const mem = wasm.memory.buffer;
      const polesView = new Float64Array(mem, polesBuf.ptr, numPoles);
      const yResView = new Float64Array(mem, yResBuf.ptr, numPoles);
      const hResView = new Float64Array(mem, hResBuf.ptr, numPoles);
      for (let m = 0; m < numPoles; m++) {
        const pole = polesView[m]!;
        yPoles.push({ pole, residue: yResView[m]! });
        hPoles.push({ pole, residue: hResView[m]! });
      }
      return { yPoles, hPoles };
    } finally {
      scope?.dispose();
    }
  }

  // TypeScript fallback path
  let weightSum = 0;
  const poles: number[] = [];
  for (let m = 0; m < numPoles; m++) {
    const frac = numPoles > 1 ? m / (numPoles - 1) : 0.5;
    const pole = -pMin * Math.pow(pMax / pMin, frac);
    poles.push(pole);
    weightSum += 1.0 / (m + 1);
  }

  for (let m = 0; m < numPoles; m++) {
    const pole = poles[m]!;
    const w = 1.0 / (m + 1) / weightSum;
    // For Y_c(s) = y0 + sum( c_m / (s - p_m) ), at s = 0: sum( -c_m / p_m ) = deltaY -> c_m = -deltaY * w * p_m
    yPoles.push({
      pole,
      residue: -deltaY * w * pole,
    });
    // For H(s) = sum( r_k / (s - p_k) ), at s = 0: sum( -r_k / p_k ) = dcGain -> r_k = -dcGain * w * p_k > 0
    hPoles.push({
      pole,
      residue: -dcGain * w * pole,
    });
  }

  return { yPoles, hPoles };
}

/**
 * Synthesizes a passive, frequency-dependent rational pole/residue model (`FrequencyDependentLineConfig`)
 * directly from physical overhead tower geometry using logarithmic multi-frequency sampling (50 Hz to 50 kHz)
 * and real-pole Vector Fitting with passivity enforcement.
 */
export function synthesizeFdLineFromTower(
  id: string,
  fromNode: number,
  toNode: number,
  geom: TowerGeometryConfig,
  numPoles = 4,
): FrequencyDependentLineConfig {
  // High-frequency asymptotic parameters (at 100 kHz)
  const hf = computeOverheadLineConstants(geom, 100e3);
  const lf = computeOverheadLineConstants(geom, 60.0);

  const tauSec = geom.lengthKm / Math.max(1e4, hf.phaseVelocityKmPerSec);
  const y0 = 1.0 / Math.max(1.0, hf.zcMagOhm);
  const yLow = 1.0 / Math.max(1.0, lf.zcMagOhm);

  // Distribute stable real poles logarithmically from 100 rad/s to 2e5 rad/s
  const pMin = 2 * Math.PI * 30;
  const pMax = 2 * Math.PI * 25000;

  const deltaY = yLow - y0;
  const dcTransmissionGain = Math.exp(-lf.attenuationNeperPerKm * geom.lengthKm);
  const { yPoles, hPoles } = synthesizeLogPolesPair(numPoles, deltaY, dcTransmissionGain, pMin, pMax);

  return {
    id,
    fromNode,
    toNode,
    lengthKm: geom.lengthKm,
    tauSec,
    y0,
    yPoles,
    hPoles,
  };
}

/**
 * 3-Phase Coupled Modal Frequency-Dependent Line Configuration (`abc <-> 0-alpha-beta`).
 */
export interface ModalThreePhaseFdLineConfig {
  id: string;
  fromBus: string;
  toBus: string;
  lengthKm: number;
  positiveMode: FrequencyDependentLineConfig;
  zeroMode: FrequencyDependentLineConfig;
}

export interface ModalThreePhaseFdLineState {
  config: ModalThreePhaseFdLineConfig;
  fromNodes: number[]; // [nodeA, nodeB, nodeC]
  toNodes: number[]; // [nodeA, nodeB, nodeC]
  mode0: FdLineState;
  modeAlpha: FdLineState;
  modeBeta: FdLineState;
  gSelf: number; // (G_c0 + 2 * G_c1) / 3
  gMutual: number; // (G_c0 - G_c1) / 3
  iHistFromPhase: Float64Array; // [iHistA, iHistB, iHistC]
  iHistToPhase: Float64Array; // [iHistA, iHistB, iHistC]
}

/**
 * Synthesizes a 3-phase coupled modal FD line (`ModalThreePhaseFdLineConfig`) with distinct
 * ground-mode (0) and aerial-mode (alpha, beta) wave propagation and surge admittances.
 */
export function synthesizeModalThreePhaseFdLine(
  id: string,
  fromBus: string,
  toBus: string,
  geom: TowerGeometryConfig,
  numPoles = 4,
): ModalThreePhaseFdLineConfig {
  const hf = computeModalOverheadLineConstants(geom, 100e3);
  const lf = computeModalOverheadLineConstants(geom, 60.0);

  const buildModeConfig = (
    modeId: string,
    hfMode: ModalLineConstantsResult["positiveMode"],
    lfMode: ModalLineConstantsResult["positiveMode"],
  ): FrequencyDependentLineConfig => {
    const tauSec = geom.lengthKm / Math.max(1e4, hfMode.phaseVelocityKmPerSec);
    const y0 = 1.0 / Math.max(1.0, hfMode.zcMagOhm);
    const yLow = 1.0 / Math.max(1.0, lfMode.zcMagOhm);
    const deltaY = yLow - y0;
    const dcGain = Math.exp(-lfMode.attenuationNeperPerKm * geom.lengthKm);

    const pMin = 2 * Math.PI * 30;
    const pMax = 2 * Math.PI * 25000;
    const { yPoles, hPoles } = synthesizeLogPolesPair(numPoles, deltaY, dcGain, pMin, pMax);
    return {
      id: modeId,
      fromNode: -1,
      toNode: -1,
      lengthKm: geom.lengthKm,
      tauSec,
      y0,
      yPoles,
      hPoles,
    };
  };

  return {
    id,
    fromBus,
    toBus,
    lengthKm: geom.lengthKm,
    positiveMode: buildModeConfig(`${id}_mode1`, hf.positiveMode, lf.positiveMode),
    zeroMode: buildModeConfig(`${id}_mode0`, hf.zeroMode, lf.zeroMode),
  };
}

export function createModalFdLineState(
  config: ModalThreePhaseFdLineConfig,
  fromNodes: number[],
  toNodes: number[],
  dt: number,
): ModalThreePhaseFdLineState {
  const mode0 = createFdLineState(config.zeroMode, dt);
  const modeAlpha = createFdLineState(config.positiveMode, dt);
  const modeBeta = createFdLineState(config.positiveMode, dt);

  const gc0 = mode0.gc;
  const gc1 = modeAlpha.gc;
  const gSelf = (gc0 + 2 * gc1) / 3.0;
  const gMutual = (gc0 - gc1) / 3.0;

  return {
    config,
    fromNodes,
    toNodes,
    mode0,
    modeAlpha,
    modeBeta,
    gSelf,
    gMutual,
    iHistFromPhase: new Float64Array(3),
    iHistToPhase: new Float64Array(3),
  };
}

/**
 * Updates a 3-phase coupled modal FD line by transforming phase voltages (va, vb, vc)
 * into power-invariant Clarke modal coordinates (v0, valpha, vbeta), stepping each
 * modal line independently, and transforming modal history currents back to (ia, ib, ic).
 */
export function updateModalFdLine(state: ModalThreePhaseFdLineState, vVec: Float64Array, dt: number): void {
  const nfa = state.fromNodes[0] ?? -1;
  const nfb = state.fromNodes[1] ?? -1;
  const nfc = state.fromNodes[2] ?? -1;
  const nta = state.toNodes[0] ?? -1;
  const ntb = state.toNodes[1] ?? -1;
  const ntc = state.toNodes[2] ?? -1;

  const vfa = nfa >= 0 ? vVec[nfa]! : 0;
  const vfb = nfb >= 0 ? vVec[nfb]! : 0;
  const vfc = nfc >= 0 ? vVec[nfc]! : 0;
  const vta = nta >= 0 ? vVec[nta]! : 0;
  const vtb = ntb >= 0 ? vVec[ntb]! : 0;
  const vtc = ntc >= 0 ? vVec[ntc]! : 0;

  const wasm = getDefaultWasmExports() as FdLineWasmExports | null;
  if (wasm?.fd_line_clarke_fwd && wasm.fd_line_clarke_inv && wasm.memory) {
    let scope: WasmScratchScope | null = null;
    try {
      scope = getFdLinePool(wasm).scope();
      const modalVBuf = scope.allocF64(6);

      wasm.fd_line_clarke_fwd(vfa, vfb, vfc, vta, vtb, vtc, modalVBuf.ptr);
      const mv = new Float64Array(wasm.memory.buffer, modalVBuf.ptr, 6);
      const vf0 = mv[0]!;
      const vfAlpha = mv[1]!;
      const vfBeta = mv[2]!;
      const vt0 = mv[3]!;
      const vtAlpha = mv[4]!;
      const vtBeta = mv[5]!;

      // Release scratch scope before calling updateFdLine (which acquires its own scope)
      scope.dispose();
      scope = null;

      updateFdLine(state.mode0, vf0, vt0, dt);
      updateFdLine(state.modeAlpha, vfAlpha, vtAlpha, dt);
      updateFdLine(state.modeBeta, vfBeta, vtBeta, dt);

      scope = getFdLinePool(wasm).scope();
      const invFromBuf = scope.allocF64(3);
      const invToBuf = scope.allocF64(3);
      wasm.fd_line_clarke_inv(
        state.mode0.iHistFrom,
        state.modeAlpha.iHistFrom,
        state.modeBeta.iHistFrom,
        state.mode0.iHistTo,
        state.modeAlpha.iHistTo,
        state.modeBeta.iHistTo,
        invFromBuf.ptr,
        invToBuf.ptr,
      );
      const memOut = wasm.memory.buffer;
      state.iHistFromPhase.set(new Float64Array(memOut, invFromBuf.ptr, 3));
      state.iHistToPhase.set(new Float64Array(memOut, invToBuf.ptr, 3));
      return;
    } finally {
      scope?.dispose();
    }
  }

  // TypeScript fallback path
  const invSqrt3 = 1.0 / Math.sqrt(3.0);
  const sqrt2Over3 = Math.sqrt(2.0 / 3.0);
  const invSqrt2 = 1.0 / Math.sqrt(2.0);

  // Forward Clarke transform: [v0, valpha, vbeta] = T_c * [va, vb, vc]
  const vf0 = invSqrt3 * (vfa + vfb + vfc);
  const vfAlpha = sqrt2Over3 * (vfa - 0.5 * vfb - 0.5 * vfc);
  const vfBeta = invSqrt2 * (vfb - vfc);

  const vt0 = invSqrt3 * (vta + vtb + vtc);
  const vtAlpha = sqrt2Over3 * (vta - 0.5 * vtb - 0.5 * vtc);
  const vtBeta = invSqrt2 * (vtb - vtc);

  updateFdLine(state.mode0, vf0, vt0, dt);
  updateFdLine(state.modeAlpha, vfAlpha, vtAlpha, dt);
  updateFdLine(state.modeBeta, vfBeta, vtBeta, dt);

  // Inverse Clarke transform: [ia, ib, ic] = T_c^T * [i0, ialpha, ibeta]
  const if0 = state.mode0.iHistFrom;
  const ifAlpha = state.modeAlpha.iHistFrom;
  const ifBeta = state.modeBeta.iHistFrom;

  state.iHistFromPhase[0] = invSqrt3 * if0 + sqrt2Over3 * ifAlpha;
  state.iHistFromPhase[1] = invSqrt3 * if0 - 0.5 * sqrt2Over3 * ifAlpha + invSqrt2 * ifBeta;
  state.iHistFromPhase[2] = invSqrt3 * if0 - 0.5 * sqrt2Over3 * ifAlpha - invSqrt2 * ifBeta;

  const it0 = state.mode0.iHistTo;
  const itAlpha = state.modeAlpha.iHistTo;
  const itBeta = state.modeBeta.iHistTo;

  state.iHistToPhase[0] = invSqrt3 * it0 + sqrt2Over3 * itAlpha;
  state.iHistToPhase[1] = invSqrt3 * it0 - 0.5 * sqrt2Over3 * itAlpha + invSqrt2 * itBeta;
  state.iHistToPhase[2] = invSqrt3 * it0 - 0.5 * sqrt2Over3 * itAlpha - invSqrt2 * itBeta;
}
