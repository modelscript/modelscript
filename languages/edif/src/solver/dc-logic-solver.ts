// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DC Modified Nodal Analysis (MNA) solver and digital combinational/sequential logic evaluator
 * for flattened EDIF 2.0.0 netlists.
 */

import type { EdifDocument, FlattenedEdifInstance, FlattenedEdifNetlist } from "../types.js";
import { flattenEdifNetlist } from "./flattener.js";

export interface EdifDcSolveOptions {
  /** Fixed voltage overrides by net name (e.g. `{ VIN: 10.0, GND: 0.0 }`). */
  voltageSources?: Record<string, number>;
  /** Default supply voltage for `VCC`/`VDD` cells if no `V`/`VALUE` property is set (default: 5.0 V). */
  defaultVcc?: number;
  /** Small conductance to ground (Gmin) for floating-node numerical stability (default: 1e-12 S). */
  gmin?: number;
}

export interface EdifDcSolveResult {
  converged: boolean;
  groundNet: string;
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  totalPowerW: number;
}

export type LogicBit = 0 | 1 | "X";

export interface EdifLogicEvalOptions {
  /** Maximum relaxation iterations for combinational propagation (default: 64). */
  maxIterations?: number;
  /** Previous DFF state map by instance name (for sequential evaluation). */
  dffState?: Record<string, 0 | 1>;
  /** Previous clock level map by DFF instance name (for rising-edge detection). */
  prevClk?: Record<string, 0 | 1>;
}

export interface EdifLogicEvalResult {
  settled: boolean;
  iterations: number;
  netValues: Record<string, LogicBit>;
  outputValues: Record<string, LogicBit>;
  dffState: Record<string, 0 | 1>;
}

function getNumericProp(inst: FlattenedEdifInstance, keys: string[], fallback: number): number {
  for (const k of keys) {
    const val = inst.properties[k.toUpperCase()];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return fallback;
}

function getTwoTerminalNets(inst: FlattenedEdifInstance): [string | undefined, string | undefined] {
  const entries = Object.entries(inst.portToNet);
  const byName = (candidates: string[]): string | undefined => {
    for (const c of candidates) {
      const hit = entries.find(([k]) => k.toUpperCase() === c);
      if (hit) return hit[1];
    }
    return undefined;
  };
  const p = byName(["P", "POS", "A", "IN", "1", "PIN1"]);
  const n = byName(["N", "NEG", "B", "OUT", "2", "PIN2"]);
  if (p && n) return [p, n];
  return [entries[0]?.[1], entries[1]?.[1]];
}

function getPinNet(inst: FlattenedEdifInstance, candidates: string[], fallbackIdx: number): string | undefined {
  const entries = Object.entries(inst.portToNet);
  for (const c of candidates) {
    const hit = entries.find(([k]) => k.toUpperCase() === c);
    if (hit) return hit[1];
  }
  return entries[fallbackIdx]?.[1];
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }
    if (maxAbs < 1e-18) return null;
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }

    const pivot = M[col]![col]!;
    for (let j = col; j <= n; j++) {
      M[col]![j] = M[col]![j]! / pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) {
        M[r]![j] = M[r]![j]! - factor * M[col]![j]!;
      }
    }
  }

  return M.map((row) => row[n]!);
}

/**
 * Solves DC operating point (node voltages and branch currents) of a passive/analog EDIF netlist
 * via Modified Nodal Analysis (MNA).
 *
 * At DC:
 * - Resistors (`RES`): conductance `G = 1 / R`
 * - Capacitors (`CAP`): open circuit (`G = 0`)
 * - Inductors (`IND`): ideal short circuit (small series resistance `1e-6 Ohm`)
 * - `GND` cells and `GND`/`VSS`/`0` nets: reference node `0 V`
 * - `VCC`/`VDD` cells and `voltageSources` overrides: ideal voltage source constraints
 */
