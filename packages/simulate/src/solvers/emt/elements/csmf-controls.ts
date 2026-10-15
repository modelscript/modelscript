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
  | "compar";

export interface CsmfActuatorBinding {
  kind?: "breaker_trip" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv" | undefined;
  type?: "breaker_trip" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv" | undefined;
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
    type: "breaker_trip" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv";
    targetId: string;
    value: number;
  }[] {
    const list: {
      type: "breaker_trip" | "fmu_p_mw" | "fmu_q_mvar" | "source_v_kv";
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
  ): void {
    const dt = this.dt;

    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i]!;
      const cfg = b.config;
      const p = cfg.params ?? {};
      const inIdx0 = b.inputIndices[0] ?? -1;
      const u0 = inIdx0 >= 0 ? this.blocks[inIdx0]!.output : 0;
      const inIdx1 = b.inputIndices[1] ?? -1;
      const u1 = inIdx1 >= 0 ? this.blocks[inIdx1]!.output : Number(cfg.value ?? p["threshold"] ?? p["value"] ?? 0);

      let y = 0;

      switch (cfg.kind) {
        case "const": {
          y = Number(cfg.value ?? p["value"] ?? p["K"] ?? p["k"] ?? 0);
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
          for (let k = 0; k < b.inputIndices.length; k++) {
            const idx = b.inputIndices[k]!;
            const sign = b.signs[k] ?? 1.0;
            const val = idx >= 0 ? this.blocks[idx]!.output : 0;
            acc += sign * val;
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
        case "compar": {
          const highVal = Number(p["high"] ?? 1.0);
          const lowVal = Number(p["low"] ?? 0.0);
          y = u0 >= u1 ? highVal : lowVal;
          break;
        }
      }

      if (cfg.kind !== "limit" && cfg.kind !== "pi") {
        if (cfg.minOut !== undefined && y < cfg.minOut) y = cfg.minOut;
        if (cfg.maxOut !== undefined && y > cfg.maxOut) y = cfg.maxOut;
      }

      b.uPrev = u0;
      b.yPrev = y;
      b.output = y;
    }
  }
}
