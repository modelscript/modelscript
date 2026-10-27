// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fundamental-Frequency AC Phasor / Load-Flow Steady-State Initializer for EMT Solvers.
 *
 * Solves the complex nodal admittance system Y(j*omega_0) * V = I_src at t = 0^-
 * and pre-populates all companion history currents (RLC branches, 4-terminal
 * coupled transformers, Bergeron traveling-wave circular delay buffers, saturable
 * cores, and FMU PLL angles) so simulations start in exact sinusoidal steady state
 * without artificial energization transients or DC offsets.
 */

import { denseToCCS, sparseLuFactor, sparseLuSolve } from "../sparse-solver-bridge.js";
import type { SaturableTransformerState } from "./elements/saturable-transformer.js";
import type {
  BergeronLineState,
  BreakerPoleState,
  FmuIbrState,
  RlcBranchState,
  TransformerWindingState,
} from "./types.js";

export interface PhasorSourceInput {
  node: number;
  vPeakKv: number;
  omega: number;
  phase: number;
  gSource: number;
}

/**
 * Solves the fundamental-frequency AC nodal equations at t = 0^- and initializes
 * all companion history states at t = -dt.
 *
 * Convention:
 *   An AC signal x(t) = Re_x * sin(omega * t) + Im_x * cos(omega * t)
 *                     = Im( (Re_x + j * Im_x) * exp(j * omega * t) )
 *   At t = -dt:
 *     x(-dt) = Re_x * sin(-omega * dt) + Im_x * cos(-omega * dt)
 */
