// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — CSMF Control Blocks, EMTDC UDM Bridges & Interactive Parameter Writes
 *
 * Implements:
 * - EMTDC Fortran/C Binary DLL User-Defined Models (`DSDYN` pre-solve & `DSOUT` post-solve)
 * - CSMF control block sensor sampling, stepping, and breaker actuator overrides
 * - Live mid-run `interactiveWrite()` parameter mutation
 */

import type { EmtdcHostBridge } from "../script/emtdc-abi-bridge.js";
import type { EmtNetlist } from "../types.js";
import type { CsmfControlEvaluator } from "./csmf-evaluator.js";
import type {
  ConverterBridgeRuntimeState,
  CustomBlockRuntimeState,
  SwitchState,
  SyncGenState,
} from "./emt-solver-types.js";

/**
 * Steps EMTDC Fortran/C User-Defined Models (`DSDYN` pre-network solve) and stamps
 * resulting current injections into `J3`.
 */
export function stepEmtdcCustomBlocksDsdyn(
  emtdcHostBridge: EmtdcHostBridge | null,
  customBlockStates: readonly CustomBlockRuntimeState[],
  csmfEvaluator: CsmfControlEvaluator | null,
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  J3: Float64Array,
  t: number,
  k: number,
  nSteps: number,
): void {
  if (!emtdcHostBridge || customBlockStates.length === 0) return;

  for (const cbs of customBlockStates) {
    if (csmfEvaluator && cbs.block.inputs) {
      for (const inp of cbs.block.inputs) {
        if (inp.sourceId) {
          cbs.udm.ports[inp.portName] = csmfEvaluator.getSignal(inp.sourceId);
        }
      }
    }
    if (cbs.busIdx >= 0) {
      const va = k > 0 ? vaStep[cbs.busIdx]! : 0.0;
      const vb = k > 0 ? vbStep[cbs.busIdx]! : 0.0;
      const vc = k > 0 ? vcStep[cbs.busIdx]! : 0.0;
      cbs.udm.ports["VA"] = va;
      cbs.udm.ports["VB"] = vb;
      cbs.udm.ports["VC"] = vc;
      cbs.udm.ports["va"] = va;
      cbs.udm.ports["vb"] = vb;
      cbs.udm.ports["vc"] = vc;
      emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
    }
  }

  emtdcHostBridge.stepDsdyn(t, k === 0, k === nSteps - 1);

  for (const cbs of customBlockStates) {
    if (cbs.busIdx >= 0) {
      const iaInj = cbs.udm.ports["IA_INJ"] ?? cbs.udm.ports["IA"] ?? cbs.udm.ports["ia"] ?? 0.0;
      const ibInj = cbs.udm.ports["IB_INJ"] ?? cbs.udm.ports["IB"] ?? cbs.udm.ports["ib"] ?? 0.0;
      const icInj = cbs.udm.ports["IC_INJ"] ?? cbs.udm.ports["IC"] ?? cbs.udm.ports["ic"] ?? 0.0;
      const ccin = emtdcHostBridge.state.CCIN[cbs.busIdx + 1] ?? 0.0;
      J3[3 * cbs.busIdx + 0] = J3[3 * cbs.busIdx + 0]! + iaInj + ccin;
      J3[3 * cbs.busIdx + 1] = J3[3 * cbs.busIdx + 1]! + ibInj;
      J3[3 * cbs.busIdx + 2] = J3[3 * cbs.busIdx + 2]! + icInj;
    }
  }
}

/**
 * Steps EMTDC Fortran/C User-Defined Models (`DSOUT` post-network solve) and records
 * output trajectories and CSMF port signals.
 */
