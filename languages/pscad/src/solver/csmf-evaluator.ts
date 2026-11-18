// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EmtControlBlock } from "../types.js";

const CYCLE_BREAKER_KINDS = new Set<EmtControlBlock["kind"]>([
  "sensor_v",
  "sensor_i",
  "const",
  "time_sig",
  "upramp",
  "tbreakn",
  "zminusone",
  "tdelay",
  "bin_delay",
  "pll",
  "freq_meas",
  "sample_hold",
  "flip_flop",
  "sequencer",
  "ieee_exciter",
  "ieee_governor",
  "ieee_pss",
  "wecc_ibr",
]);

function topoSortControlBlocks(blocks: EmtControlBlock[]): EmtControlBlock[] {
  const byId = new Map<string, EmtControlBlock>();
  for (const b of blocks) byId.set(b.id, b);

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: EmtControlBlock[] = [];

  const visit = (b: EmtControlBlock) => {
    if (visited.has(b.id) || visiting.has(b.id)) return;
    visiting.add(b.id);
    if (!CYCLE_BREAKER_KINDS.has(b.kind)) {
      for (const inp of b.inputs) {
        const dep = byId.get(inp);
        if (dep) visit(dep);
      }
    }
    visiting.delete(b.id);
    visited.add(b.id);
    ordered.push(b);
  };

  for (const b of blocks) visit(b);
  return ordered;
}

/**
 * Step-by-step CSMF control-block evaluator supporting all 41 `EmtControlBlock`
 * kinds with causal topological ordering, stateful filters, Park dq0 transforms,
 * lookup tables, logic/trig, and delay ring buffers.
 */
export class CsmfControlEvaluator {
  private readonly blocks: EmtControlBlock[];
  private readonly values = new Map<string, number>();
  private readonly prevValues = new Map<string, number>();
  private readonly integrators = new Map<string, number>();
  private readonly filterStates = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
  private readonly delayBuffers = new Map<string, { buf: Float64Array; idx: number }>();
  private readonly customStates = new Map<string, Float64Array>();
  private elapsedSec = 0;

  constructor(blocks: EmtControlBlock[]) {
    this.blocks = topoSortControlBlocks(blocks);
    for (const b of this.blocks) {
      const init = b.params["Y0"] ?? b.params["y0"] ?? b.params["Init"] ?? 0;
      this.values.set(b.id, init);
      this.prevValues.set(b.id, init);
    }
  }

  setSignal(id: string, value: number): void {
    this.values.set(id, value);
  }

  getSignal(id: string): number {
    return this.values.get(id) ?? 0;
  }

  /** Updates a block parameter (e.g. Slider/Dial/PushButton Value or Gain) live mid-run. */
  setBlockParam(id: string, paramName: string, value: number): boolean {
    const blk = this.blocks.find((b) => b.id === id);
    if (!blk || !Number.isFinite(value)) return false;
    blk.params[paramName] = value;
    if (paramName === "Value" || paramName === "value" || paramName === "Init" || paramName === "INIT") {
      this.values.set(id, value);
      this.prevValues.set(id, value);
    }
    return true;
  }