export function initializePhasorSteadyState(
  nNodes: number,
  omega0: number,
  dt: number,
  rlcStates: RlcBranchState[],
  xfmrWindings: TransformerWindingState[],
  breakerPoles: BreakerPoleState[],
  lineStates: BergeronLineState[],
  satXfmrStates: SaturableTransformerState[],
  fmuStates: FmuIbrState[],
  sources: PhasorSourceInput[],
): Float64Array {
  if (nNodes === 0 || sources.length === 0) {
    return new Float64Array(nNodes);
  }

  // Real-equivalent 2N x 2N matrix for complex system (G + j*B) * (V_re + j*V_im) = (I_re + j*I_im):
  //   [ G  -B ] [ V_re ] = [ I_re ]
  //   [ B   G ] [ V_im ]   [ I_im ]
  const dim = 2 * nNodes;
  const dense: Float64Array[] = [];
  for (let i = 0; i < dim; i++) {
    dense.push(new Float64Array(dim));
  }
  const rhs = new Float64Array(dim);

  const addComplexEntry = (r: number, c: number, g: number, b: number) => {
    if (typeof r !== "number" || typeof c !== "number") return;
    if (r < 0 || r >= nNodes || c < 0 || c >= nNodes) return;
    const rowR = dense[r];
    const rowRN = dense[r + nNodes];
    if (rowR) {
      rowR[c] = rowR[c]! + g;
      rowR[c + nNodes] = rowR[c + nNodes]! - b;
    }
    if (rowRN) {
      rowRN[c] = rowRN[c]! + b;
      rowRN[c + nNodes] = rowRN[c + nNodes]! + g;
    }
  };

  const stampComplexTwoTerminal = (i: number, j: number, g: number, b: number) => {
    if (i >= 0 && i < nNodes) addComplexEntry(i, i, g, b);
    if (j >= 0 && j < nNodes) addComplexEntry(j, j, g, b);
    if (i >= 0 && j >= 0 && i < nNodes && j < nNodes) {
      addComplexEntry(i, j, -g, -b);
      addComplexEntry(j, i, -g, -b);
    }
  };

  const stampComplexShunt = (i: number, g: number, b: number) => {
    if (i >= 0 && i < nNodes) addComplexEntry(i, i, g, b);
  };

  // 1. Stamp RLC branches at fundamental frequency omega0
  for (let idx = 0; idx < rlcStates.length; idx++) {
    const br = rlcStates[idx]!;
    const r1 = br.r;
    const xL1 = omega0 * br.l;
    const denom1 = r1 * r1 + xL1 * xL1;
    const gRL1 = denom1 > 1e-18 ? r1 / denom1 : 0;
    const bRL1 = denom1 > 1e-18 ? -xL1 / denom1 : 0;
    const bC1 = omega0 * br.c;
    const g1 = gRL1;
    const b1 = bRL1 + bC1;

    if (br.hasZeroSeq) {
      const r0 = br.r0 ?? r1;
      const xL0 = omega0 * (br.l0 ?? br.l);
      const denom0 = r0 * r0 + xL0 * xL0;
      const gRL0 = denom0 > 1e-18 ? r0 / denom0 : 0;
      const bRL0 = denom0 > 1e-18 ? -xL0 / denom0 : 0;
      const bC0 = omega0 * (br.c0 ?? br.c);
      const g0 = gRL0;
      const b0 = bRL0 + bC0;

      const gSelf = (2 * g1 + g0) / 3;
      const bSelf = (2 * b1 + b0) / 3;
      const gMut = (g0 - g1) / 3;
      const bMut = (b0 - b1) / 3;

      stampComplexTwoTerminal(br.fromNode, br.toNode, gSelf, bSelf);
      if (idx % 3 === 0 && idx + 2 < rlcStates.length) {
        const phases = [rlcStates[idx]!, rlcStates[idx + 1]!, rlcStates[idx + 2]!];
        for (let p = 0; p < 3; p++) {
          for (let q = p + 1; q < 3; q++) {
            const fp = phases[p]!.fromNode;
            const tp = phases[p]!.toNode;
            const fq = phases[q]!.fromNode;
            const tq = phases[q]!.toNode;
            addComplexEntry(fp, fq, gMut, bMut);
            addComplexEntry(fq, fp, gMut, bMut);
            addComplexEntry(tp, tq, gMut, bMut);
            addComplexEntry(tq, tp, gMut, bMut);
            addComplexEntry(fp, tq, -gMut, -bMut);
            addComplexEntry(tq, fp, -gMut, -bMut);
            addComplexEntry(tp, fq, -gMut, -bMut);
            addComplexEntry(fq, tp, -gMut, -bMut);
          }
        }
      }
    } else {
      stampComplexTwoTerminal(br.fromNode, br.toNode, g1, b1);
    }
  }

  // 2. Stamp 4-terminal coupled transformer windings
  for (const w of xfmrWindings) {
    // Recover R and L from companion gLeakage and alphaL:
    // gLeakage = dt / (2*L + R*dt), alphaL = (2*L - R*dt) / (2*L + R*dt)
    // => 1 + alphaL = 4*L / (2*L + R*dt) = 4*L * gLeakage / dt => L = (1 + alphaL) * dt / (4 * gLeakage)
    // => 1 - alphaL = 2*R*dt / (2*L + R*dt) = 2*R * gLeakage => R = (1 - alphaL) / (2 * gLeakage)
    const l = ((1 + w.alphaL) * dt) / (4 * w.gLeakage);
    const r = (1 - w.alphaL) / (2 * w.gLeakage);
    const xL = omega0 * l;
    const denom = r * r + xL * xL;
    const gT = denom > 1e-18 ? r / denom : w.gLeakage;
    const bT = denom > 1e-18 ? -xL / denom : 0;
    const a = w.turnsRatio;

    stampComplexTwoTerminal(w.pPosNode, w.pNegNode, gT, bT);
    stampComplexTwoTerminal(w.sPosNode, w.sNegNode, a * a * gT, a * a * bT);

    const ag = a * gT;
    const ab = a * bT;
    addComplexEntry(w.pPosNode, w.sPosNode, -ag, -ab);
    addComplexEntry(w.sPosNode, w.pPosNode, -ag, -ab);
    addComplexEntry(w.pPosNode, w.sNegNode, ag, ab);
    addComplexEntry(w.sNegNode, w.pPosNode, ag, ab);
    addComplexEntry(w.pNegNode, w.sPosNode, ag, ab);
    addComplexEntry(w.sPosNode, w.pNegNode, ag, ab);
    addComplexEntry(w.pNegNode, w.sNegNode, -ag, -ab);
    addComplexEntry(w.sNegNode, w.pNegNode, -ag, -ab);
  }

  // 3. Stamp circuit breaker poles
  for (const bp of breakerPoles) {
    stampComplexTwoTerminal(bp.fromNode, bp.toNode, bp.gCurrent, 0);
  }

  // 4. Stamp Bergeron transmission lines (exact fundamental-frequency pi equivalent)
  for (const line of lineStates) {
    const theta = omega0 * line.tauSec;
    const zSeriesRe = line.rTotal;
    const zSeriesIm = line.zc * Math.sin(theta);
    const denom = zSeriesRe * zSeriesRe + zSeriesIm * zSeriesIm;
    const gSeries = denom > 1e-18 ? zSeriesRe / denom : line.gc;
    const bSeries = denom > 1e-18 ? -zSeriesIm / denom : 0;
    const bShunt = Math.tan(0.5 * theta) / line.zc;

    stampComplexTwoTerminal(line.fromNode, line.toNode, gSeries, bSeries);
    stampComplexShunt(line.fromNode, 0, bShunt);
    stampComplexShunt(line.toNode, 0, bShunt);
  }

  // 5. Stamp FMU Norton conductance
  for (const fmu of fmuStates) {
    stampComplexShunt(fmu.node, fmu.gEq, 0);
  }

  // 6. Stamp AC sources: v(t) = V_peak * sin(omega * t + phase)
  // Phasor V_hat = V_peak * (cos(phase) + j * sin(phase))
  for (const src of sources) {
    if (src.node >= 0 && src.node < nNodes) {
      stampComplexShunt(src.node, src.gSource, 0);
      const vPeak = src.vPeakKv * 1e3;
      const vRe = vPeak * Math.cos(src.phase);
      const vIm = vPeak * Math.sin(src.phase);
      rhs[src.node] = rhs[src.node]! + src.gSource * vRe;
      rhs[src.node + nNodes] = rhs[src.node + nNodes]! + src.gSource * vIm;
    }
  }

  // Ground regularizer
  for (let i = 0; i < dim; i++) {
    dense[i]![i] = dense[i]![i]! + 1e-7;
  }

  // Solve 2N x 2N linear system for steady-state phasors (V_re, V_im)
  const ccs = denseToCCS(dense, dim);
  const lu = sparseLuFactor(ccs);
  const sol = new Float64Array(dim);
  sparseLuSolve(lu, rhs, sol);

  // Evaluate instantaneous node voltages at t = -dt:
  // v_k(-dt) = V_re * sin(-omega0 * dt) + V_im * cos(-omega0 * dt)
  const sinNeg = Math.sin(-omega0 * dt);
  const cosNeg = Math.cos(-omega0 * dt);
  const vInitNegDt = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    vInitNegDt[i] = sol[i]! * sinNeg + sol[i + nNodes]! * cosNeg;
  }

  const getPhasor = (node: number): { re: number; im: number } => {
    if (node < 0 || node >= nNodes) return { re: 0, im: 0 };
    return { re: sol[node]!, im: sol[node + nNodes]! };
  };

  // Pre-populate RLC branch companion history currents at t = -dt
  for (const br of rlcStates) {
    const vf = getPhasor(br.fromNode);
    const vt = getPhasor(br.toNode);
    const dvRe = vf.re - vt.re;
    const dvIm = vf.im - vt.im;
    const vBranchNeg = dvRe * sinNeg + dvIm * cosNeg;

    let iBranchNeg = 0;
    if (br.l > 0) {
      const r = br.r;
      const xL = omega0 * br.l;
      const denom = r * r + xL * xL;
      // I_L = (dvRe + j*dvIm) * (r - j*xL) / denom
      const iLRe = (dvRe * r + dvIm * xL) / denom;
      const iLIm = (dvIm * r - dvRe * xL) / denom;
      const iLNeg = iLRe * sinNeg + iLIm * cosNeg;
      br.iHistL = br.alphaL * iLNeg + br.gL * vBranchNeg;
      iBranchNeg += iLNeg;
    }
    if (br.c > 0) {
      // I_C = j * omega0 * C * (dvRe + j*dvIm) = -omega0*C*dvIm + j*omega0*C*dvRe
      const bC = omega0 * br.c;
      const iCRe = -bC * dvIm;
      const iCIm = bC * dvRe;
      const iCNeg = iCRe * sinNeg + iCIm * cosNeg;
      br.iHistC = -iCNeg - br.gC * vBranchNeg;
      iBranchNeg += iCNeg;
    }
    if (br.l === 0 && br.r > 0) {
      iBranchNeg += vBranchNeg / br.r;
    }
    br.current = iBranchNeg;
  }

  // Pre-populate 4-terminal transformer winding history currents at t = -dt
  for (const w of xfmrWindings) {
    const vpPos = getPhasor(w.pPosNode);
    const vpNeg = getPhasor(w.pNegNode);
    const vsPos = getPhasor(w.sPosNode);
    const vsNeg = getPhasor(w.sNegNode);

    const vwRe = vpPos.re - vpNeg.re - w.turnsRatio * (vsPos.re - vsNeg.re);
    const vwIm = vpPos.im - vpNeg.im - w.turnsRatio * (vsPos.im - vsNeg.im);
    const vWindNeg = vwRe * sinNeg + vwIm * cosNeg;

    const l = ((1 + w.alphaL) * dt) / (4 * w.gLeakage);
    const r = (1 - w.alphaL) / (2 * w.gLeakage);
    const xL = omega0 * l;
    const denom = r * r + xL * xL;
    const iPRe = (vwRe * r + vwIm * xL) / denom;
    const iPIm = (vwIm * r - vwRe * xL) / denom;
    const iPrimaryNeg = iPRe * sinNeg + iPIm * cosNeg;

    w.iHistPrimary = w.alphaL * iPrimaryNeg + w.gLeakage * vWindNeg;
    w.currentPrimary = iPrimaryNeg;
    w.currentSecondary = -w.turnsRatio * iPrimaryNeg;
  }

  // Pre-populate breaker currents at t = -dt
  for (const bp of breakerPoles) {
    const vf = bp.fromNode >= 0 ? vInitNegDt[bp.fromNode]! : 0;
    const vt = bp.toNode >= 0 ? vInitNegDt[bp.toNode]! : 0;
    bp.current = (vf - vt) * bp.gCurrent;
  }

  // Pre-populate Bergeron transmission line traveling-wave delay buffers for t in [-tau, 0)
  for (const line of lineStates) {
    const vf = getPhasor(line.fromNode);
    const vt = getPhasor(line.toNode);
    const theta = omega0 * line.tauSec;
    const zSeriesRe = line.rTotal;
    const zSeriesIm = line.zc * Math.sin(theta);
    const denom = zSeriesRe * zSeriesRe + zSeriesIm * zSeriesIm;
    const gSeries = denom > 1e-18 ? zSeriesRe / denom : line.gc;
    const bSeries = denom > 1e-18 ? -zSeriesIm / denom : 0;
    const bShunt = Math.tan(0.5 * theta) / line.zc;

    // Steady-state current entering sending end (from -> to):
    // I_from = (V_from - V_to)*(gSeries + j*bSeries) + j*bShunt*V_from
    const dvRe = vf.re - vt.re;
    const dvIm = vf.im - vt.im;
    const iFromRe = dvRe * gSeries - dvIm * bSeries - bShunt * vf.im;
    const iFromIm = dvRe * bSeries + dvIm * gSeries + bShunt * vf.re;

    // Steady-state current entering receiving end (to -> from):
    const iToRe = -dvRe * gSeries + dvIm * bSeries - bShunt * vt.im;
    const iToIm = -dvRe * bSeries - dvIm * gSeries + bShunt * vt.re;

    const rLoss = line.rTotal;
    const eta = Math.max(0.1, (1 - rLoss / (4 * line.zc)) / (1 + rLoss / (4 * line.zc)));
    const bufLen = line.bufferFrom.length;

    for (let k = 0; k < bufLen; k++) {
      // Buffer index k corresponds to historical time t_k = (k - bufLen) * dt
      const tHist = (k - bufLen) * dt;
      const s = Math.sin(omega0 * tHist);
      const c = Math.cos(omega0 * tHist);
      const vFromHist = vf.re * s + vf.im * c;
      const vToHist = vt.re * s + vt.im * c;
      const iFromHist = iFromRe * s + iFromIm * c;
      const iToHist = iToRe * s + iToIm * c;

      // Forward wave launched from sending end K towards M: (gc * vFrom + iFrom) * eta
      line.bufferFrom[k] = (line.gc * vFromHist + iFromHist) * eta;
      // Forward wave launched from receiving end M towards K: (gc * vTo + iTo) * eta
      line.bufferTo[k] = (line.gc * vToHist + iToHist) * eta;
    }
    line.bufferIdx = 0;
  }

  // Pre-populate Saturable Transformer core flux linkage at t = -dt:
  // lambda(t) = integral v(t) dt => Phasor Lambda_hat = V_hat / (j * omega0) = (V_im - j * V_re) / omega0
  for (const sat of satXfmrStates) {
    const vp = getPhasor(sat.config.primaryNode);
    const fluxRe = vp.im / omega0;
    const fluxIm = -vp.re / omega0;
    sat.fluxWb = (sat.config.remanentFluxWb ?? 0) + (fluxRe * sinNeg + fluxIm * cosNeg);
    sat.vPrimaryPrev = vp.re * sinNeg + vp.im * cosNeg;
  }

  // Pre-populate FMU PLL phase angle at t = 0
  for (const fmu of fmuStates) {
    if (fmu.node >= 0 && fmu.node < nNodes) {
      const vp = getPhasor(fmu.node);
      if (Math.hypot(vp.re, vp.im) > 1.0) {
        fmu.pllAngle = Math.atan2(vp.im, vp.re);
      }
    }
  }

  return vInitNegDt;
}
