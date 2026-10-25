// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD Continuous System Model Functions (CSMF) Control Block Graph Evaluator.
 *
 * Implements topological sorting and Bilinear Tustin (Trapezoidal) discrete-time
 * state-space evaluation for PSCAD control blocks (PI controllers with anti-windup,
 * first-order lags / real poles, lead-lag compensators, summers, gains, limiters,
 * comparators, and electrical sensors/actuators).
 */

export type CsmfBlockKind =
  | "const"
  | "sensor_v"
  | "sensor_i"
  | "gain"
  | "sum"
  | "mult"
  | "div"
  | "limit"
  | "pi"
  | "lag"
  | "leadlag"
  | "compar"
  | "square"
  | "inv"
  | "integral"
  | "fp_int"
  | "abcdq0_d"
  | "abcdq0_q"
  | "abcdq0_0"
  | "select"
  | "upramp"
  | "tbreakn"
  | "x_power_y"
  | "angle_resolver"
  | "maxmin"
  | "rms3ph"
  | "compare"
  | "range"
  | "ratelimit"
  | "xy_table"
  | "bin_delay"
  | "trans_filt"
  | "trig"
  | "logic"
  | "time_sig"
  | "inv_abcdq0_a"
  | "inv_abcdq0_b"
  | "inv_abcdq0_c";

export interface CsmfActuatorBinding {
  kind?: "breaker_trip" | "breaker_status" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv" | undefined;
  type?: "breaker_trip" | "breaker_status" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv" | undefined;
  elementId?: string | undefined;
  targetId?: string | undefined;
}

export interface CsmfBlockConfig {
  id: string;
  kind: CsmfBlockKind;
  inputs?: string[] | undefined; // Upstream block IDs
  signs?: number[] | undefined; // +1 or -1 for each input of a 'sum' block
  value?: number | undefined; // For 'const' or comparator threshold
  kp?: number | undefined; // Proportional gain (for 'gain' or 'pi')
  ki?: number | undefined; // Integral gain 1/Ti (for 'pi')
  tiSec?: number | undefined; // Integral time constant Ti (for 'pi', ki = 1 / tiSec)
  t1Sec?: number | undefined; // Time constant T (for 'lag') or lead T1 (for 'leadlag')
  t2Sec?: number | undefined; // Lag time constant T2 (for 'leadlag')
  minOut?: number | undefined; // Lower saturation limit
  maxOut?: number | undefined; // Upper saturation limit
  sensorTarget?: string | undefined; // Bus name (for 'sensor_v') or branch ID (for 'sensor_i')
  sensorRms?: boolean | undefined; // If true, computes half-cycle/sliding RMS of sensed signal
  params?: Record<string, string | number> | undefined; // Optional PSCAD parameter dictionary
  actuator?: CsmfActuatorBinding | undefined; // Optional feedback binding to electrical apparatus
}

export interface CsmfBlockRuntimeState {
  config: CsmfBlockConfig;
  inputIndices: Int32Array;
  signs: Float64Array;
  uPrev: number;
  yPrev: number;
  integralState: number;
  rmsSqSum: number;
  rmsBuffer: Float64Array;
  rmsIdx: number;
  rmsCount: number;
  output: number;
}

export class CsmfControlGraph {
  public readonly blocks: CsmfBlockRuntimeState[];
  public readonly blockMap = new Map<string, number>();
  private readonly dt: number;
  /** Elapsed simulation time, advanced by one `dt` after each `step()`. */
  private elapsed = 0;

