// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Successive-Substitution Transient Solver for TRNSYS (.dck) Component Networks.
 *
 * Executes coupled Type 1 (Solar Collector), Type 2 (Differential Controller),
 * Type 3 (Pump), Type 4 (Stratified Storage Tank), Type 14 (Forcing Function),
 * Type 15 (Weather Data), Type 25 (Printer), and Type 56 (Multi-Zone Building)
 * units over `[tStart, tStop]` with timestep `dt`.
 */

import { evaluateTrnsysExpression } from "../parser/deck-parser.js";
import type { TrnsysDeck, TrnsysUnit, TrnsysValue } from "../types.js";

export interface TrnsysStepSnapshot {
  time: number;
  iterations: number;
  converged: boolean;
  outputs: Record<number, number[]>;
}

export interface TrnsysSimulationResult {
  times: number[];
  steps: TrnsysStepSnapshot[];
  /** Unit number -> 1-indexed output number -> time series array */
  series: Record<number, Record<number, number[]>>;
  convergedAllSteps: boolean;
  totalIterations: number;
}

interface UnitRuntimeState {
  unit: TrnsysUnit;
  params: number[];
  outputs: number[];
  /** Dynamic state committed at start of current timestep */
  committedState: number[];
  /** Candidate dynamic state at end of current timestep */
  nextState: number[];
}

function resolveParamList(unit: TrnsysUnit, env: ReadonlyMap<string, number>): number[] {
  return unit.parameters.map((p: TrnsysValue) => {
    if (p.kind === "number") return p.value;
    return env.get(p.name.toUpperCase()) ?? 0.0;
  });
}

function resolveInitVal(unit: TrnsysUnit, idx: number, env: ReadonlyMap<string, number>): number {
  const v = unit.initialInputs[idx];
  if (!v) return 0.0;
  if (v.kind === "number") return v.value;
  return env.get(v.name.toUpperCase()) ?? 0.0;
}