export function solveEdifDc(
  netlistOrDoc: FlattenedEdifNetlist | EdifDocument | string,
  options: EdifDcSolveOptions = {},
): EdifDcSolveResult {
  const flat: FlattenedEdifNetlist =
    typeof netlistOrDoc === "string" || "libraries" in netlistOrDoc ? flattenEdifNetlist(netlistOrDoc) : netlistOrDoc;

  const defaultVcc = options.defaultVcc ?? 5.0;
  const gmin = options.gmin ?? 1e-12;
  const voltageOverrides = options.voltageSources ?? {};

  // Identify ground net
  let groundNet = "GND";
  const netNameSet = new Set(flat.nets.map((n) => n.name));
  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    if (cn === "GND" || cn === "GROUND" || cn === "VSS") {
      const pNet = getPinNet(inst, ["P", "GND", "1"], 0);
      if (pNet) {
        groundNet = pNet;
        break;
      }
    }
  }
  if (!netNameSet.has(groundNet)) {
    const candidate = flat.nets.find((n) => {
      const u = n.name.toUpperCase();
      return u === "GND" || u === "VSS" || u === "0";
    });
    if (candidate) groundNet = candidate.name;
  }

  // Collect non-ground node indices
  const nonGroundNets = flat.nets.map((n) => n.name).filter((n) => n !== groundNet);
  const nodeIndex = new Map<string, number>();
  nonGroundNets.forEach((n, i) => nodeIndex.set(n, i));
  const N = nonGroundNets.length;

  // Collect voltage source constraints: (netP, netN, voltage, label)
  interface VSourceStamp {
    netP: string;
    netN: string;
    voltage: number;
    label: string;
  }
  const vsources: VSourceStamp[] = [];
  const stampedSingleNode = new Set<string>();

  // Explicit voltageSources option
  for (const [netName, vVal] of Object.entries(voltageOverrides)) {
    const matchNet = flat.nets.find((n) => n.name.toLowerCase() === netName.toLowerCase())?.name;
    if (!matchNet || matchNet === groundNet) continue;
    vsources.push({ netP: matchNet, netN: groundNet, voltage: vVal, label: `V_${matchNet}` });
    stampedSingleNode.add(matchNet);
  }

  // Supply & voltage source instances
  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    if (cn === "VCC" || cn === "VDD" || cn === "SUPPLY") {
      const pNet = getPinNet(inst, ["P", "VCC", "VDD", "1"], 0);
      if (pNet && pNet !== groundNet && !stampedSingleNode.has(pNet)) {
        const vVal = getNumericProp(inst, ["V", "VALUE", "VOLTAGE", "VDD", "VCC"], defaultVcc);
        vsources.push({ netP: pNet, netN: groundNet, voltage: vVal, label: inst.name });
        stampedSingleNode.add(pNet);
      }
    } else if (cn === "VDC" || cn === "VSOURCE") {
      const [pNet, nNet] = getTwoTerminalNets(inst);
      if (pNet && nNet) {
        const vVal = getNumericProp(inst, ["V", "VALUE", "DC", "VOLTAGE"], defaultVcc);
        vsources.push({ netP: pNet, netN: nNet, voltage: vVal, label: inst.name });
      }
    }
  }

  const M = vsources.length;
  const dim = N + M;

  if (dim === 0) {
    return {
      converged: true,
      groundNet,
      nodeVoltages: { [groundNet]: 0 },
      branchCurrents: {},
      totalPowerW: 0,
    };
  }

  const A: number[][] = Array.from({ length: dim }, () => Array<number>(dim).fill(0));
  const b: number[] = Array<number>(dim).fill(0);

  // Stamp gmin for numerical stability
  for (let i = 0; i < N; i++) {
    A[i]![i] = A[i]![i]! + gmin;
  }

  // Stamp passives
  const passiveBranches: Array<{ name: string; netP: string; netN: string; g: number }> = [];
  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    if (cn === "RES" || cn === "RESISTOR" || cn === "R") {
      const [pNet, nNet] = getTwoTerminalNets(inst);
      if (!pNet || !nNet) continue;
      const r = Math.max(1e-12, getNumericProp(inst, ["R", "VALUE", "RESISTANCE"], 1000.0));
      const g = 1.0 / r;
      const ip = nodeIndex.get(pNet);
      const ineg = nodeIndex.get(nNet);
      if (ip !== undefined) A[ip]![ip] = A[ip]![ip]! + g;
      if (ineg !== undefined) A[ineg]![ineg] = A[ineg]![ineg]! + g;
      if (ip !== undefined && ineg !== undefined) {
        A[ip]![ineg] = A[ip]![ineg]! - g;
        A[ineg]![ip] = A[ineg]![ip]! - g;
      }
      passiveBranches.push({ name: inst.name, netP: pNet, netN: nNet, g });
    } else if (cn === "IND" || cn === "INDUCTOR" || cn === "L") {
      const [pNet, nNet] = getTwoTerminalNets(inst);
      if (!pNet || !nNet) continue;
      const g = 1.0 / 1e-6; // DC short with 1 uOhm series resistance
      const ip = nodeIndex.get(pNet);
      const ineg = nodeIndex.get(nNet);
      if (ip !== undefined) A[ip]![ip] = A[ip]![ip]! + g;
      if (ineg !== undefined) A[ineg]![ineg] = A[ineg]![ineg]! + g;
      if (ip !== undefined && ineg !== undefined) {
        A[ip]![ineg] = A[ip]![ineg]! - g;
        A[ineg]![ip] = A[ineg]![ip]! - g;
      }
      passiveBranches.push({ name: inst.name, netP: pNet, netN: nNet, g });
    }
    // CAP is open-circuit at DC (g = 0)
  }

  // Stamp MNA voltage sources
  for (let k = 0; k < M; k++) {
    const vs = vsources[k]!;
    const row = N + k;
    const ip = nodeIndex.get(vs.netP);
    const ineg = nodeIndex.get(vs.netN);
    if (ip !== undefined) {
      A[ip]![row] = A[ip]![row]! + 1;
      A[row]![ip] = A[row]![ip]! + 1;
    }
    if (ineg !== undefined) {
      A[ineg]![row] = A[ineg]![row]! - 1;
      A[row]![ineg] = A[row]![ineg]! - 1;
    }
    b[row] = vs.voltage;
  }

  const sol = solveLinearSystem(A, b);
  if (!sol) {
    return {
      converged: false,
      groundNet,
      nodeVoltages: { [groundNet]: 0 },
      branchCurrents: {},
      totalPowerW: 0,
    };
  }

  const nodeVoltages: Record<string, number> = { [groundNet]: 0 };
  for (let i = 0; i < N; i++) {
    nodeVoltages[nonGroundNets[i]!] = sol[i]!;
  }

  const branchCurrents: Record<string, number> = {};
  let totalPowerW = 0;
  for (const br of passiveBranches) {
    const vp = nodeVoltages[br.netP] ?? 0;
    const vn = nodeVoltages[br.netN] ?? 0;
    const curr = (vp - vn) * br.g;
    branchCurrents[br.name] = curr;
    totalPowerW += (vp - vn) * curr;
  }
  for (let k = 0; k < M; k++) {
    branchCurrents[vsources[k]!.label] = sol[N + k]!;
  }

  return {
    converged: true,
    groundNet,
    nodeVoltages,
    branchCurrents,
    totalPowerW,
  };
}