  step(dtSec: number): ReadonlyMap<string, number> {
    const safeDt = dtSec > 1e-9 ? dtSec : 50e-6;
    this.elapsedSec += safeDt;

    for (const b of this.blocks) {
      this.prevValues.set(b.id, this.values.get(b.id) ?? 0);
    }

    for (const b of this.blocks) {
      const p = b.params;
      const inVal = (idx: number): number => (b.inputs[idx] ? (this.values.get(b.inputs[idx]!) ?? 0) : 0);
      const u0 = inVal(0);
      const u1 = inVal(1);
      const u2 = inVal(2);
      const u3 = inVal(3);
      let out = 0;

      switch (b.kind) {
        case "sensor_v":
        case "sensor_i":
          out = this.values.get(b.id) ?? 0;
          break;
        case "const":
          out = p["value"] ?? p["Value"] ?? p["K"] ?? p["k"] ?? 0;
          break;
        case "time_sig":
          out = this.elapsedSec;
          break;
        case "upramp": {
          const x1 = p["X1"] ?? p["T0"] ?? p["Tstart"] ?? p["t0"] ?? 0;
          const y1 = p["Y1"] ?? p["Y0"] ?? p["y0"] ?? 0;
          const x2 = p["X2"];
          const y2 = p["Y2"];
          const slope =
            x2 !== undefined && y2 !== undefined && Math.abs(x2 - x1) > 1e-12
              ? (y2 - y1) / (x2 - x1)
              : (p["Slope"] ?? p["slope"] ?? p["K"] ?? 1);
          out =
            this.elapsedSec <= x1
              ? y1
              : x2 !== undefined && y2 !== undefined && this.elapsedSec >= x2
                ? y2
                : y1 + slope * (this.elapsedSec - x1);
          break;
        }
        case "tbreakn": {
          const tTrig = p["TO1"] ?? p["T0"] ?? p["To"] ?? p["T"] ?? p["t0"] ?? 0.05;
          const tTrig2 = p["TO2"];
          const initState = p["INIT"] ?? p["State"] ?? p["Init"] ?? 0;
          const nextState = initState > 0.5 ? 0 : 1;
          if (tTrig2 !== undefined && tTrig2 > tTrig && this.elapsedSec >= tTrig2) {
            out = initState;
          } else {
            out = this.elapsedSec >= tTrig ? nextState : initState;
          }
          break;
        }
        case "gain":
          out = (p["K"] ?? p["k"] ?? p["G"] ?? p["Gain"] ?? 1) * u0;
          break;
        case "sum":
          out = b.inputs.reduce((acc, inp, k) => {
            const sign = k < 3 ? (p[`s${k + 1}`] ?? 1) : 1;
            return acc + sign * (this.values.get(inp) ?? 0);
          }, 0);
          break;
        case "mult":
          out = u0 * (b.inputs.length > 1 ? u1 : (p["K"] ?? 1));
          break;
        case "div":
          out = Math.abs(u1) > 1e-12 ? u0 / u1 : 0;
          break;
        case "abs":
          out = Math.abs(u0);
          break;
        case "square":
          out = u0 * u0;
          break;
        case "inv":
          out = Math.abs(u0) > 1e-12 ? 1 / u0 : 0;
          break;
        case "x_power_y": {
          const exp = b.inputs.length > 1 ? u1 : (p["Y"] ?? p["y"] ?? p["P"] ?? 2);
          out = u0 < 0 && !Number.isInteger(exp) ? 0 : Math.pow(u0, exp);
          break;
        }
        case "angle_resolver":
          out = b.inputs.length <= 1 ? Math.atan2(Math.sin(u0), Math.cos(u0)) : Math.atan2(u1, u0);
          break;
        case "maxmin": {
          const vals = b.inputs.map((_, i) => inVal(i));
          const isMin = (p["Mode"] ?? p["mode"] ?? p["Type"] ?? 0) === 1;
          out = vals.length === 0 ? 0 : isMin ? Math.min(...vals) : Math.max(...vals);
          break;
        }
        case "compar":
        case "compare": {
          const thresh = b.inputs.length > 1 ? u1 : (p["X"] ?? p["Thresh"] ?? p["Ref"] ?? p["Level"] ?? 0);
          const hi = p["OH"] ?? p["Hi"] ?? p["High"] ?? 1;
          const lo = p["OL"] ?? p["Lo"] ?? p["Low"] ?? 0;
          const op = p["Op"] ?? p["Mode"] ?? 0; // 0: >, 1: >=, 2: <, 3: <=, 4: ==
          const cond =
            op === 1
              ? u0 >= thresh
              : op === 2
                ? u0 < thresh
                : op === 3
                  ? u0 <= thresh
                  : op === 4
                    ? u0 === thresh
                    : u0 > thresh;
          out = cond ? hi : lo;
          break;
        }
        case "range": {
          const lo = p["XL"] ?? p["Lo"] ?? p["Min"] ?? p["LL"] ?? 0;
          const hi = p["XU"] ?? p["Hi"] ?? p["Max"] ?? p["UL"] ?? 1;
          const oL = p["OL"] ?? 0;
          const oM = p["OM"] ?? 1;
          const oH = p["OH"] ?? 0;
          out = u0 < lo ? oL : u0 <= hi ? oM : oH;
          break;
        }
        case "select": {
          const sel = Math.round(b.inputs.length > 2 ? u2 : (p["Sel"] ?? 0));
          out = sel > 0.5 ? u1 : u0;
          break;
        }
        case "trig": {
          const fn = p["Type"] ?? p["Func"] ?? p["Mode"] ?? 0; // 0:sin, 1:cos, 2:tan, 3:asin, 4:acos, 5:atan
          if (fn === 1) out = Math.cos(u0);
          else if (fn === 2) out = Math.tan(u0);
          else if (fn === 3) out = Math.asin(Math.max(-1, Math.min(1, u0)));
          else if (fn === 4) out = Math.acos(Math.max(-1, Math.min(1, u0)));
          else if (fn === 5) out = Math.atan(u0);
          else out = Math.sin(u0);
          break;
        }
        case "logic": {
          const fn = p["Type"] ?? p["Func"] ?? p["Mode"] ?? 0; // 0:AND, 1:OR, 2:XOR, 3:NOT, 4:NAND, 5:NOR
          const vals = b.inputs.length > 0 ? b.inputs.map((_, idx) => inVal(idx) > 0.5) : [u0 > 0.5, u1 > 0.5];
          const a = vals[0] ?? false;
          const c = vals[1] ?? false;
          if (fn === 1) out = vals.some(Boolean) ? 1 : 0;
          else if (fn === 2) out = a !== c ? 1 : 0;
          else if (fn === 3) out = !a ? 1 : 0;
          else if (fn === 4) out = !vals.every(Boolean) ? 1 : 0;
          else if (fn === 5) out = !vals.some(Boolean) ? 1 : 0;
          else out = vals.every(Boolean) ? 1 : 0;
          break;
        }
        case "zminusone":
          out = b.inputs[0] ? (this.prevValues.get(b.inputs[0]) ?? 0) : 0;
          break;
        case "bin_delay": {
          const tOn = Math.max(0, p["T"] ?? p["Ton"] ?? p["Delay"] ?? 0);
          const tOff = Math.max(0, p["Toff"] ?? tOn);
          const initOut = p["INITST"] ?? p["Init"] ?? 0;
          const prev = this.prevValues.get(b.id) ?? initOut;
          const wantHigh = u0 > 0.5;
          let ring = this.delayBuffers.get(b.id);
          if (!ring || ring.buf.length < 2) {
            ring = { buf: new Float64Array([initOut, 0]), idx: 0 };
            this.delayBuffers.set(b.id, ring);
          }
          const target = wantHigh ? 1 : 0;
          if (target !== (prev > 0.5 ? 1 : 0)) {
            ring.buf[1] = (ring.buf[1] ?? 0) + safeDt;
            const threshold = wantHigh ? tOn : tOff;
            if (ring.buf[1]! >= threshold) {
              out = target;
              ring.buf[0] = target;
              ring.buf[1] = 0;
            } else {
              out = prev;
            }
          } else {
            ring.buf[1] = 0;
            out = prev;
          }
          break;
        }
        case "tdelay": {
          const delaySec = Math.max(0, p["T"] ?? p["Delay"] ?? p["Td"] ?? 0);
          const steps = Math.max(1, Math.round(delaySec / safeDt));
          let ring = this.delayBuffers.get(b.id);
          if (!ring || ring.buf.length !== steps) {
            ring = { buf: new Float64Array(steps), idx: 0 };
            this.delayBuffers.set(b.id, ring);
          }
          out = ring.buf[ring.idx]!;
          ring.buf[ring.idx] = u0;
          ring.idx = (ring.idx + 1) % steps;
          break;
        }
        case "limit": {
          const lo = p["min"] ?? p["LL"] ?? p["Min"] ?? -Infinity;
          const hi = p["max"] ?? p["UL"] ?? p["Max"] ?? Infinity;
          out = Math.max(lo, Math.min(hi, u0));
          break;
        }
        case "ratelimit": {
          const rUp = Math.abs(p["IR"] ?? p["Rup"] ?? p["Up"] ?? p["MaxRate"] ?? p["Rpos"] ?? Infinity);
          const rDn = Math.abs(p["DR"] ?? p["Rdn"] ?? p["Down"] ?? p["MinRate"] ?? p["Rneg"] ?? rUp);
          const prev = this.prevValues.get(b.id) ?? u0;
          const maxDelta = rUp * safeDt;
          const minDelta = -rDn * safeDt;
          const delta = Math.max(minDelta, Math.min(maxDelta, u0 - prev));
          out = prev + delta;
          break;
        }
        case "xy_table": {
          const pts: { x: number; y: number }[] = [];
          for (let i = 1; i <= 32; i++) {
            const x = p[`X${i}`];
            const y = p[`Y${i}`];
            if (x !== undefined && y !== undefined) pts.push({ x, y });
          }
          if (pts.length < 2) {
            const nPts = Math.max(0, Math.round(p["N"] ?? 0));
            for (let k = 0; k < nPts; k++) {
              const x = p[`x${k}`] ?? k;
              const y = p[`y${k}`] ?? 0;
              pts.push({ x, y });
            }
          }
          if (pts.length >= 2) {
            let yVal = pts[0]!.y;
            for (let k = 0; k < pts.length - 1; k++) {
              const xk = pts[k]!.x;
              const xk1 = pts[k + 1]!.x;
              const yk = pts[k]!.y;
              const yk1 = pts[k + 1]!.y;
              if (u0 <= xk && k === 0) {
                yVal = yk;
                break;
              }
              if (u0 >= xk && u0 <= xk1 && Math.abs(xk1 - xk) > 1e-12) {
                yVal = yk + ((u0 - xk) / (xk1 - xk)) * (yk1 - yk);
                break;
              }
              yVal = yk1;
            }
            out = yVal;
          } else {
            out = (p["Gain"] ?? 1) * u0 + (p["Offset"] ?? 0);
          }
          break;
        }
        case "integral":
        case "fp_int": {
          const ti = p["T"] ?? p["Ti"] ?? 1;
          const lo = p["LL"] ?? p["Min"] ?? -Infinity;
          const hi = p["UL"] ?? p["Max"] ?? Infinity;
          const reset = b.inputs.length > 1 && u1 > 0.5;
          const yInit = p["Y0"] ?? p["Init"] ?? 0;
          const prev = reset ? yInit : (this.integrators.get(b.id) ?? yInit);
          const next = reset ? yInit : Math.max(lo, Math.min(hi, prev + (ti !== 0 ? (u0 / ti) * safeDt : 0)));
          this.integrators.set(b.id, next);
          out = next;
          break;
        }
        case "pi": {
          const kp = p["Kp"] ?? p["G"] ?? 1;
          const ti = p["Ti"] ?? p["T"] ?? 0.1;
          const ki = p["Ki"] ?? (ti > 0 ? kp / ti : 0);
          const lo = p["LL"] ?? p["Min"] ?? -Infinity;
          const hi = p["UL"] ?? p["Max"] ?? Infinity;
          const prevI = this.integrators.get(b.id) ?? 0;
          const candI = prevI + ki * u0 * safeDt;
          const rawOut = kp * u0 + candI;
          const clampedOut = Math.max(lo, Math.min(hi, rawOut));
          // Anti-windup: only integrate if not saturated or driving back inside limits
          if (rawOut === clampedOut || (rawOut > hi && u0 < 0) || (rawOut < lo && u0 > 0)) {
            this.integrators.set(b.id, candI);
          }
          out = clampedOut;
          break;
        }
        case "lag": {
          const g = p["G"] ?? p["K"] ?? 1;
          const tau = Math.max(0, p["T"] ?? p["Tau"] ?? 0.01);
          const st = this.filterStates.get(b.id) ?? { x1: u0, y1: g * u0, x2: 0, y2: 0 };
          if (tau <= 1e-12) {
            out = g * u0;
          } else {
            const a = safeDt / (2 * tau + safeDt);
            out = ((2 * tau - safeDt) / (2 * tau + safeDt)) * st.y1 + g * a * (u0 + st.x1);
          }
          this.filterStates.set(b.id, { x1: u0, y1: out, x2: 0, y2: 0 });
          break;
        }
        case "leadlag": {
          const g = p["G"] ?? p["K"] ?? 1;
          const t1 = Math.max(0, p["T1"] ?? p["Tlead"] ?? 0.05);
          const t2 = Math.max(0, p["T2"] ?? p["Tlag"] ?? 0.01);
          const st = this.filterStates.get(b.id) ?? { x1: u0, y1: g * u0, x2: 0, y2: 0 };
          if (t2 <= 1e-12) {
            out = g * (u0 + (t1 * (u0 - st.x1)) / safeDt);
          } else {
            const den = 2 * t2 + safeDt;
            out = ((2 * t2 - safeDt) / den) * st.y1 + (g * ((2 * t1 + safeDt) * u0 - (2 * t1 - safeDt) * st.x1)) / den;
          }
          this.filterStates.set(b.id, { x1: u0, y1: out, x2: 0, y2: 0 });
          break;
        }
        case "trans_filt": {
          // 1st-order general transfer function G*(b1*s + b0)/(a1*s + a0) via Tustin
          const b0 = p["B0"] ?? p["b0"] ?? 1;
          const b1 = p["B1"] ?? p["b1"] ?? 0;
          const a0 = p["A0"] ?? p["a0"] ?? 1;
          const a1 = p["A1"] ?? p["a1"] ?? 0.01;
          const st = this.filterStates.get(b.id) ?? { x1: u0, y1: 0, x2: 0, y2: 0 };
          const den = 2 * a1 + a0 * safeDt;
          if (Math.abs(den) < 1e-12) {
            out = u0;
          } else {
            out = ((2 * a1 - a0 * safeDt) * st.y1 + (2 * b1 + b0 * safeDt) * u0 - (2 * b1 - b0 * safeDt) * st.x1) / den;
          }
          this.filterStates.set(b.id, { x1: u0, y1: out, x2: 0, y2: 0 });
          break;
        }
        case "rms3ph": {
          const fBase = p["F"] ?? p["Freq"] ?? 60;
          const winSteps = Math.max(1, Math.round(1 / (fBase * safeDt)));
          let ring = this.delayBuffers.get(b.id);
          if (!ring || ring.buf.length !== winSteps) {
            ring = { buf: new Float64Array(winSteps), idx: 0 };
            this.delayBuffers.set(b.id, ring);
          }
          const sq = (u0 * u0 + u1 * u1 + u2 * u2) / 3;
          ring.buf[ring.idx] = sq;
          ring.idx = (ring.idx + 1) % winSteps;
          let sumSq = 0;
          for (let k = 0; k < winSteps; k++) sumSq += ring.buf[k]!;
          out = Math.sqrt(sumSq / winSteps);
          break;
        }
        case "abcdq0_d":
        case "abcdq0_q":
        case "abcdq0_0": {
          const theta = u3;
          const c = Math.cos(theta);
          const s = Math.sin(theta);
          const k23 = 2 / 3;
          if (b.kind === "abcdq0_d") {
            out = k23 * (u0 * c + u1 * Math.cos(theta - (2 * Math.PI) / 3) + u2 * Math.cos(theta + (2 * Math.PI) / 3));
          } else if (b.kind === "abcdq0_q") {
            out = -k23 * (u0 * s + u1 * Math.sin(theta - (2 * Math.PI) / 3) + u2 * Math.sin(theta + (2 * Math.PI) / 3));
          } else {
            out = (u0 + u1 + u2) / 3;
          }
          break;
        }
        case "inv_abcdq0_a":
        case "inv_abcdq0_b":
        case "inv_abcdq0_c": {
          const theta = u3;
          if (b.kind === "inv_abcdq0_a") {
            out = u0 * Math.cos(theta) - u1 * Math.sin(theta) + u2;
          } else if (b.kind === "inv_abcdq0_b") {
            out = u0 * Math.cos(theta - (2 * Math.PI) / 3) - u1 * Math.sin(theta - (2 * Math.PI) / 3) + u2;
          } else {
            out = u0 * Math.cos(theta + (2 * Math.PI) / 3) - u1 * Math.sin(theta + (2 * Math.PI) / 3) + u2;
          }
          break;
        }
        case "pll": {
          // 2nd-order SRF / single-phase PI Phase-Locked Loop
          // Inputs: 3-ph [Va, Vb, Vc] or 1-ph [V]; outputs tracked theta (rad) or f (Hz if OutMode === 1)
          const f0 = Math.max(1, p["F0"] ?? p["Freq"] ?? 60);
          const w0 = 2 * Math.PI * f0;
          const kp = p["Kp"] ?? p["KP"] ?? 180;
          const ki = p["Ki"] ?? p["KI"] ?? 3200;
          const st = this.customStates.get(b.id) ?? new Float64Array([0, w0, 0, 0, Math.max(1e-3, Math.abs(u0))]);
          const theta = st[0]!;
          let errPhase: number;
          if (b.inputs.length >= 3) {
            const c = Math.cos(theta);
            const s = Math.sin(theta);
            const c23 = -0.5;
            const s23 = Math.sqrt(3) * 0.5;
            const vd = (2 / 3) * (u0 * c + u1 * (c * c23 + s * s23) + u2 * (c * c23 - s * s23));
            const vq = (-2 / 3) * (u0 * s + u1 * (s * c23 - c * s23) + u2 * (s * c23 + c * s23));
            const vMag = Math.max(1e-3, Math.hypot(vd, vq));
            errPhase = Math.atan2(vq, Math.max(1e-3, vd));
            if (vMag < 1e-2) errPhase = 0;
          } else {
            const vPeakEst = Math.max(1e-3, p["VPeak"] ?? Math.max(st[4]! * 0.998, Math.abs(u0)));
            st[4] = vPeakEst;
            const rawErr = Math.max(-1, Math.min(1, ((2.0 * u0) / vPeakEst) * Math.cos(theta)));
            const alphaPll = Math.min(1, safeDt / 0.008);
            st[3] = st[3]! + alphaPll * (rawErr - st[3]!);
            errPhase = st[3]!;
          }
          st[2] = st[2]! + errPhase * safeDt;
          const wEst = Math.max(0.5 * w0, Math.min(1.5 * w0, w0 + kp * errPhase + ki * st[2]!));
          const nextTheta = (theta + wEst * safeDt) % (2 * Math.PI);
          st[0] = nextTheta < 0 ? nextTheta + 2 * Math.PI : nextTheta;
          st[1] = wEst;
          this.customStates.set(b.id, st);
          out = (p["OutMode"] ?? 0) === 1 ? wEst / (2 * Math.PI) : st[0]!;
          break;
        }
        case "freq_meas": {
          // Real-time positive-crossing / analytic frequency estimator outputting Hz
          const f0 = Math.max(1, p["F0"] ?? p["Freq"] ?? 60);
          const st = this.customStates.get(b.id) ?? new Float64Array([u0, 0, f0, 0]);
          const prevX = st[0]!;
          const prevCrossT = st[1]!;
          let fEst = st[2]!;
          const tPrev = this.elapsedSec - safeDt;
          if (prevX < 0 && u0 >= 0) {
            const frac = u0 - prevX > 1e-12 ? -prevX / (u0 - prevX) : 0.5;
            const tCross = tPrev + frac * safeDt;
            if (prevCrossT > 0) {
              const period = tCross - prevCrossT;
              if (period > 0.5 / f0 && period < 2.0 / f0) {
                const rawF = 1 / period;
                fEst = 0.7 * fEst + 0.3 * rawF;
              }
            }
            st[1] = tCross;
          }
          st[0] = u0;
          st[2] = fEst;
          this.customStates.set(b.id, st);
          out = fEst;
          break;
        }
        case "fft": {
          // 1-cycle sliding-window DFT magnitude for harmonic H at fundamental F0
          const f0 = Math.max(1, p["F0"] ?? p["Freq"] ?? 60);
          const harm = Math.max(1, Math.round(p["H"] ?? p["Harmonic"] ?? 1));
          const nWin = Math.max(4, Math.round(1 / (f0 * safeDt)));
          let ring = this.delayBuffers.get(b.id);
          if (!ring || ring.buf.length !== nWin) {
            ring = { buf: new Float64Array(nWin), idx: 0 };
            this.delayBuffers.set(b.id, ring);
          }
          ring.buf[ring.idx] = u0;
          ring.idx = (ring.idx + 1) % nWin;
          let re = 0;
          let im = 0;
          const dTheta = (2 * Math.PI * harm) / nWin;
          for (let k = 0; k < nWin; k++) {
            const sample = ring.buf[(ring.idx + k) % nWin]!;
            const ang = dTheta * k;
            re += sample * Math.cos(ang);
            im -= sample * Math.sin(ang);
          }
          out = (2 / nWin) * Math.hypot(re, im);
          break;
        }
        case "pwm": {
          // Triangle carrier PWM comparator
          const fSw = Math.max(50, p["Freq"] ?? p["Fc"] ?? 1980);
          const phase = (this.elapsedSec * fSw) % 1;
          const tri = phase < 0.5 ? -1 + 4 * phase : 3 - 4 * phase;
          const bipolar = (p["Bipolar"] ?? 0) === 1;
          out = u0 >= tri ? 1 : bipolar ? -1 : 0;
          break;
        }
        case "sample_hold": {
          const thresh = p["Thresh"] ?? 0.5;
          const st = this.customStates.get(b.id) ?? new Float64Array([p["Init"] ?? 0, u1]);
          const prevClk = st[1]!;
          if (prevClk <= thresh && u1 > thresh) {
            st[0] = u0;
          }
          st[1] = u1;
          this.customStates.set(b.id, st);
          out = st[0]!;
          break;
        }
        case "flip_flop": {
          // SR edge/level latch: u0 = Set, u1 = Reset
          const thresh = p["Thresh"] ?? 0.5;
          const st = this.customStates.get(b.id) ?? new Float64Array([p["Init"] ?? 0]);
          const sSet = u0 > thresh;
          const rRst = u1 > thresh;
          if (rRst && !sSet) st[0] = 0;
          else if (sSet && !rRst) st[0] = 1;
          this.customStates.set(b.id, st);
          out = st[0]!;
          break;
        }
        case "sequencer": {
          // Multi-stage timed sequencer (T1, T2, T3 -> stage 0..3 or scaled pulse)
          const t1 = p["T1"] ?? 0.02;
          const t2 = p["T2"] ?? 0.05;
          const t3 = p["T3"] ?? 0.1;
          out = this.elapsedSec >= t3 ? 3 : this.elapsedSec >= t2 ? 2 : this.elapsedSec >= t1 ? 1 : 0;
          break;
        }
        case "ieee_exciter": {
          // IEEE 421.5 Type 1 / ST1A AVR + stabilizer + saturation exciter ODE
          // st = [vr, efd, xf]
          const vRef = p["Vref"] ?? 1.05;
          const ka = p["KA"] ?? 200;
          const ta = Math.max(1e-3, p["TA"] ?? 0.02);
          const ke = p["KE"] ?? 1.0;
          const te = Math.max(1e-3, p["TE"] ?? 0.4);
          const kf = p["KF"] ?? 0.03;
          const tf = Math.max(1e-3, p["TF"] ?? 1.0);
          const vrMax = p["VRmax"] ?? 5.0;
          const vrMin = p["VRmin"] ?? -4.0;
          const vErr = vRef - (u0 > 0 ? u0 : vRef) + u1;
          const st = this.customStates.get(b.id) ?? new Float64Array([ke * 1.1, 1.1, 0]);
          let vr = st[0]!;
          let efd = st[1]!;
          let xf = st[2]!;
          const vFeedback = (kf / tf) * efd - xf;
          const dVr = ((ka * (vErr - vFeedback) - vr) / ta) * safeDt;
          vr = Math.max(vrMin, Math.min(vrMax, vr + dVr));
          const se = 0.02 * Math.max(0, efd - 1.0) ** 2;
          const dEfd = ((vr - ke * efd - se * efd) / te) * safeDt;
          efd = Math.max(0.05, Math.min(vrMax, efd + dEfd));
          xf += (((kf / tf) * efd - xf) / tf) * safeDt;
          st[0] = vr;
          st[1] = efd;
          st[2] = xf;
          this.customStates.set(b.id, st);
          out = efd;
          break;
        }
        case "ieee_governor": {
          // IEEE TGOV1 / HYGOV speed-droop governor + turbine lag ODE
          // Input u0: speed pu (defaults to 1.0 if disconnected)
          const pRef = p["Pref"] ?? 0.8;
          const rDroop = Math.max(0.01, p["R"] ?? 0.05);
          const t1 = Math.max(1e-3, p["T1"] ?? 0.1);
          const t2 = Math.max(0, p["T2"] ?? 1.0);
          const t3 = Math.max(1e-3, p["T3"] ?? 5.0);
          const vMax = p["Vmax"] ?? 1.2;
          const vMin = p["Vmin"] ?? 0.0;
          const wPu = u0 > 0.1 ? u0 : 1.0;
          const cmd = Math.max(vMin, Math.min(vMax, pRef + (1.0 - wPu) / rDroop));
          const st = this.customStates.get(b.id) ?? new Float64Array([pRef, pRef, pRef]);
          let gv = st[0]!;
          gv = Math.max(vMin, Math.min(vMax, gv + ((cmd - gv) / t1) * safeDt));
          const xPrev = st[1]!;
          const yPrev = st[2]!;
          const den = 2 * t3 + safeDt;
          const pMech = ((2 * t3 - safeDt) * yPrev + (2 * t2 + safeDt) * gv - (2 * t2 - safeDt) * xPrev) / den;
          st[0] = gv;
          st[1] = gv;
          st[2] = Math.max(vMin, Math.min(vMax, pMech));
          this.customStates.set(b.id, st);
          out = st[2]!;
          break;
        }
        case "ieee_pss": {
          // IEEE PSS1A washout + 2-stage lead-lag stabilizer
          // st = [xPrevW, yW, xPrev1, y1, xPrev2, y2]
          const kPss = p["Ks"] ?? p["K"] ?? 10;
          const tw = Math.max(0.1, p["Tw"] ?? 5.0);
          const t1 = Math.max(0, p["T1"] ?? 0.3);
          const t2 = Math.max(1e-3, p["T2"] ?? 0.05);
          const t3 = Math.max(0, p["T3"] ?? 0.3);
          const t4 = Math.max(1e-3, p["T4"] ?? 0.05);
          const vsMax = p["Vsmax"] ?? 0.1;
          const vsMin = p["Vsmin"] ?? -0.1;
          const st = this.customStates.get(b.id) ?? new Float64Array([u0, 0, 0, 0, 0, 0]);
          const uScaled = kPss * (u0 - (p["W0"] ?? 1.0));
          const denW = 2 * tw + safeDt;
          const yW = ((2 * tw - safeDt) * st[1]! + 2 * tw * (uScaled - st[0]!)) / denW;
          const den1 = 2 * t2 + safeDt;
          const y1 = ((2 * t2 - safeDt) * st[3]! + (2 * t1 + safeDt) * yW - (2 * t1 - safeDt) * st[2]!) / den1;
          const den2 = 2 * t4 + safeDt;
          const y2 = ((2 * t4 - safeDt) * st[5]! + (2 * t3 + safeDt) * y1 - (2 * t3 - safeDt) * st[4]!) / den2;
          st[0] = uScaled;
          st[1] = yW;
          st[2] = yW;
          st[3] = y1;
          st[4] = y1;
          st[5] = Math.max(vsMin, Math.min(vsMax, y2));
          this.customStates.set(b.id, st);
          out = st[5]!;
          break;
        }
        case "wecc_ibr": {
          // WECC REGC_A / REEC_A / REPC_A Generic Renewable Current Injection Controller
          // Inputs: u0 = V_pu, u1 = f_pu (optional); outputs reactive or active current command with LVPL & FRT Q-priority
          const vRef = p["Vref"] ?? 1.0;
          const kqv = p["Kqv"] ?? 2.0;
          const dbd = p["dbd"] ?? 0.05;
          const tg = Math.max(1e-3, p["Tg"] ?? 0.02);
          const iMax = p["Imax"] ?? 1.1;
          const pRef = p["Pref"] ?? 0.8;
          const vPu = u0 > 0.01 ? u0 : 1.0;
          const st = this.customStates.get(b.id) ?? new Float64Array([pRef, 0]);
          const vErr = vRef - vPu;
          const iqRaw = Math.abs(vErr) > dbd ? kqv * (vErr - Math.sign(vErr) * dbd) : 0;
          const iqTgt = Math.max(-iMax, Math.min(iMax, iqRaw));
          const ipCap = Math.sqrt(Math.max(0, iMax * iMax - iqTgt * iqTgt));
          const lvplScale = vPu < 0.9 ? Math.max(0, (vPu - 0.2) / 0.7) : 1.0;
          const ipTgt = Math.min(ipCap, Math.max(0, pRef / Math.max(0.2, vPu)) * lvplScale);
          st[0] = st[0]! + ((ipTgt - st[0]!) / tg) * safeDt;
          st[1] = st[1]! + ((iqTgt - st[1]!) / tg) * safeDt;
          this.customStates.set(b.id, st);
          out = (p["Mode"] ?? 0) === 1 ? st[1]! : st[0]!;
          break;
        }
        default: {
          const _exhaustive: never = b.kind;
          out = _exhaustive ? u0 : u0;
          break;
        }
      }

      this.values.set(b.id, out);
    }

    return this.values;
  }
}