  constructor(configs: CsmfBlockConfig[], dt: number, nominalFreqHz = 60.0) {
    this.dt = dt;
    const sorted = CsmfControlGraph.topologicalSort(configs);
    const rmsWin = Math.max(2, Math.round(1.0 / (nominalFreqHz * dt)));

    this.blocks = sorted.map((cfg, idx) => {
      this.blockMap.set(cfg.id, idx);
      const p = cfg.params ?? {};
      const defaultSigns =
        cfg.signs ??
        (p["s1"] !== undefined || p["s2"] !== undefined
          ? [Number(p["s1"] ?? 1), Number(p["s2"] ?? 1), Number(p["s3"] ?? 1)]
          : cfg.inputs
            ? cfg.inputs.map(() => 1)
            : [1]);
      const initConst = Number(cfg.value ?? p["value"] ?? p["K"] ?? p["k"] ?? 0);
      const isRms = Boolean(cfg.sensorRms || String(p["mode"] ?? "").toLowerCase() === "rms");

      return {
        config: cfg,
        inputIndices: new Int32Array(0),
        signs: new Float64Array(defaultSigns),
        uPrev: 0,
        yPrev: cfg.kind === "const" ? initConst : 0,
        integralState: 0,
        rmsSqSum: 0,
        rmsBuffer: new Float64Array(isRms ? rmsWin : 0),
        rmsIdx: 0,
        rmsCount: 0,
        output: cfg.kind === "const" ? initConst : 0,
      };
    });

    // Resolve upstream block indices
    for (const st of this.blocks) {
      const ins = st.config.inputs ?? [];
      st.inputIndices = new Int32Array(ins.map((id) => this.blockMap.get(id) ?? -1));
    }
  }

  public getBlockIds(): string[] {
    return this.blocks.map((b) => b.config.id);
  }

  public getOutput(blockId: string): number {
    const idx = this.blockMap.get(blockId);
    return idx !== undefined ? (this.blocks[idx]?.output ?? 0) : 0;
  }

  public getActuators(): {
    type: "breaker_trip" | "breaker_status" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv";
    targetId: string;
    value: number;
  }[] {
    const list: {
      type: "breaker_trip" | "breaker_status" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv";
      targetId: string;
      value: number;
    }[] = [];
    for (const b of this.blocks) {
      const act = b.config.actuator;
      if (act) {
        const type = act.type ?? act.kind;
        const targetId = act.targetId ?? act.elementId;
        if (type && targetId) {
          list.push({ type, targetId, value: b.output });
        }
      }
    }
    return list;
  }

  /**
   * Performs Kahn's topological sort on CSMF blocks, breaking feedback loops at dynamic
   * delay/state blocks ('pi', 'lag', 'leadlag').
   */
  public static topologicalSort(configs: CsmfBlockConfig[]): CsmfBlockConfig[] {
    if (configs.length <= 1) return [...configs];

    const byId = new Map<string, CsmfBlockConfig>();
    for (const c of configs) byId.set(c.id, c);

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: CsmfBlockConfig[] = [];

    const visit = (cfg: CsmfBlockConfig) => {
      if (visited.has(cfg.id)) return;
      if (visiting.has(cfg.id)) return; // Break algebraic/feedback cycle at state boundary
      visiting.add(cfg.id);
      for (const inpId of cfg.inputs ?? []) {
        const up = byId.get(inpId);
        if (up) visit(up);
      }
      visiting.delete(cfg.id);
      visited.add(cfg.id);
      result.push(cfg);
    };

    for (const c of configs) {
      visit(c);
    }
    return result;
  }

  /**
   * Evaluates all CSMF control blocks for the current time step using Bilinear Tustin integration.
   */
  public step(
    getBusVoltage: (busName: string, phaseIdx?: number) => number,
    getBranchCurrent: (branchId: string, phaseIdx?: number) => number,
    getExternalSignal?: ((signalId: string) => number | undefined) | undefined,
  ): void {
    const dt = this.dt;

    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i]!;
      const cfg = b.config;
      const p = cfg.params ?? {};

      const getInVal = (k: number): number => {
        const idx = b.inputIndices[k] ?? -1;
        if (idx >= 0) return this.blocks[idx]!.output;
        if (getExternalSignal) {
          const inpName = cfg.inputs?.[k];
          if (inpName) {
            const ext = getExternalSignal(inpName);
            if (ext !== undefined) return ext;
          }
        }
        return 0;
      };