function evalGate(cellName: string, a: LogicBit, b: LogicBit): LogicBit {
  const cn = cellName.toUpperCase();
  switch (cn) {
    case "INV":
    case "NOT":
      if (a === "X") return "X";
      return a === 1 ? 0 : 1;
    case "AND2":
    case "AND":
      if (a === 0 || b === 0) return 0;
      if (a === 1 && b === 1) return 1;
      return "X";
    case "NAND2":
    case "NAND":
      if (a === 0 || b === 0) return 1;
      if (a === 1 && b === 1) return 0;
      return "X";
    case "OR2":
    case "OR":
      if (a === 1 || b === 1) return 1;
      if (a === 0 && b === 0) return 0;
      return "X";
    case "NOR2":
    case "NOR":
      if (a === 1 || b === 1) return 0;
      if (a === 0 && b === 0) return 1;
      return "X";
    case "XOR2":
    case "XOR":
      if (a === "X" || b === "X") return "X";
      return a !== b ? 1 : 0;
    default:
      return "X";
  }
}

/**
 * Evaluates combinational and sequential digital logic on a flattened EDIF 2.0.0 netlist.
 */
export function evaluateEdifLogic(
  netlistOrDoc: FlattenedEdifNetlist | EdifDocument | string,
  inputValues: Record<string, 0 | 1>,
  options: EdifLogicEvalOptions = {},
): EdifLogicEvalResult {
  const flat: FlattenedEdifNetlist =
    typeof netlistOrDoc === "string" || "libraries" in netlistOrDoc ? flattenEdifNetlist(netlistOrDoc) : netlistOrDoc;

  const maxIterations = options.maxIterations ?? 64;
  const netValues: Record<string, LogicBit> = {};
  const dffState: Record<string, 0 | 1> = { ...(options.dffState ?? {}) };
  const prevClk: Record<string, 0 | 1> = { ...(options.prevClk ?? {}) };

  for (const net of flat.nets) {
    netValues[net.name] = "X";
  }

  // Apply supply cells
  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    if (cn === "GND" || cn === "VSS") {
      const pNet = getPinNet(inst, ["P", "GND", "1"], 0);
      if (pNet) netValues[pNet] = 0;
    } else if (cn === "VCC" || cn === "VDD") {
      const pNet = getPinNet(inst, ["P", "VCC", "VDD", "1"], 0);
      if (pNet) netValues[pNet] = 1;
    }
  }

  // Apply primary inputs (case-insensitive match to net name or top port name)
  for (const [k, bit] of Object.entries(inputValues)) {
    const net = flat.nets.find(
      (n) => n.name.toLowerCase() === k.toLowerCase() || n.topPortName?.toLowerCase() === k.toLowerCase(),
    );
    if (net) {
      netValues[net.name] = bit;
    } else {
      netValues[k] = bit;
    }
  }

  // Evaluate DFFs once per clock step before combinational relaxation
  for (const inst of flat.instances) {
    const cn = inst.cellName.toUpperCase();
    if (cn === "DFF" || cn === "D_FF") {
      const dNet = getPinNet(inst, ["D", "IN"], 0);
      const clkNet = getPinNet(inst, ["CLK", "C", "CK"], 1);
      const qNet = getPinNet(inst, ["Q", "OUT", "Y"], 2);
      const clkVal = clkNet ? netValues[clkNet] : "X";
      const dVal = dNet ? netValues[dNet] : "X";
      const prev = prevClk[inst.name] ?? 0;
      let q: 0 | 1 = dffState[inst.name] ?? (getNumericProp(inst, ["Q0"], 0) >= 0.5 ? 1 : 0);
      if (prev === 0 && clkVal === 1 && (dVal === 0 || dVal === 1)) {
        q = dVal;
      }
      dffState[inst.name] = q;
      if (qNet) netValues[qNet] = q;
    }
  }

  let settled = false;
  let iterations = 0;

  for (let iter = 1; iter <= maxIterations; iter++) {
    iterations = iter;
    let changed = false;

    for (const inst of flat.instances) {
      const cn = inst.cellName.toUpperCase();
      if (cn === "INV" || cn === "NOT") {
        const aNet = getPinNet(inst, ["A", "I", "IN", "I0"], 0);
        const yNet = getPinNet(inst, ["Y", "O", "OUT", "Z", "Q"], 1);
        if (!aNet || !yNet) continue;
        const nextVal = evalGate(cn, netValues[aNet] ?? "X", "X");
        if (netValues[yNet] !== nextVal) {
          netValues[yNet] = nextVal;
          changed = true;
        }
      } else if (
        cn === "AND2" ||
        cn === "AND" ||
        cn === "OR2" ||
        cn === "OR" ||
        cn === "NAND2" ||
        cn === "NAND" ||
        cn === "NOR2" ||
        cn === "NOR" ||
        cn === "XOR2" ||
        cn === "XOR"
      ) {
        const aNet = getPinNet(inst, ["A", "I0", "IN1", "A0"], 0);
        const bNet = getPinNet(inst, ["B", "I1", "IN2", "B0"], 1);
        const yNet = getPinNet(inst, ["Y", "O", "OUT", "Z", "Q"], 2);
        if (!aNet || !bNet || !yNet) continue;
        const nextVal = evalGate(cn, netValues[aNet] ?? "X", netValues[bNet] ?? "X");
        if (netValues[yNet] !== nextVal) {
          netValues[yNet] = nextVal;
          changed = true;
        }
      }
    }

    if (!changed) {
      settled = true;
      break;
    }
  }

  const outputValues: Record<string, LogicBit> = {};
  for (const net of flat.nets) {
    if (net.isTopPort && net.topPortName && net.topPortDirection?.toUpperCase() === "OUTPUT") {
      outputValues[net.topPortName] = netValues[net.name] ?? "X";
    }
  }

  return {
    settled,
    iterations,
    netValues,
    outputValues,
    dffState,
  };
}