export function stepEmtdcCustomBlocksDsout(
  emtdcHostBridge: EmtdcHostBridge | null,
  customBlockStates: readonly CustomBlockRuntimeState[],
  csmfEvaluator: CsmfControlEvaluator | null,
  vaStep: Float64Array,
  vbStep: Float64Array,
  vcStep: Float64Array,
  k: number,
): void {
  if (!emtdcHostBridge || customBlockStates.length === 0) return;

  for (const cbs of customBlockStates) {
    if (cbs.busIdx >= 0) {
      const va = vaStep[cbs.busIdx]!;
      const vb = vbStep[cbs.busIdx]!;
      const vc = vcStep[cbs.busIdx]!;
      cbs.udm.ports["VA"] = va;
      cbs.udm.ports["VB"] = vb;
      cbs.udm.ports["VC"] = vc;
      cbs.udm.ports["va"] = va;
      cbs.udm.ports["vb"] = vb;
      cbs.udm.ports["vc"] = vc;
      emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
    }
  }

  emtdcHostBridge.stepDsout();

  for (const cbs of customBlockStates) {
    const iaInj = cbs.udm.ports["IA_INJ"] ?? cbs.udm.ports["IA"] ?? cbs.udm.ports["ia"] ?? 0.0;
    const ibInj = cbs.udm.ports["IB_INJ"] ?? cbs.udm.ports["IB"] ?? cbs.udm.ports["ib"] ?? 0.0;
    const icInj = cbs.udm.ports["IC_INJ"] ?? cbs.udm.ports["IC"] ?? cbs.udm.ports["ic"] ?? 0.0;
    if (cbs.ia && cbs.ib && cbs.ic) {
      cbs.ia[k] = iaInj;
      cbs.ib[k] = ibInj;
      cbs.ic[k] = icInj;
    }
    for (const [port, traj] of cbs.signalTrajs) {
      const val = cbs.udm.ports[port] ?? 0.0;
      traj[k] = val;
      if (csmfEvaluator) {
        csmfEvaluator.setSignal(`${cbs.block.id}_${port}`, val);
        if (cbs.block.assignedPorts?.[0] === port) {
          csmfEvaluator.setSignal(cbs.block.id, val);
        }
      }
    }
  }
}

export interface EmtCsmfStepContext {
  readonly csmfEvaluator: CsmfControlEvaluator | null;
  readonly netlist: EmtNetlist;
  readonly busIdxMap: ReadonlyMap<string, number>;
  readonly busPhaseVoltages: ReadonlyMap<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly branchPhaseCurrents: ReadonlyMap<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
  readonly controlSignals: ReadonlyMap<string, Float64Array>;
  readonly switchStates: readonly SwitchState[];
  readonly csmfBreakerOverrides: Map<string, boolean>;
  readonly timeStepSec: number;
}

/**
 * Samples voltage/current sensors, steps the CSMF control block evaluator, records trajectories,
 * and applies breaker status actuator overrides.
 */
export function stepCsmfControlBlocks(ctx: EmtCsmfStepContext, k: number): void {
  const {
    csmfEvaluator,
    netlist,
    busIdxMap,
    busPhaseVoltages,
    branchPhaseCurrents,
    vaStep,
    vbStep,
    vcStep,
    controlSignals,
    switchStates,
    csmfBreakerOverrides,
    timeStepSec,
  } = ctx;
  if (!csmfEvaluator) return;

  const controlBlocks = netlist.controlBlocks ?? [];
  for (const blk of controlBlocks) {
    const ph = Math.round(blk.params["phase"] ?? 0);
    if (blk.kind === "sensor_v" && blk.sensorTarget) {
      const bIdx = busIdxMap.get(blk.sensorTarget);
      const v =
        bIdx !== undefined
          ? ((ph === 1 ? vbStep[bIdx] : ph === 2 ? vcStep[bIdx] : vaStep[bIdx]) ?? 0)
          : ((ph === 1
              ? busPhaseVoltages.get(blk.sensorTarget)?.b[k]
              : ph === 2
                ? busPhaseVoltages.get(blk.sensorTarget)?.c[k]
                : busPhaseVoltages.get(blk.sensorTarget)?.a[k]) ?? 0);
      csmfEvaluator.setSignal(blk.id, v);
    } else if (blk.kind === "sensor_i" && blk.sensorTarget) {
      const brPh = branchPhaseCurrents.get(blk.sensorTarget);
      const i = (ph === 1 ? brPh?.b[k] : ph === 2 ? brPh?.c[k] : brPh?.a[k]) ?? 0;
      csmfEvaluator.setSignal(blk.id, i);
    }
  }
  const stepValues = csmfEvaluator.step(timeStepSec);
  for (const blk of controlBlocks) {
    const val = stepValues.get(blk.id) ?? 0;
    const traj = controlSignals.get(blk.id);
    if (traj) traj[k] = val;
    if (blk.actuator?.type === "breaker_status") {
      const target = blk.actuator.targetId;
      // Convention: signal > 0.5 trips/opens breaker (isClosed = false); <= 0.5 keeps closed
      const isClosed = val <= 0.5;
      for (const swState of switchStates) {
        if (swState.sw.id === target || swState.sw.id.startsWith(`${target}_`) || swState.sw.id.includes(target)) {
          csmfBreakerOverrides.set(swState.sw.id, isClosed);
        }
      }
    }
  }
}

