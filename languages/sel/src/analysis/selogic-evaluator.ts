// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CurveStandard, SELRelaySettings, SettingsGroup } from "../types.js";

/**
 * IEEE Standard C37.112 / SEL Curve Parameters:
 * t = TD * ( A / (M^p - 1) + B )
 */
export interface CurveParameters {
  A: number;
  B: number;
  p: number;
}

export const SEL_CURVES: Record<CurveStandard, CurveParameters> = {
  U1: { A: 0.0226, B: 0.0104, p: 0.02 }, // Moderately Inverse
  U2: { A: 0.18, B: 0.0593, p: 0.02 }, // Inverse
  U3: { A: 19.61, B: 0.491, p: 2.0 }, // Very Inverse
  U4: { A: 28.2, B: 0.1217, p: 2.0 }, // Extremely Inverse
  U5: { A: 0.00342, B: 0.00262, p: 0.02 }, // Short-Time Inverse
  C1: { A: 0.14, B: 0.0, p: 0.02 }, // IEC Standard Inverse
  C2: { A: 13.5, B: 0.0, p: 1.0 }, // IEC Very Inverse
  C3: { A: 80.0, B: 0.0, p: 2.0 }, // IEC Extremely Inverse
  C4: { A: 120.0, B: 0.0, p: 1.0 }, // IEC Long-Time Inverse
  C5: { A: 0.05, B: 0.0, p: 0.04 }, // IEC Short-Time Inverse
};

/**
 * Calculates trip time (seconds) for IEEE / IEC time-overcurrent curve.
 */
export function calculateOvercurrentTime(
  current: number,
  pickup: number,
  timeDial: number,
  curve: CurveStandard = "U3",
): number {
  if (current <= pickup) {
    return Infinity;
  }
  const M = current / pickup;
  const p = SEL_CURVES[curve] ?? SEL_CURVES.U3;
  const denom = Math.pow(M, p.p) - 1.0;
  if (denom <= 0) return Infinity;
  return timeDial * (p.A / denom + p.B);
}

/**
 * Tokenizes a SELogic boolean expression into tokens.
 */
export function tokenizeSELogic(expr: string): string[] {
  const regex = /\s*([()!]|AND|OR|NOT|[A-Za-z0-9_.]+)\s*/gi;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(expr)) !== null) {
    const t = match[1];
    if (t) {
      tokens.push(t.toUpperCase());
    }
  }
  return tokens;
}

/**
 * Evaluates a SELogic boolean expression against given word bits / state.
 */
export function evaluateSELogicExpression(expr: string, state: Record<string, boolean>): boolean {
  const tokens = tokenizeSELogic(expr);
  if (tokens.length === 0) return false;

  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string {
    return tokens[pos++] ?? "";
  }

  // Grammar:
  // Expr   := OrExpr
  // OrExpr := AndExpr ( "OR" AndExpr )*
  // AndExpr:= NotExpr ( "AND" NotExpr )*
  // NotExpr:= ( "NOT" | "!" )* Primary
  // Primary:= "(" Expr ")" | Identifier | "1" | "0" | "TRUE" | "FALSE"

  function parseExpr(): boolean {
    return parseOr();
  }

  function parseOr(): boolean {
    let res = parseAnd();
    while (peek() === "OR") {
      consume();
      const rhs = parseAnd();
      res = res || rhs;
    }
    return res;
  }

  function parseAnd(): boolean {
    let res = parseNot();
    while (peek() === "AND") {
      consume();
      const rhs = parseNot();
      res = res && rhs;
    }
    return res;
  }

  function parseNot(): boolean {
    let notCount = 0;
    while (peek() === "NOT" || peek() === "!") {
      consume();
      notCount++;
    }
    const val = parsePrimary();
    return notCount % 2 === 1 ? !val : val;
  }

  function parsePrimary(): boolean {
    const t = peek();
    if (!t) return false;

    if (t === "(") {
      consume();
      const inner = parseExpr();
      if (peek() === ")") {
        consume();
      }
      return inner;
    }

    consume();
    if (t === "1" || t === "TRUE") return true;
    if (t === "0" || t === "FALSE") return false;

    // Check state lookup (case-insensitive)
    const val = state[t] ?? state[t.toLowerCase()] ?? state[t.toUpperCase()];
    return val === true;
  }

  return parseExpr();
}

/**
 * Result of evaluating SELogic equations for an active settings group.
 */
export interface SELogicEvaluationResult {
  tripped: boolean;
  closed: boolean;
  equationsState: Record<string, boolean>;
  overcurrentTripTimeSeconds: number;
  distanceZonePickups: {
    zone1: boolean;
    zone2: boolean;
    zone3: boolean;
  };
  converged: boolean;
  iterations: number;
}

/**
 * Evaluates relay protection elements and SELogic equations with given analog & digital inputs.
 */
