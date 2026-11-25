// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDefaultWasmExports } from "@modelscript/runtime";
import type { EmtNetlist } from "../types.js";
import type { CsmfControlEvaluator } from "./csmf-evaluator.js";
import type {
  BergeronLineState,
  BusInfo,
  CompanionBranch,
  ConverterBridgeRuntimeState,
  EmtSolverOptions,
  EmtSolverResult,
  EmtWasmExports,
  FmuState,
  OltcState,
  SourceInfo,
  SurgeArresterState,
  SwitchState,
} from "./emt-solver-types.js";
import type { NConductorUlmData, UniversalLineModelData } from "./universal-line-model.js";

export interface EmtWasmKernelContext {
  readonly netlist: EmtNetlist;
  readonly options: EmtSolverOptions;
  readonly timeStepSec: number;
  readonly nSteps: number;
  readonly nBuses: number;
  readonly snapshotApplied: boolean;
  readonly time: Float64Array;
  readonly busList: readonly BusInfo[];
  readonly busIdxMap: ReadonlyMap<string, number>;
  readonly busSources: ReadonlyMap<number, readonly SourceInfo[]>;
  readonly companionBranches: readonly CompanionBranch[];
  readonly bergeronLines: readonly BergeronLineState[];
  readonly ulmLines: readonly UniversalLineModelData[];
  readonly nUlmLines: ReadonlyArray<{ model: NConductorUlmData }>;
  readonly oltcStates: readonly OltcState[];
  readonly bridgeRuntimeStates: readonly ConverterBridgeRuntimeState[];
  readonly switchStates: readonly SwitchState[];
  readonly fmuStates: readonly FmuState[];
  readonly surgeArresters: readonly SurgeArresterState[];
  readonly customBlockStates: ReadonlyArray<unknown>;
  readonly csmfEvaluator: CsmfControlEvaluator | null;
  readonly busVoltages: Map<string, Float64Array>;
  readonly busPhaseVoltages: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly branchCurrents: Map<string, Float64Array>;
  readonly branchPhaseCurrents: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly vA: Map<string, Float64Array>;
  readonly vB: Map<string, Float64Array>;
  readonly vC: Map<string, Float64Array>;
  readonly iA: Map<string, Float64Array>;
  readonly iB: Map<string, Float64Array>;
  readonly iC: Map<string, Float64Array>;
  readonly controlSignals: Map<string, Float64Array>;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
}

/**
 * Delegates simulation to the native WebAssembly EMT companion solver kernel in linear memory
 * when the circuit only uses features supported by the WASM fast-path.
 */