export interface EmtInteractiveWriteContext {
  readonly netlist: EmtNetlist;
  readonly csmfEvaluator: CsmfControlEvaluator | null;
  readonly switchStates: readonly SwitchState[];
  readonly csmfBreakerOverrides: Map<string, boolean>;
  readonly bridgeRuntimeStates: readonly ConverterBridgeRuntimeState[];
  readonly syncGenerators: readonly SyncGenState[];
}

/**
 * Mutates a live runtime parameter (CSMF slider/dial/pushbutton `Value`, breaker open/close state,
 * converter `pRefMw`/`qRefMvar`/`vDcRefKv`/`firingAngleDeg`, or generator `efPu`/`pmPu`) mid-run.
 */
export function applyInteractiveWrite(
  ctx: EmtInteractiveWriteContext,
  targetId: string,
  paramOrAction: string,
  value: number | boolean,
): boolean {
  let applied = false;
  const key = paramOrAction.toLowerCase();
  if (key === "breaker" || key === "switch" || key === "closed" || typeof value === "boolean") {
    const closed = Boolean(value);
    for (const swState of ctx.switchStates) {
      if (swState.sw.id === targetId || swState.sw.id.startsWith(`${targetId}_`) || swState.sw.id.includes(targetId)) {
        ctx.csmfBreakerOverrides.set(swState.sw.id, closed);
        applied = true;
      }
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (ctx.csmfEvaluator?.setBlockParam(targetId, paramOrAction || "Value", value)) {
      applied = true;
    }
    if (ctx.csmfEvaluator) {
      for (const blk of ctx.netlist.controlBlocks ?? []) {
        if (blk.id === targetId) {
          blk.params[paramOrAction || "Value"] = value;
          ctx.csmfEvaluator.setSignal(targetId, value);
          applied = true;
        }
      }
    }
    for (const br of ctx.bridgeRuntimeStates) {
      if (br.conv.id === targetId) {
        if (paramOrAction === "pRefMw" || paramOrAction === "p_ref") br.conv.pRefMw = value;
        else if (paramOrAction === "qRefMvar" || paramOrAction === "q_ref") br.conv.qRefMvar = value;
        else if (paramOrAction === "vDcRefKv" || paramOrAction === "vdc_ref") {
          br.conv.vDcRefKv = value;
          br.vDcRefVolts = value * 1e3;
        } else if (paramOrAction === "firingAngleDeg" || paramOrAction === "alpha") br.conv.firingAngleDeg = value;
        applied = true;
      }
    }
    for (const sg of ctx.syncGenerators) {
      if (sg.id === targetId) {
        if (paramOrAction === "efPu" || paramOrAction === "ef") sg.efPu = value;
        else if (paramOrAction === "pmPu" || paramOrAction === "tm" || paramOrAction === "pm") sg.pmPu = value;
        applied = true;
      }
    }
  }
  return applied;
}