export function evaluateRelayProtection(
  settings: SELRelaySettings,
  inputs: {
    phaseCurrentA?: number | undefined;
    groundCurrentA?: number | undefined;
    faultImpedanceOhms?: number | undefined;
    phaseVoltageV?: number | undefined;
    frequencyHz?: number | undefined;
    digitalInputs?: Record<string, boolean> | undefined;
  },
): SELogicEvaluationResult {
  const group: SettingsGroup = settings.groups.get(settings.activeGroup) ??
    settings.groups.values().next().value ?? { groupId: 1, equations: {} };

  const state: Record<string, boolean> = {
    ...(inputs.digitalInputs ?? {}),
  };

  // 1. Evaluate Phase Overcurrent
  let overcurrentTripTimeSeconds = Infinity;
  const ip = inputs.phaseCurrentA ?? 0;
  if (group.phaseOvercurrent) {
    const po = group.phaseOvercurrent;
    if (po.inst50P1P !== undefined && ip >= po.inst50P1P) {
      state["50P1"] = true;
      state["50P1P"] = true;
    } else {
      state["50P1"] = false;
      state["50P1P"] = false;
    }

    if (po.inst50P2P !== undefined && ip >= po.inst50P2P) {
      state["50P2"] = true;
      state["50P2P"] = true;
    }

    if (po.time51P1P !== undefined && ip >= po.time51P1P) {
      state["51P1"] = true;
      state["51P1P"] = true;
      overcurrentTripTimeSeconds = calculateOvercurrentTime(
        ip,
        po.time51P1P,
        po.timeDial51P1TD ?? 1.0,
        po.curve51P1C ?? "U3",
      );
    } else {
      state["51P1"] = false;
      state["51P1P"] = false;
    }
  }

  // 2. Evaluate Ground Overcurrent
  const ig = inputs.groundCurrentA ?? 0;
  if (group.groundOvercurrent) {
    const go = group.groundOvercurrent;
    if (go.inst50G1P !== undefined && ig >= go.inst50G1P) {
      state["50G1"] = true;
      state["50G1P"] = true;
    } else {
      state["50G1"] = false;
      state["50G1P"] = false;
    }
    if (go.time51G1P !== undefined && ig >= go.time51G1P) {
      state["51G1"] = true;
      state["51G1P"] = true;
    }
  }

  // 3. Evaluate Distance Elements
  const distanceZonePickups = {
    zone1: false,
    zone2: false,
    zone3: false,
  };
  const zf = inputs.faultImpedanceOhms;
  if (zf !== undefined && group.distance) {
    const d = group.distance;
    if (d.zone1Reach !== undefined && zf <= d.zone1Reach) {
      distanceZonePickups.zone1 = true;
      state["Z1P"] = true;
      state["M1P"] = true;
    }
    if (d.zone2Reach !== undefined && zf <= d.zone2Reach) {
      distanceZonePickups.zone2 = true;
      state["Z2P"] = true;
      state["M2P"] = true;
    }
    if (d.zone3Reach !== undefined && zf <= d.zone3Reach) {
      distanceZonePickups.zone3 = true;
      state["Z3P"] = true;
      state["M3P"] = true;
    }
  }

  // 4. Evaluate Voltage & Frequency
  const vp = inputs.phaseVoltageV;
  if (vp !== undefined && group.voltage) {
    if (group.voltage.underVoltage27P !== undefined && vp <= group.voltage.underVoltage27P) {
      state["27P"] = true;
    }
    if (group.voltage.overVoltage59P !== undefined && vp >= group.voltage.overVoltage59P) {
      state["59P"] = true;
    }
  }

  const f = inputs.frequencyHz;
  if (f !== undefined && group.frequency) {
    if (group.frequency.underFreq81U !== undefined && f <= group.frequency.underFreq81U) {
      state["81U"] = true;
    }
    if (group.frequency.overFreq81O !== undefined && f >= group.frequency.overFreq81O) {
      state["81O"] = true;
    }
  }

  // 5. Evaluate SELogic Equation Network iteratively to resolve intermediate dependencies (SV, LT, TRIP, CLOSE)
  const maxIterations = 20;
  let iterations = 0;
  let converged = false;

  const allEqs: Record<string, string> = {
    ...settings.globalEquations,
    ...group.equations,
  };

  while (iterations < maxIterations) {
    iterations++;
    let changed = false;

    for (const [target, expr] of Object.entries(allEqs)) {
      const oldVal = state[target] ?? false;
      const newVal = evaluateSELogicExpression(expr, state);
      if (oldVal !== newVal) {
        state[target] = newVal;
        changed = true;
      }
    }

    if (!changed) {
      converged = true;
      break;
    }
  }

  const tripped = state["TRIP"] === true || state["OUT101"] === true;
  const closed = state["CLOSE"] === true || state["OUT102"] === true;

  return {
    tripped,
    closed,
    equationsState: state,
    overcurrentTripTimeSeconds,
    distanceZonePickups,
    converged,
    iterations,
  };
}