export function solveEmtWithWasm(ctx: EmtWasmKernelContext): EmtSolverResult | null {
  const wasm = getDefaultWasmExports() as Partial<EmtWasmExports> | null;
  if (
    !wasm ||
    typeof wasm.emt_create !== "function" ||
    typeof wasm.emt_add_branch !== "function" ||
    typeof wasm.emt_add_source !== "function" ||
    typeof wasm.emt_build_and_factorize !== "function" ||
    typeof wasm.emt_get_voltages_ptr !== "function" ||
    typeof wasm.emt_step !== "function" ||
    typeof wasm.emt_get_branch_current !== "function" ||
    !wasm.memory
  ) {
    return null;
  }

  // Fall back to TS if features requiring coupled TS physics are active
  if (
    ctx.companionBranches.some((br) => Math.abs(br.gMut) > 1e-12 || br.windingConnection !== undefined) ||
    (ctx.netlist.protectionRelays && ctx.netlist.protectionRelays.length > 0) ||
    (ctx.netlist.converterBridges && ctx.netlist.converterBridges.length > 0) ||
    ctx.surgeArresters.length > 0 ||
    ctx.customBlockStates.length > 0 ||
    ctx.csmfEvaluator !== null ||
    ctx.ulmLines.length > 0 ||
    ctx.nUlmLines.length > 0 ||
    ctx.oltcStates.length > 0 ||
    ctx.bridgeRuntimeStates.length > 0 ||
    ctx.bergeronLines.some((b) => b.hasModal) ||
    (ctx.options.useWasm !== true &&
      (ctx.bergeronLines.length > 0 || (ctx.netlist.faults?.length ?? 0) > 0 || ctx.nBuses >= 50)) ||
    ctx.fmuStates.length > 0 ||
    Boolean(ctx.options?.boundaryFeeds?.length) ||
    Boolean(ctx.options?.initializeFromLoadFlow) ||
    Boolean(ctx.options?.initialSnapshot) ||
    ctx.snapshotApplied ||
    (ctx.options.useWasm !== true && ctx.switchStates.length > 0)
  ) {
    return null;
  }

  try {
    const nNodes = ctx.nBuses * 3;
    const maxBranches = Math.max(32, (ctx.companionBranches.length + ctx.switchStates.length + 5) * 3);
    const maxSources = Math.max(16, (ctx.busSources.size + 5) * 3);
    const dt = ctx.timeStepSec;

    const solverPtr = wasm.emt_create(nNodes, maxBranches, maxSources, dt);
    if (!solverPtr) return null;

    const branchIndices: { id: string; idxA: number; idxB: number; idxC: number }[] = [];
    for (const br of ctx.companionBranches) {
      const fromA = br.fromIdx >= 0 ? br.fromIdx * 3 + 0 : -1;
      const fromB = br.fromIdx >= 0 ? br.fromIdx * 3 + 1 : -1;
      const fromC = br.fromIdx >= 0 ? br.fromIdx * 3 + 2 : -1;

      const toA = br.toIdx >= 0 ? br.toIdx * 3 + 0 : -1;
      const toB = br.toIdx >= 0 ? br.toIdx * 3 + 1 : -1;
      const toC = br.toIdx >= 0 ? br.toIdx * 3 + 2 : -1;

      const idxA = wasm.emt_add_branch(solverPtr, fromA, toA, br.rOhm, br.lHenry, br.cFarad);
      const idxB = wasm.emt_add_branch(solverPtr, fromB, toB, br.rOhm, br.lHenry, br.cFarad);
      const idxC = wasm.emt_add_branch(solverPtr, fromC, toC, br.rOhm, br.lHenry, br.cFarad);
      branchIndices.push({ id: br.id, idxA, idxB, idxC });
    }

    if (ctx.bergeronLines.length > 0) {
      for (const bl of ctx.bergeronLines) {
        const tauSec = (bl.delaySteps + bl.fracDelay) * dt;
        if (
          bl.isFdpm &&
          typeof wasm.emt_add_fd_line === "function" &&
          typeof wasm.emt_add_fd_line_y_pole === "function" &&
          typeof wasm.emt_add_fd_line_h_pole === "function"
        ) {
          const nY = bl.yPoles.length;
          const nH = bl.hPoles.length;
          for (let p = 0; p < 3; p++) {
            const fromNode = bl.fromIdx >= 0 ? bl.fromIdx * 3 + p : -1;
            const toNode = bl.toIdx >= 0 ? bl.toIdx * 3 + p : -1;
            const fdIdx = wasm.emt_add_fd_line(
              solverPtr,
              fromNode,
              toNode,
              bl.gInf,
              tauSec,
              Math.max(4, nY),
              Math.max(4, nH),
            );
            if (fdIdx < 0) return null;
            for (let m = 0; m < nY; m++) {
              wasm.emt_add_fd_line_y_pole(solverPtr, fdIdx, bl.yPoles[m]!, bl.yResidues[m]!);
            }
            for (let m = 0; m < nH; m++) {
              wasm.emt_add_fd_line_h_pole(solverPtr, fdIdx, bl.hPoles[m]!, bl.hResidues[m]!);
            }
          }
        } else {
          if (typeof wasm.emt_add_bergeron_line !== "function") return null;
          const rQuarter = Math.max(0, 1.0 / bl.gBerg - bl.zChar);
          const rTotal = 4.0 * rQuarter;
          for (let p = 0; p < 3; p++) {
            const fromNode = bl.fromIdx >= 0 ? bl.fromIdx * 3 + p : -1;
            const toNode = bl.toIdx >= 0 ? bl.toIdx * 3 + p : -1;
            wasm.emt_add_bergeron_line(solverPtr, fromNode, toNode, bl.zChar, tauSec, rTotal);
          }
        }
      }
    }

    if (ctx.switchStates.length > 0) {
      if (typeof wasm.emt_add_breaker !== "function") return null;
      for (const swState of ctx.switchStates) {
        const gClosed = 1.0 / Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4);
        const gOpen = 1.0 / Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
        const initClosed = Boolean(swState.sw.initialClosed);
        const openTime = initClosed ? swState.sw.actionTimeSec : 1e9;
        const closeTime = !initClosed ? swState.sw.actionTimeSec : 1e9;
        for (let p = 0; p < 3; p++) {
          const fromNode = swState.fromIdx >= 0 ? swState.fromIdx * 3 + p : -1;
          const toNode = swState.toIdx >= 0 ? swState.toIdx * 3 + p : -1;
          wasm.emt_add_breaker(solverPtr, fromNode, toNode, gClosed, gOpen, initClosed, openTime, closeTime, 0.0);
        }
      }
    }

    if (ctx.netlist.faults && ctx.netlist.faults.length > 0) {
      if (typeof wasm.emt_add_fault !== "function") return null;
      for (const flt of ctx.netlist.faults) {
        const bIdx = ctx.busIdxMap.get(flt.bus) ?? 0;
        const rFlt = flt.rFaultOhm !== undefined && flt.rFaultOhm > 0 ? flt.rFaultOhm : 0.5;
        const gFlt = 1.0 / rFlt;
        const pA = 3 * bIdx + 0;
        const pB = 3 * bIdx + 1;
        const pC = 3 * bIdx + 2;
        if (flt.faultType === "3PH") {
          wasm.emt_add_fault(solverPtr, pA, -1, flt.startSec, flt.endSec, gFlt);
          wasm.emt_add_fault(solverPtr, pB, -1, flt.startSec, flt.endSec, gFlt);
          wasm.emt_add_fault(solverPtr, pC, -1, flt.startSec, flt.endSec, gFlt);
        } else if (flt.faultType === "SLG") {
          wasm.emt_add_fault(solverPtr, pA, -1, flt.startSec, flt.endSec, gFlt);
        } else if (flt.faultType === "DLG") {
          wasm.emt_add_fault(solverPtr, pB, -1, flt.startSec, flt.endSec, gFlt);
          wasm.emt_add_fault(solverPtr, pC, -1, flt.startSec, flt.endSec, gFlt);
          wasm.emt_add_fault(solverPtr, pB, pC, flt.startSec, flt.endSec, 0.5 * gFlt);
        } else {
          wasm.emt_add_fault(solverPtr, pB, pC, flt.startSec, flt.endSec, gFlt);
        }
      }
    }

    for (const [bIdx, srcList] of ctx.busSources) {
      for (const src of srcList) {
        const vPeakKv = src.vPeak / 1e3;
        const freqHz = src.freqRad / (2 * Math.PI);
        const phase = src.phaseRad;
        wasm.emt_add_source(solverPtr, bIdx * 3 + 0, vPeakKv, freqHz, phase, src.gSrc, 1);
        wasm.emt_add_source(solverPtr, bIdx * 3 + 1, vPeakKv, freqHz, phase - (2 * Math.PI) / 3, src.gSrc, 1);
        wasm.emt_add_source(solverPtr, bIdx * 3 + 2, vPeakKv, freqHz, phase + (2 * Math.PI) / 3, src.gSrc, 1);
      }
    }

    const ok = wasm.emt_build_and_factorize(solverPtr);
    if (!ok) return null;
    let wasmLuCount = 1;
    const wasmSwitchingEvents = 0;

    const startTime = performance.now();
    const vVecPtr = wasm.emt_get_voltages_ptr(solverPtr);
    const vView = new Float64Array(wasm.memory.buffer, vVecPtr, ctx.nBuses * 3);

    for (const b of ctx.busList) {
      ctx.busVoltages.set(b.id, ctx.busPhaseVoltages.get(b.id)!.a);
    }

    const busPvs = ctx.busList.map((b) => ctx.busPhaseVoltages.get(b.id)!);
    const branchPbs = branchIndices.map((br) => ({
      pb: ctx.branchPhaseCurrents.get(br.id)!,
      idxA: br.idxA,
      idxB: br.idxB,
      idxC: br.idxC,
    }));

    // If no discrete branches require per-step current queries and no step callback is attached,
    // execute the entire stepping sequence in a single zero-overhead WebAssembly call via emt_run_steps.
    if (
      branchIndices.length === 0 &&
      ctx.bergeronLines.length === 0 &&
      ctx.switchStates.length === 0 &&
      !ctx.csmfEvaluator &&
      !ctx.options.onStep &&
      typeof wasm.emt_alloc_trajectory === "function" &&
      typeof wasm.emt_run_steps === "function" &&
      typeof wasm.emt_get_trajectory_ptr === "function"
    ) {
      const trajPtr = wasm.emt_alloc_trajectory(solverPtr, ctx.nSteps);
      if (trajPtr) {
        wasm.emt_run_steps(solverPtr, ctx.nSteps);
        const stride = 1 + ctx.nBuses * 3;
        const trajView = new Float64Array(wasm.memory.buffer, trajPtr, ctx.nSteps * stride);
        for (let k = 0; k < ctx.nSteps; k++) {
          const stepOffset = k * stride;
          for (let b = 0; b < ctx.nBuses; b++) {
            const base = stepOffset + 1 + b * 3;
            const pv = busPvs[b]!;
            pv.a[k] = trajView[base + 0]!;
            pv.b[k] = trajView[base + 1]!;
            pv.c[k] = trajView[base + 2]!;
          }
        }
      }
    } else {
      for (let k = 0; k < ctx.nSteps; k++) {
        wasm.emt_step(solverPtr);

        for (let b = 0; b < ctx.nBuses; b++) {
          const pv = busPvs[b]!;
          pv.a[k] = vView[b * 3 + 0]!;
          pv.b[k] = vView[b * 3 + 1]!;
          pv.c[k] = vView[b * 3 + 2]!;
        }

        for (let i = 0; i < branchPbs.length; i++) {
          const br = branchPbs[i]!;
          br.pb.a[k] = wasm.emt_get_branch_current(solverPtr, br.idxA);
          br.pb.b[k] = wasm.emt_get_branch_current(solverPtr, br.idxB);
          br.pb.c[k] = wasm.emt_get_branch_current(solverPtr, br.idxC);
        }

        if (ctx.options.onStep) {
          const busMap = new Map<string, { a: number; b: number; c: number }>();
          for (let b = 0; b < ctx.nBuses; b++) {
            const pv = busPvs[b]!;
            busMap.set(ctx.busList[b]!.id, { a: pv.a[k]!, b: pv.b[k]!, c: pv.c[k]! });
          }
          ctx.options.onStep(ctx.time[k]!, k, busMap);
        }
      }
    }

    if (typeof wasm.emt_get_factorization_count === "function") {
      wasmLuCount = Math.max(1, wasm.emt_get_factorization_count(solverPtr));
    }

    const lastK = Math.max(0, ctx.nSteps - 1);
    for (let i = 0; i < ctx.nBuses; i++) {
      const pv = ctx.busPhaseVoltages.get(ctx.busList[i]!.id);
      if (pv) {
        ctx.vaStep[i] = pv.a[lastK] ?? 0;
        ctx.vbStep[i] = pv.b[lastK] ?? 0;
        ctx.vcStep[i] = pv.c[lastK] ?? 0;
      }
    }

    const executionTimeMs = performance.now() - startTime;
    return {
      time: ctx.time,
      busVoltages: ctx.busVoltages,
      busPhaseVoltages: ctx.busPhaseVoltages,
      branchCurrents: ctx.branchCurrents,
      branchPhaseCurrents: ctx.branchPhaseCurrents,
      vA: ctx.vA,
      vB: ctx.vB,
      vC: ctx.vC,
      iA: ctx.iA,
      iB: ctx.iB,
      iC: ctx.iC,
      controlSignals: ctx.controlSignals.size > 0 ? ctx.controlSignals : undefined,
      metrics: {
        totalSteps: ctx.nSteps,
        luFactorizations: wasmLuCount,
        switchingEvents: wasmSwitchingEvents,
        chatterDampedSteps: 0,
        executionTimeMs,
      },
    };
  } catch (err) {
    console.warn(
      "[EMT:wasm] Fast-path failed, falling back to TS solver:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