function getPar(params: number[], idx: number, fallback: number): number {
  const v = params[idx];
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

function initUnitState(unit: TrnsysUnit, params: number[], env: ReadonlyMap<string, number>): UnitRuntimeState {
  switch (unit.typeNumber) {
    case 1: {
      const t0 = resolveInitVal(unit, 0, env);
      const m0 = resolveInitVal(unit, 1, env);
      return { unit, params, outputs: [t0, m0, 0.0], committedState: [], nextState: [] };
    }
    case 2: {
      const g0 = resolveInitVal(unit, 3, env);
      return { unit, params, outputs: [g0], committedState: [g0], nextState: [g0] };
    }
    case 3: {
      const t0 = resolveInitVal(unit, 0, env);
      const mMax = getPar(params, 0, 200.0);
      return { unit, params, outputs: [t0, mMax, 0.0], committedState: [], nextState: [] };
    }
    case 4: {
      const nNodes = Math.max(1, Math.min(6, Math.round(getPar(params, 5, 3))));
      const state: number[] = [];
      for (let i = 0; i < nNodes; i++) {
        const d = unit.derivatives[i];
        const t0 =
          d && d.kind === "number"
            ? d.value
            : d && d.kind === "variable"
              ? (env.get(d.name.toUpperCase()) ?? 20.0)
              : getPar(params, 6, resolveInitVal(unit, 4, env) || 20.0);
        state.push(t0);
      }
      const tAvg = state.reduce((a, b) => a + b, 0) / nNodes;
      return {
        unit,
        params,
        outputs: [state[nNodes - 1]!, 0.0, state[0]!, 0.0, 0.0, tAvg],
        committedState: [...state],
        nextState: [...state],
      };
    }
    case 14: {
      const v0 = getPar(params, 1, 0.0);
      return { unit, params, outputs: [v0, v0], committedState: [], nextState: [] };
    }
    case 15: {
      const tMean = getPar(params, 0, 20.0);
      return { unit, params, outputs: [tMean, 0.0, 50.0, 2.0], committedState: [], nextState: [] };
    }
    case 56: {
      const d0 = unit.derivatives[0];
      const tInit = d0 && d0.kind === "number" ? d0.value : getPar(params, 3, 20.0);
      return {
        unit,
        params,
        outputs: [tInit, 0.0, 0.0],
        committedState: [tInit],
        nextState: [tInit],
      };
    }
    default:
      return { unit, params, outputs: [], committedState: [], nextState: [] };
  }
}

function gatherInputs(
  unit: TrnsysUnit,
  runtimeByUnit: Map<number, UnitRuntimeState>,
  env: ReadonlyMap<string, number>,
): number[] {
  const inputs: number[] = [];
  for (let k = 0; k < unit.inputs.length; k++) {
    const inp = unit.inputs[k]!;
    if (inp.kind === "connection") {
      const src = runtimeByUnit.get(inp.unitNumber);
      const val = src?.outputs[inp.outputIndex - 1];
      inputs.push(val !== undefined && Number.isFinite(val) ? val : resolveInitVal(unit, k, env));
    } else if (inp.kind === "constant") {
      inputs.push(inp.raw === "0,0" ? resolveInitVal(unit, k, env) : inp.value);
    } else {
      const ev = env.get(inp.name.toUpperCase());
      inputs.push(ev !== undefined ? ev : resolveInitVal(unit, k, env));
    }
  }
  return inputs;
}

/**
 * Evaluates a single TRNSYS unit over `[t, t + dt]` starting from `committedState`.
 */
function evaluateUnit(rt: UnitRuntimeState, inputs: number[], t: number, dt: number): void {
  const p = rt.params;
  switch (rt.unit.typeNumber) {
    case 1: {
      // Type 1: Hottel-Whillier-Bliss flat-plate solar collector
      const area = getPar(p, 0, 4.0);
      const cp = getPar(p, 1, 4.19);
      const frTauAlpha = getPar(p, 2, 0.75);
      const frUl = getPar(p, 3, 15.0);
      const frUl2 = getPar(p, 4, 0.0);

      const tIn = inputs[0] ?? 20.0;
      const mDot = inputs[1] ?? 0.0;
      const tAmb = inputs[2] ?? 20.0;
      const it = inputs[3] ?? 0.0;

      const dT = tIn - tAmb;
      let qu = area * (frTauAlpha * it - frUl * dT - frUl2 * dT * dT);
      if (mDot <= 1e-9 || qu < 0.0) {
        qu = 0.0;
      }
      const tOut = mDot > 1e-9 ? tIn + qu / (mDot * cp) : tIn;
      rt.outputs[0] = tOut;
      rt.outputs[1] = mDot;
      rt.outputs[2] = qu;
      break;
    }

    case 2: {
      // Type 2: Differential controller with deadband hysteresis
      const tHighLimit = getPar(p, 1, 95.0);
      const tHigh = inputs[0] ?? 20.0;
      const tLow = inputs[1] ?? 20.0;
      const tMon = inputs[2] ?? tLow;
      const gammaPrev = rt.committedState[0] ?? 0.0;
      const dTon = inputs[4] ?? 8.0;
      const dToff = inputs[5] ?? 2.0;

      let gammaOut = gammaPrev;
      if (tMon >= tHighLimit) {
        gammaOut = 0.0;
      } else if (gammaPrev > 0.5) {
        gammaOut = tHigh - tLow < dToff ? 0.0 : 1.0;
      } else {
        gammaOut = tHigh - tLow >= dTon ? 1.0 : 0.0;
      }
      rt.nextState[0] = gammaOut;
      rt.outputs[0] = gammaOut;
      break;
    }

    case 3: {
      // Type 3: Circulation pump
      const mDotMax = getPar(p, 0, 200.0);
      const cp = getPar(p, 1, 4.19);
      const pMax = getPar(p, 2, 180.0);
      const fPar = getPar(p, 3, 0.05);

      const tIn = inputs[0] ?? 20.0;
      const gamma = Math.max(0.0, Math.min(1.0, inputs[2] ?? 1.0));
      const mDotOut = gamma * mDotMax;
      const power = gamma * pMax;
      const tOut = mDotOut > 1e-9 ? tIn + (fPar * power) / (mDotOut * cp) : tIn;
      rt.outputs[0] = tOut;
      rt.outputs[1] = mDotOut;
      rt.outputs[2] = power;
      break;
    }

    case 4: {
      // Type 4: Multi-node stratified storage tank with exact exponential integration per node
      const volume = Math.max(1e-4, getPar(p, 0, 0.3));
      const cp = Math.max(1e-3, getPar(p, 1, 4.19));
      const rho = Math.max(1.0, getPar(p, 2, 1000.0));
      const uLoss = Math.max(0.0, getPar(p, 3, 1.5));
      const height = Math.max(0.1, getPar(p, 4, 1.5));
      const nNodes = Math.max(1, Math.min(6, Math.round(getPar(p, 5, 3))));

      const tHotIn = inputs[0] ?? 20.0;
      const mDotHot = Math.max(0.0, inputs[1] ?? 0.0);
      const tColdIn = inputs[2] ?? 20.0;
      const mDotLoad = Math.max(0.0, inputs[3] ?? 0.0);
      const tEnv = inputs[4] ?? 20.0;

      const radius = Math.sqrt(volume / (Math.PI * height));
      const sideAreaNode = (2.0 * Math.PI * radius * height) / nNodes;
      const capArea = Math.PI * radius * radius;
      const capNode = ((rho * volume) / nNodes) * cp;

      let totalLoss = 0.0;
      let sumTNext = 0.0;
      const tBarNodes: number[] = new Array<number>(nNodes);

      for (let i = 0; i < nNodes; i++) {
        const t0 = rt.committedState[i] ?? 20.0;
        let areaNode = sideAreaNode;
        if (i === 0) areaNode += capArea;
        if (i === nNodes - 1) areaNode += capArea;
        const uaNode = uLoss * areaNode;

        const tAbove = i === 0 ? tHotIn : (tBarNodes[i - 1] ?? rt.committedState[i - 1] ?? 20.0);
        const tBelow = i === nNodes - 1 ? tColdIn : (rt.committedState[i + 1] ?? 20.0);

        const a = (mDotHot * cp + mDotLoad * cp + uaNode) / capNode;
        const b = (mDotHot * cp * tAbove + mDotLoad * cp * tBelow + uaNode * tEnv) / capNode;

        let tNext = t0;
        let tBar = t0;
        if (dt > 0.0) {
          if (a > 1e-12) {
            const tEq = b / a;
            const decay = Math.exp(-a * dt);
            tNext = tEq + (t0 - tEq) * decay;
            // Exact time-average over [t, t+dt] preserves exact discrete energy balance
            tBar = tEq + ((t0 - tEq) * (1.0 - decay)) / (a * dt);
          } else {
            tNext = t0 + b * dt;
            tBar = t0 + 0.5 * b * dt;
          }
        }
        rt.nextState[i] = tNext;
        tBarNodes[i] = tBar;
        totalLoss += uaNode * (tBar - tEnv);
        sumTNext += tNext;
      }

      // out1: bottom outlet (step-average for exact loop energy conservation), out2: mDotHot,
      // out3: top outlet (step-average), out4: mDotLoad, out5: Qloss (kJ/h), out6: end-of-step Tavg
      rt.outputs[0] = tBarNodes[nNodes - 1]!;
      rt.outputs[1] = mDotHot;
      rt.outputs[2] = tBarNodes[0]!;
      rt.outputs[3] = mDotLoad;
      rt.outputs[4] = totalLoss;
      rt.outputs[5] = sumTNext / nNodes;
      break;
    }

    case 14: {
      // Type 14: Periodic piecewise-linear forcing function
      const nPairs = Math.floor(p.length / 2);
      if (nPairs < 2) {
        rt.outputs[0] = 0.0;
        rt.outputs[1] = 0.0;
        break;
      }
      const period = p[(nPairs - 1) * 2] ?? 24.0;
      const evalAt = (timeVal: number): number => {
        const tMod = period > 0 ? timeVal - Math.floor(timeVal / period) * period : timeVal;
        for (let i = 0; i < nPairs - 1; i++) {
          const ta = p[i * 2]!;
          const va = p[i * 2 + 1]!;
          const tb = p[(i + 1) * 2]!;
          const vb = p[(i + 1) * 2 + 1]!;
          if (tMod >= ta && tMod <= tb) {
            const span = tb - ta;
            return span > 1e-12 ? va + ((tMod - ta) / span) * (vb - va) : vb;
          }
        }
        return p[1] ?? 0.0;
      };
      const vMid = evalAt(t + 0.5 * dt);
      const vEnd = evalAt(t + dt);
      rt.outputs[0] = vMid;
      rt.outputs[1] = vEnd;
      break;
    }

    case 15: {
      // Type 15: Synthetic diurnal weather processor
      const tMean = getPar(p, 0, 20.0);
      const tAmp = getPar(p, 1, 5.0);
      const iPeak = getPar(p, 2, 2880.0);
      const sunrise = getPar(p, 3, 6.0);
      const sunset = getPar(p, 4, 18.0);

      const tMid = t + 0.5 * dt;
      const hr = tMid - Math.floor(tMid / 24.0) * 24.0;
      const tAmb = tMean - tAmp * Math.cos((2.0 * Math.PI * (hr - 3.0)) / 24.0);
      let it = 0.0;
      if (hr > sunrise && hr < sunset && sunset > sunrise) {
        it = iPeak * Math.sin((Math.PI * (hr - sunrise)) / (sunset - sunrise));
      }
      rt.outputs[0] = tAmb;
      rt.outputs[1] = it;
      rt.outputs[2] = 50.0;
      rt.outputs[3] = 2.0;
      break;
    }

    case 25: {
      // Type 25: Printer (records inputs, no outputs)
      break;
    }

    case 56: {
      // Type 56: Multi-zone building thermal capacitance ODE
      const cap = Math.max(1.0, getPar(p, 0, 5000.0));
      const ua = Math.max(0.0, getPar(p, 1, 250.0));
      const solarAp = Math.max(0.0, getPar(p, 2, 6.0));

      const tAmb = inputs[0] ?? 20.0;
      const it = inputs[1] ?? 0.0;
      const qInt = inputs[2] ?? 0.0;
      const qHvac = inputs[3] ?? 0.0;

      const t0 = rt.committedState[0] ?? 20.0;
      const qGain = solarAp * it + qInt + qHvac;
      const a = ua / cap;
      const b = (ua * tAmb + qGain) / cap;

      let tNext = t0;
      let tBar = t0;
      if (dt > 0.0) {
        if (a > 1e-12) {
          const tEq = b / a;
          const decay = Math.exp(-a * dt);
          tNext = tEq + (t0 - tEq) * decay;
          tBar = tEq + ((t0 - tEq) * (1.0 - decay)) / (a * dt);
        } else {
          tNext = t0 + b * dt;
          tBar = t0 + 0.5 * b * dt;
        }
      }
      rt.nextState[0] = tNext;
      rt.outputs[0] = tNext;
      rt.outputs[1] = qHvac;
      rt.outputs[2] = ua * (tBar - tAmb);
      break;
    }

    default:
      break;
  }
}

/**
 * Runs a transient successive-substitution simulation of a parsed `TrnsysDeck`.
 */
export function solveTrnsysTransient(deck: TrnsysDeck): TrnsysSimulationResult {
  const sim = deck.simulation ?? { tStart: 0, tStop: 24, dt: 1, line: 1 };
  const tol = deck.tolerances?.convergence ?? 1e-4;
  const maxIter = deck.limits?.maxIterations ?? 30;

  const baseEnv = new Map<string, number>([
    ["START", sim.tStart],
    ["STOP", sim.tStop],
    ["STEP", sim.dt],
    ["TIME", sim.tStart],
  ]);
  for (const c of deck.constants) {
    if (c.value !== undefined) baseEnv.set(c.name.toUpperCase(), c.value);
  }
  for (const block of deck.equationBlocks) {
    for (const eq of block.equations) {
      if (eq.value !== undefined) baseEnv.set(eq.name.toUpperCase(), eq.value);
    }
  }

  const runtimeList: UnitRuntimeState[] = [];
  const runtimeByUnit = new Map<number, UnitRuntimeState>();
  const series: Record<number, Record<number, number[]>> = {};

  for (const unit of deck.units) {
    const params = resolveParamList(unit, baseEnv);
    const rt = initUnitState(unit, params, baseEnv);
    runtimeList.push(rt);
    runtimeByUnit.set(unit.unitNumber, rt);
    series[unit.unitNumber] = {};
    for (let o = 1; o <= rt.outputs.length; o++) {
      series[unit.unitNumber]![o] = [];
    }
  }

  const times: number[] = [];
  const steps: TrnsysStepSnapshot[] = [];
  let convergedAllSteps = true;
  let totalIterations = 0;

  const nSteps = Math.max(0, Math.round((sim.tStop - sim.tStart) / sim.dt));

  for (let s = 0; s < nSteps; s++) {
    const t = sim.tStart + s * sim.dt;
    const tEnd = t + sim.dt;

    // Evaluate time-dependent EQUATIONS
    const stepEnv = new Map(baseEnv);
    stepEnv.set("TIME", tEnd);
    for (const block of deck.equationBlocks) {
      for (const eq of block.equations) {
        const val = evaluateTrnsysExpression(eq.expression, stepEnv);
        if (val !== undefined) stepEnv.set(eq.name.toUpperCase(), val);
      }
    }

    let converged = false;
    let iter = 0;

    while (iter < maxIter) {
      iter++;
      let maxDiff = 0.0;

      for (const rt of runtimeList) {
        const prevOutputs = [...rt.outputs];
        const inputs = gatherInputs(rt.unit, runtimeByUnit, stepEnv);
        evaluateUnit(rt, inputs, t, sim.dt);

        for (let o = 0; o < rt.outputs.length; o++) {
          const prev = prevOutputs[o] ?? 0.0;
          const curr = rt.outputs[o] ?? 0.0;
          const scale = Math.max(1.0, Math.abs(curr));
          const diff = Math.abs(curr - prev) / scale;
          if (diff > maxDiff) maxDiff = diff;
        }
      }

      if (maxDiff <= tol) {
        converged = true;
        break;
      }
    }

    if (!converged) convergedAllSteps = false;
    totalIterations += iter;

    // Commit dynamic states at end of timestep
    const stepOutputs: Record<number, number[]> = {};
    for (const rt of runtimeList) {
      for (let i = 0; i < rt.nextState.length; i++) {
        rt.committedState[i] = rt.nextState[i]!;
      }
      stepOutputs[rt.unit.unitNumber] = [...rt.outputs];
      const uSeries = series[rt.unit.unitNumber]!;
      for (let o = 0; o < rt.outputs.length; o++) {
        if (!uSeries[o + 1]) uSeries[o + 1] = [];
        uSeries[o + 1]!.push(rt.outputs[o]!);
      }
    }

    times.push(tEnd);
    steps.push({ time: tEnd, iterations: iter, converged, outputs: stepOutputs });
  }

  return { times, steps, series, convergedAllSteps, totalIterations };
}