      const inIdx0 = b.inputIndices[0] ?? -1;
      const u0 = inIdx0 >= 0 ? this.blocks[inIdx0]!.output : getInVal(0);
      const inIdx1 = b.inputIndices[1] ?? -1;
      const u1 =
        inIdx1 >= 0
          ? this.blocks[inIdx1]!.output
          : getExternalSignal && cfg.inputs?.[1] && getExternalSignal(cfg.inputs[1]) !== undefined
            ? getExternalSignal(cfg.inputs[1])!
            : Number(cfg.value ?? p["threshold"] ?? p["value"] ?? 0);

      let y = 0;

      switch (cfg.kind) {
        case "const": {
          y = Number(cfg.value ?? p["value"] ?? p["K"] ?? p["k"] ?? 0);
          break;
        }
        case "time_sig": {
          y = this.elapsed;
          break;
        }
        case "logic": {
          // Multi-input gate. Type: 0 AND, 1 OR, 2 NAND, 3 NOR, 4 XOR, 5 XNOR. Inv1..InvN invert input pins,
          // Inv inverts the final output. Inputs are truthy above 0.5.
          const inCount = Math.max(b.inputIndices.length, cfg.inputs?.length ?? 0);
          const n = Math.min(inCount, Math.trunc(Number(p["Num_in"] ?? inCount)));
          const bits: boolean[] = [];
          for (let k = 0; k < n; k++) {
            let v = getInVal(k) > 0.5;
            if (Number(p[`Inv${k + 1}`] ?? 0) === 1) v = !v;
            bits.push(v);
          }
          const type = Math.trunc(Number(p["Type"] ?? 0));
          const ones = bits.filter(Boolean).length;
          let out: boolean;
          switch (type) {
            case 1:
              out = ones > 0;
              break;
            case 2:
              out = !(n > 0 && ones === n);
              break;
            case 3:
              out = ones === 0;
              break;
            case 4:
              out = ones % 2 === 1;
              break;
            case 5:
              out = ones % 2 === 0;
              break;
            default:
              out = n > 0 && ones === n;
          }
          if (Number(p["Inv"] ?? 0) === 1) out = !out;
          y = out ? 1 : 0;
          break;
        }
        case "trig": {
          // Type is 1-based: 1 = sin, 2 = cos (input in radians). Other types are rejected by the netlist.
          const type = Math.trunc(Number(p["Type"] ?? 1));
          y = type === 2 ? Math.cos(u0) : type === 1 ? Math.sin(u0) : 0;
          break;
        }
        case "upramp": {
          // Piecewise-linear ramp of the input: 0 up to X1, linear to Y2 at X2, then held at Y2.
          const x1 = Number(p["X1"] ?? 0);
          const x2 = Number(p["X2"] ?? 1);
          const y2 = Number(p["Y2"] ?? 1);
          y = u0 <= x1 ? 0 : u0 >= x2 ? y2 : (y2 / (x2 - x1)) * (u0 - x1);
          break;
        }
        case "tbreakn": {
          // Timed breaker logic: status 0 = closed, 1 = open (unverified). INIT = 1 starts closed; the state
          // flips at TO1 (NUMS >= 1) and flips back at TO2 (NUMS = 2).
          const t = this.elapsed;
          const initClosed = Number(p["INIT"] ?? 1) === 1;
          const nums = Math.trunc(Number(p["NUMS"] ?? 1));
          let closed = initClosed;
          if (nums >= 1 && t >= Number(p["TO1"] ?? 0)) closed = !closed;
          if (nums >= 2 && t >= Number(p["TO2"] ?? 0)) closed = !closed;
          y = closed ? 0 : 1;
          break;
        }
        case "x_power_y": {
          // in^y; a negative base is clamped to 0 when xneg = 0 (unverified), otherwise passed to Math.pow.
          const base = u0 < 0 && Number(p["xneg"] ?? 0) === 0 ? 0 : u0;
          const pw = Math.pow(base, Number(p["y"] ?? 1));
          y = Number.isFinite(pw) ? pw : 0;
          break;
        }
        case "angle_resolver": {
          // Radians in, radians out, wrapped to [-pi, pi] (only the all-zero unit/range flags are supported).
          let a = u0 % (2 * Math.PI);
          if (a > Math.PI) a -= 2 * Math.PI;
          else if (a < -Math.PI) a += 2 * Math.PI;
          y = a;
          break;
        }
        case "maxmin": {
          // Maximum (Type 1, default) or minimum (Type 2) over all connected inputs; one input passes through.
          const inCount = Math.max(b.inputIndices.length, cfg.inputs?.length ?? 0);
          const vals: number[] = [];
          for (let k = 0; k < inCount; k++) vals.push(getInVal(k));
          if (vals.length === 0) vals.push(0);
          y = Math.trunc(Number(p["Type"] ?? 1)) === 2 ? Math.min(...vals) : Math.max(...vals);
          break;
        }
        case "rms3ph": {
          // sqrt of the mean square of the three phases, smoothed by a first-order lag of time constant Ts.
          const raw = Math.sqrt(Math.max(0, (getInVal(0) ** 2 + getInVal(1) ** 2 + getInVal(2) ** 2) / 3));
          if (b.rmsCount === 0) {
            b.yPrev = Number(p["Vinit"] ?? 0);
            b.rmsCount = 1;
          }
          const alpha = dt / (Math.max(0, Number(p["Ts"] ?? 0)) + dt);
          y = alpha * raw + (1 - alpha) * b.yPrev;
          break;
        }
        case "compare": {
          // Single-input comparator against the constant X: OH when input > X, else OL; conv rounds the result.
          const o = u0 > Number(p["X"] ?? 0) ? Number(p["OH"] ?? 1) : Number(p["OL"] ?? 0);
          y = Number(p["conv"] ?? 0) === 1 ? Math.round(o) : o;
          break;
        }
        case "range": {
          // Band comparator: OL below XL, OH above XU, OM otherwise (boundaries are OM). conv rounds the result.
          const xl = Number(p["XL"] ?? 0);
          const xu = Number(p["XU"] ?? 0);
          const o = u0 < xl ? Number(p["OL"] ?? 0) : u0 > xu ? Number(p["OH"] ?? 0) : Number(p["OM"] ?? 0);
          y = Number(p["conv"] ?? 0) === 1 ? Math.round(o) : o;
          break;
        }
        case "trans_filt": {
          // Order 1/2 Butterworth low-pass at FBase (bilinear transform, prewarped), assuming Band=1 is low-pass
          // and Type=1 is Butterworth (unverified numbering). Any other configuration passes the input through.
          const order = Math.trunc(Number(p["Order"] ?? 0));
          const fc = Number(p["FBase"] ?? 0);
          const supported =
            Math.trunc(Number(p["Band"] ?? 0)) === 1 &&
            Math.trunc(Number(p["Type"] ?? 0)) === 1 &&
            (order === 1 || order === 2) &&
            fc > 0 &&
            fc < 0.5 / dt;
          if (!supported) {
            y = u0;
            break;
          }
          if (b.rmsCount === 0) {
            // Start settled at the first input so DC passes without a start-up transient.
            b.uPrev = u0;
            b.yPrev = u0;
            b.rmsSqSum = u0;
            b.integralState = u0;
            b.rmsCount = 1;
          }
          const k = Math.tan(Math.PI * fc * dt);
          if (order === 1) {
            const b0 = k / (1 + k);
            const a1 = (k - 1) / (1 + k);
            y = b0 * (u0 + b.uPrev) - a1 * b.yPrev;
          } else {
            const k2 = k * k;
            const norm = 1 / (1 + Math.SQRT2 * k + k2);
            const b0 = k2 * norm;
            const a1 = 2 * (k2 - 1) * norm;
            const a2 = (1 - Math.SQRT2 * k + k2) * norm;
            y = b0 * (u0 + 2 * b.uPrev + b.rmsSqSum) - a1 * b.yPrev - a2 * b.integralState;
            b.rmsSqSum = b.uPrev; // x[n-2] for the next step
            b.integralState = b.yPrev; // y[n-2] for the next step
          }
          break;
        }
        case "bin_delay": {
          // Binary on/off delay: a change of the thresholded (> 0.5) input is committed to the output only after
          // it has persisted for T (rising) or Toff (falling) seconds. Starts at INITST (unverified semantics).
          if (b.rmsCount === 0) {
            b.yPrev = Number(p["INITST"] ?? 0) > 0.5 ? 1 : 0;
            b.integralState = 0;
            b.rmsCount = 1;
          }
          const inputOn = u0 > 0.5;
          if (inputOn === b.yPrev > 0.5) {
            b.integralState = 0;
          } else {
            b.integralState += dt;
            const delay = Math.max(0, Number(inputOn ? (p["T"] ?? 0) : (p["Toff"] ?? 0)));
            if (b.integralState >= delay) {
              b.yPrev = inputOn ? 1 : 0;
              b.integralState = 0;
            }
          }
          y = b.yPrev;
          break;
        }
        case "xy_table": {
          // Piecewise-linear lookup through (X1,Y1)..(XN,YN), held at the end values outside the range.
          // x' = Kx*(u + Xoff), y = Ky*f(x') + Yoff (offset/gain order unverified; neutral in the corpus).
          const n = Math.max(0, Math.trunc(Number(p["N"] ?? 0)));
          const xs: number[] = [];
          const ys: number[] = [];
          for (let k = 1; k <= n; k++) {
            const xv = Number(p[`X${k}`]);
            const yv = Number(p[`Y${k}`]);
            if (Number.isFinite(xv) && Number.isFinite(yv)) {
              xs.push(xv);
              ys.push(yv);
            }
          }
          const xq = Number(p["Kx"] ?? 1) * (u0 + Number(p["Xoff"] ?? 0));
          let f = 0;
          if (xs.length > 0) {
            if (xq <= xs[0]!) f = ys[0]!;
            else if (xq >= xs[xs.length - 1]!) f = ys[ys.length - 1]!;
            else {
              for (let k = 1; k < xs.length; k++) {
                if (xq <= xs[k]!) {
                  const dx = xs[k]! - xs[k - 1]!;
                  f = dx > 0 ? ys[k - 1]! + ((ys[k]! - ys[k - 1]!) * (xq - xs[k - 1]!)) / dx : ys[k]!;
                  break;
                }
              }
            }
          }
          y = Number(p["Ky"] ?? 1) * f + Number(p["Yoff"] ?? 0);
          break;
        }
        case "ratelimit": {
          // Slew limiter: rise <= IR*dt, fall <= DR*dt per step; first step passes the input through.
          if (b.rmsCount === 0) {
            y = u0;
            b.rmsCount = 1;
          } else {
            const ir = Number(p["IR"] ?? Infinity);
            const dr = Number(p["DR"] ?? Infinity);
            const dx = u0 - b.yPrev;
            y = b.yPrev + Math.min(Math.max(dx, -dr * this.dt), ir * this.dt);
          }
          break;
        }
        case "select": {
          // Two-input selector: inputs [A, B, Ctrl]; A passes when Ctrl equals the integer selection value.
          const idx2 = b.inputIndices[2] ?? -1;
          const ctrl = idx2 >= 0 ? this.blocks[idx2]!.output : 0;
          const opval = Number(p["A"] ?? p["OPVAL"] ?? 1);
          y = Math.trunc(ctrl) === Math.trunc(opval) ? u0 : u1;
          break;
        }
        case "sensor_v":
        case "sensor_i": {
          const target = String(cfg.sensorTarget ?? p["bus"] ?? p["branch"] ?? "");
          const phaseIdx = Number(p["phase"] ?? 0);
          const raw = cfg.kind === "sensor_v" ? getBusVoltage(target, phaseIdx) : getBranchCurrent(target, phaseIdx);
          const mode = String(p["mode"] ?? (cfg.sensorRms ? "rms" : "instant")).toLowerCase();
          if (mode === "rms" && b.rmsBuffer.length > 0) {
            const sq = raw * raw;
            b.rmsSqSum -= b.rmsBuffer[b.rmsIdx]!;
            b.rmsSqSum += sq;
            b.rmsBuffer[b.rmsIdx] = sq;
            b.rmsIdx = (b.rmsIdx + 1) % b.rmsBuffer.length;
            if (b.rmsCount < b.rmsBuffer.length) b.rmsCount++;
            y = Math.sqrt(Math.max(0, b.rmsSqSum / Math.max(1, b.rmsCount)));
          } else if (mode === "peak" || mode === "abs") {
            y = Math.abs(raw);
          } else {
            y = raw;
          }
          const scale = cfg.kp ?? (p["K"] !== undefined ? Number(p["K"]) : undefined);
          if (scale !== undefined) y *= scale;
          break;
        }
        case "gain": {
          const gainK = Number(cfg.kp ?? cfg.value ?? p["K"] ?? p["k"] ?? p["G"] ?? 1.0);
          y = gainK * u0;
          break;
        }
        case "sum": {
          let acc = 0;
          const count = Math.max(b.inputIndices.length, cfg.inputs?.length ?? 0);
          for (let k = 0; k < count; k++) {
            const sign = b.signs[k] ?? 1.0;
            acc += sign * getInVal(k);
          }
          y = acc;
          break;
        }
        case "mult": {
          y = u0 * u1;
          break;
        }
        case "div": {
          const safeDen = Math.abs(u1) < 1e-9 ? (u1 >= 0 ? 1e-9 : -1e-9) : u1;
          y = u0 / safeDen;
          break;
        }
        case "limit": {
          const minV = Number(cfg.minOut ?? p["min"] ?? p["LL"] ?? -Infinity);
          const maxV = Number(cfg.maxOut ?? p["max"] ?? p["UL"] ?? Infinity);
          y = Math.min(maxV, Math.max(minV, u0));
          break;
        }
        case "pi": {
          // Bilinear Tustin PI controller with anti-windup clamping
          const kp = Number(cfg.kp ?? p["Kp"] ?? p["kp"] ?? p["GP"] ?? 1.0);
          const ti = Number(cfg.tiSec ?? p["Ti"] ?? p["ti"] ?? p["TI"] ?? 0);
          const ki = Number(cfg.ki ?? p["Ki"] ?? p["ki"] ?? (ti > 0 ? 1.0 / ti : 1.0));
          const minV = Number(cfg.minOut ?? p["min"] ?? p["LL"] ?? -Infinity);
          const maxV = Number(cfg.maxOut ?? p["max"] ?? p["UL"] ?? Infinity);

          let nextInt = b.integralState + 0.5 * ki * dt * (u0 + b.uPrev);
          nextInt = Math.min(maxV, Math.max(minV, nextInt));
          b.integralState = nextInt;
          y = Math.min(maxV, Math.max(minV, kp * u0 + nextInt));
          break;
        }
        case "lag": {
          // First-order filter G / (1 + s * T1) via Bilinear Tustin
          const g = Number(cfg.kp ?? p["K"] ?? p["G"] ?? 1.0);
          const T = Math.max(1e-9, Number(cfg.t1Sec ?? p["T"] ?? p["T1"] ?? 0.01));
          const a = (2 * T - dt) / (2 * T + dt);
          const c = (g * dt) / (2 * T + dt);
          y = a * b.yPrev + c * (u0 + b.uPrev);
          break;
        }
        case "leadlag": {
          // Lead-Lag G * (1 + s * T1) / (1 + s * T2) via Bilinear Tustin
          const g = Number(cfg.kp ?? p["K"] ?? p["G"] ?? 1.0);
          const T1 = Math.max(0, Number(cfg.t1Sec ?? p["T1"] ?? 0.01));
          const T2 = Math.max(1e-9, Number(cfg.t2Sec ?? p["T2"] ?? 0.01));
          const denom = 2 * T2 + dt;
          const a = (2 * T2 - dt) / denom;
          const b0 = (g * (2 * T1 + dt)) / denom;
          const b1 = (g * (dt - 2 * T1)) / denom;
          y = a * b.yPrev + b0 * u0 + b1 * b.uPrev;
          break;
        }
        case "square": {
          y = u0 * u0;
          break;
        }
        case "inv": {
          // Memoryless 1/x; a zero input is trapped to the configured output limit (default 1e6).
          const lim = Number(cfg.maxOut ?? p["max"] ?? p["UL"] ?? 1e6);
          y = u0 === 0 ? lim : 1.0 / u0;
          break;
        }
        case "integral": {
          // Trapezoidal integration: Y(t) = Y(t-dt) + dt/2 * (X(t) + X(t-dt)); optional initial value.
          const k = Number(cfg.kp ?? p["K"] ?? p["G"] ?? 1.0);
          const lo = Number(cfg.minOut ?? p["min"] ?? p["LL"] ?? -Infinity);
          const hi = Number(cfg.maxOut ?? p["max"] ?? p["UL"] ?? Infinity);
          b.integralState += 0.5 * k * dt * (u0 + b.uPrev);
          b.integralState = Math.min(hi, Math.max(lo, b.integralState));
          y = b.integralState;
          break;
        }
        case "abcdq0_d":
        case "abcdq0_q":
        case "abcdq0_0": {
          // Park transform split into one single-output block per axis. Inputs: [a, b, c, theta].
          const [a, bb, c, th] = [getInVal(0), getInVal(1), getInVal(2), getInVal(3)];
          const t2 = (2 * Math.PI) / 3;
          if (cfg.kind === "abcdq0_d") {
            y = (2 / 3) * (a * Math.cos(th) + bb * Math.cos(th - t2) + c * Math.cos(th + t2));
          } else if (cfg.kind === "abcdq0_q") {
            y = (-2 / 3) * (a * Math.sin(th) + bb * Math.sin(th - t2) + c * Math.sin(th + t2));
          } else {
            y = (a + bb + c) / 3;
          }
          break;
        }
        case "inv_abcdq0_a":
        case "inv_abcdq0_b":
        case "inv_abcdq0_c": {
          // Inverse Park: inputs [d, q, zero, theta].
          const [d, q, z, th] = [getInVal(0), getInVal(1), getInVal(2), getInVal(3)];
          const t2 = (2 * Math.PI) / 3;
          const ang = cfg.kind === "inv_abcdq0_a" ? th : cfg.kind === "inv_abcdq0_b" ? th - t2 : th + t2;
          y = d * Math.cos(ang) - q * Math.sin(ang) + z;
          break;
        }
        case "fp_int": {
          // Real -> Integer conversion with truncation toward zero (Fortran INT semantics).
          y = Math.trunc(u0);
          break;
        }
        case "compar": {
          const highVal = Number(p["high"] ?? 1.0);
          const lowVal = Number(p["low"] ?? 0.0);
          y = u0 >= u1 ? highVal : lowVal;
          break;
        }
      }

      if (cfg.kind !== "limit" && cfg.kind !== "pi" && cfg.kind !== "integral") {
        if (cfg.minOut !== undefined && y < cfg.minOut) y = cfg.minOut;
        if (cfg.maxOut !== undefined && y > cfg.maxOut) y = cfg.maxOut;
      }

      b.uPrev = u0;
      b.yPrev = y;
      b.output = y;
    }
    this.elapsed += dt;
  }
}
