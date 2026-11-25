// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  BergeronLineState,
  BusInfo,
  CompanionBranch,
  EmtSolverResult,
  EmtStepSession,
  EmtStepSessionCheckpoint,
  PscadSnapshot,
  SwitchState,
  SyncGenState,
} from "./emt-solver-types.js";

export interface EmtSnapshotContext {
  readonly nBuses: number;
  readonly nSteps: number;
  readonly timeStepSec: number;
  readonly omega: number;
  readonly time: Float64Array;
  readonly busList: readonly BusInfo[];
  readonly busIdxMap: ReadonlyMap<string, number>;
  readonly busPhaseVoltages: ReadonlyMap<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly vaStep: Float64Array;
  readonly vbStep: Float64Array;
  readonly vcStep: Float64Array;
  readonly companionBranches: readonly CompanionBranch[];
  readonly bergeronLines: readonly BergeronLineState[];
  readonly syncGenerators: readonly SyncGenState[];
  readonly switchStates: readonly SwitchState[];
}

/**
 * Restores solver internal state (bus voltages, companion branch histories, Bergeron/ULM line buffers,
 * synchronous generator rotor angles, and switch states) from a `PscadSnapshot` (`.snp`).
 */
export function applyEmtSnapshot(ctx: EmtSnapshotContext, snapshot: PscadSnapshot): void {
  for (const [busId, v] of Object.entries(snapshot.busVoltages ?? {})) {
    const idx = ctx.busIdxMap.get(busId);
    if (idx !== undefined && idx >= 0) {
      ctx.vaStep[idx] = v.va;
      ctx.vbStep[idx] = v.vb;
      ctx.vcStep[idx] = v.vc;
    }
  }
  for (const br of ctx.companionBranches) {
    const h = snapshot.branchHistories?.[br.id];
    if (h) {
      br.iHistA = h.iHistA;
      br.iHistB = h.iHistB;
      br.iHistC = h.iHistC;
    }
  }
  if (snapshot.bergeronBuffers) {
    for (const bl of ctx.bergeronLines) {
      const b = snapshot.bergeronBuffers[bl.id];
      if (!b) continue;
      bl.ptr = b.ptr % bl.bufLen;
      const copyBuf = (dst: Float64Array, src: number[]) => {
        const len = Math.min(dst.length, src.length);
        for (let i = 0; i < len; i++) dst[i] = src[i]!;
      };
      copyBuf(bl.vkBufA, b.vkBufA);
      copyBuf(bl.vkBufB, b.vkBufB);
      copyBuf(bl.vkBufC, b.vkBufC);
      copyBuf(bl.vmBufA, b.vmBufA);
      copyBuf(bl.vmBufB, b.vmBufB);
      copyBuf(bl.vmBufC, b.vmBufC);
      copyBuf(bl.ikmBufA, b.ikmBufA);
      copyBuf(bl.ikmBufB, b.ikmBufB);
      copyBuf(bl.ikmBufC, b.ikmBufC);
      copyBuf(bl.imkBufA, b.imkBufA);
      copyBuf(bl.imkBufB, b.imkBufB);
      copyBuf(bl.imkBufC, b.imkBufC);
    }
  }
  if (snapshot.syncGenerators) {
    for (const sg of ctx.syncGenerators) {
      const g = snapshot.syncGenerators[sg.id];
      if (g) {
        sg.deltaRad = g.deltaRad;
        sg.omegaRadSec = g.omegaRadSec;
      }
    }
  }
  if (snapshot.switchStates) {
    for (const sw of ctx.switchStates) {
      const st = snapshot.switchStates[sw.sw.id];
      if (typeof st === "boolean") {
        sw.currentClosed = st;
      }
    }
  }
}

/**
 * Exports the current (or specified step's) complete EMT operating point as a `PscadSnapshot` (`.snp`).
 */
export function exportEmtSnapshot(ctx: EmtSnapshotContext, stepIndex?: number): PscadSnapshot {
  const k = stepIndex !== undefined ? Math.max(0, Math.min(ctx.nSteps - 1, stepIndex)) : Math.max(0, ctx.nSteps - 1);
  const busVoltages: Record<string, { va: number; vb: number; vc: number }> = {};
  for (let i = 0; i < ctx.nBuses; i++) {
    const busId = ctx.busList[i]!.id;
    const pv = ctx.busPhaseVoltages.get(busId);
    const useTraj = Boolean(pv && (pv.a[k] !== 0 || pv.b[k] !== 0 || pv.c[k] !== 0));
    busVoltages[busId] = {
      va: useTraj ? pv!.a[k]! : ctx.vaStep[i]!,
      vb: useTraj ? pv!.b[k]! : ctx.vbStep[i]!,
      vc: useTraj ? pv!.c[k]! : ctx.vcStep[i]!,
    };
  }

  const branchHistories: Record<string, { iHistA: number; iHistB: number; iHistC: number }> = {};
  for (const br of ctx.companionBranches) {
    branchHistories[br.id] = {
      iHistA: br.iHistA,
      iHistB: br.iHistB,
      iHistC: br.iHistC,
    };
  }

  const bergeronBuffers: NonNullable<PscadSnapshot["bergeronBuffers"]> = {};
  for (const bl of ctx.bergeronLines) {
    bergeronBuffers[bl.id] = {
      ptr: bl.ptr,
      vkBufA: Array.from(bl.vkBufA),
      vkBufB: Array.from(bl.vkBufB),
      vkBufC: Array.from(bl.vkBufC),
      vmBufA: Array.from(bl.vmBufA),
      vmBufB: Array.from(bl.vmBufB),
      vmBufC: Array.from(bl.vmBufC),
      ikmBufA: Array.from(bl.ikmBufA),
      ikmBufB: Array.from(bl.ikmBufB),
      ikmBufC: Array.from(bl.ikmBufC),
      imkBufA: Array.from(bl.imkBufA),
      imkBufB: Array.from(bl.imkBufB),
      imkBufC: Array.from(bl.imkBufC),
    };
  }

  const syncGenerators: Record<string, { deltaRad: number; omegaRadSec: number }> = {};
  for (const sg of ctx.syncGenerators) {
    syncGenerators[sg.id] = {
      deltaRad: sg.deltaRad,
      omegaRadSec: sg.omegaRadSec,
    };
  }

  const switchStates: Record<string, boolean> = {};
  for (const sw of ctx.switchStates) {
    switchStates[sw.sw.id] = sw.currentClosed;
  }

  return {
    formatVersion: "1.0",
    timestampSec: ctx.time[k] ?? k * ctx.timeStepSec,
    nominalFrequencyHz: ctx.omega / (2 * Math.PI),
    busVoltages,
    branchHistories,
    bergeronBuffers: Object.keys(bergeronBuffers).length > 0 ? bergeronBuffers : undefined,
    syncGenerators: Object.keys(syncGenerators).length > 0 ? syncGenerators : undefined,
    switchStates: Object.keys(switchStates).length > 0 ? switchStates : undefined,
  };
}

/**
 * Serializes a `PscadSnapshot` operating point to a PSCAD `.snp` snapshot file string.
 */
export function serializePscadSnapshot(snapshot: PscadSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Parses a PSCAD `.snp` snapshot file string into a `PscadSnapshot` structure.
 */
export function parsePscadSnapshot(content: string): PscadSnapshot {
  const parsed = JSON.parse(content) as PscadSnapshot;
  return {
    formatVersion: "1.0",
    timestampSec: Number(parsed.timestampSec ?? 0),
    nominalFrequencyHz: Number(parsed.nominalFrequencyHz ?? 60),
    busVoltages: parsed.busVoltages ?? {},
    branchHistories: parsed.branchHistories ?? {},
    bergeronBuffers: parsed.bergeronBuffers,
    syncGenerators: parsed.syncGenerators,
    switchStates: parsed.switchStates,
  };
}

/**
 * Collects all unique `ArrayBuffer` instances backing an `EmtSolverResult` so a
 * Web Worker can transfer 100k-step `Float64Array` trajectories across threads with zero copy.
 */
export function extractEmtTransferableBuffers(result: EmtSolverResult): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const addBuf = (arr?: Float64Array) => {
    if (arr && arr.buffer instanceof ArrayBuffer) {
      seen.add(arr.buffer);
    }
  };
  addBuf(result.time);
  const addMapBufs = (map?: Map<string, Float64Array>) => {
    if (!map) return;
    for (const arr of map.values()) {
      addBuf(arr);
    }
  };
  addMapBufs(result.vA);
  addMapBufs(result.vB);
  addMapBufs(result.vC);
  addMapBufs(result.iA);
  addMapBufs(result.iB);
  addMapBufs(result.iC);
  for (const pv of result.busPhaseVoltages.values()) {
    addBuf(pv.a);
    addBuf(pv.b);
    addBuf(pv.c);
  }
  for (const pc of result.branchPhaseCurrents.values()) {
    addBuf(pc.a);
    addBuf(pc.b);
    addBuf(pc.c);
  }
  if (result.controlSignals) {
    for (const sig of result.controlSignals.values()) {
      addBuf(sig);
    }
  }
  return Array.from(seen);
}

/**
 * Captures a complete in-memory checkpoint of an active EMT step session
 * for macro-step Picard / waveform-relaxation rollback.
 */
export function captureEmtStepSessionState(ctx: EmtSnapshotContext, session: EmtStepSession): EmtStepSessionCheckpoint {
  return {
    stepCursor: session.stepCursor,
    vaStep: new Float64Array(ctx.vaStep),
    vbStep: new Float64Array(ctx.vbStep),
    vcStep: new Float64Array(ctx.vcStep),
    vaPrevStep: new Float64Array(session.loopState.vaPrevStep),
    vbPrevStep: new Float64Array(session.loopState.vbPrevStep),
    vcPrevStep: new Float64Array(session.loopState.vcPrevStep),
    vPreStep3: new Float64Array(session.loopState.vPreStep3),
    branchHistories: ctx.companionBranches.map((br) => ({
      iHistA: br.iHistA,
      iHistB: br.iHistB,
      iHistC: br.iHistC,
    })),
    bergeronStates: ctx.bergeronLines.map((bl) => ({
      ptr: bl.ptr,
      vkBufA: new Float64Array(bl.vkBufA),
      vkBufB: new Float64Array(bl.vkBufB),
      vkBufC: new Float64Array(bl.vkBufC),
      vmBufA: new Float64Array(bl.vmBufA),
      vmBufB: new Float64Array(bl.vmBufB),
      vmBufC: new Float64Array(bl.vmBufC),
      ikmBufA: new Float64Array(bl.ikmBufA),
      ikmBufB: new Float64Array(bl.ikmBufB),
      ikmBufC: new Float64Array(bl.ikmBufC),
      imkBufA: new Float64Array(bl.imkBufA),
      imkBufB: new Float64Array(bl.imkBufB),
      imkBufC: new Float64Array(bl.imkBufC),
    })),
    syncGenStates: ctx.syncGenerators.map((sg) => ({
      deltaRad: sg.deltaRad,
      omegaRadSec: sg.omegaRadSec,
      edSubPu: sg.edSubPu,
      eqSubPu: sg.eqSubPu,
    })),
    switchStates: ctx.switchStates.map((sw) => sw.currentClosed),
  };
}

/**
 * Restores a previously captured EMT step session checkpoint.
 */
export function restoreEmtStepSessionState(ctx: EmtSnapshotContext, session: EmtStepSession, snapshot: unknown): void {
  const s = snapshot as EmtStepSessionCheckpoint;
  session.stepCursor = s.stepCursor;
  ctx.vaStep.set(s.vaStep);
  ctx.vbStep.set(s.vbStep);
  ctx.vcStep.set(s.vcStep);
  session.loopState.vaPrevStep.set(s.vaPrevStep);
  session.loopState.vbPrevStep.set(s.vbPrevStep);
  session.loopState.vcPrevStep.set(s.vcPrevStep);
  session.loopState.vPreStep3.set(s.vPreStep3);

  for (let i = 0; i < ctx.companionBranches.length && i < s.branchHistories.length; i++) {
    const br = ctx.companionBranches[i]!;
    const h = s.branchHistories[i]!;
    br.iHistA = h.iHistA;
    br.iHistB = h.iHistB;
    br.iHistC = h.iHistC;
  }
  for (let i = 0; i < ctx.bergeronLines.length && i < s.bergeronStates.length; i++) {
    const bl = ctx.bergeronLines[i]!;
    const bs = s.bergeronStates[i]!;
    bl.ptr = bs.ptr;
    bl.vkBufA.set(bs.vkBufA);
    bl.vkBufB.set(bs.vkBufB);
    bl.vkBufC.set(bs.vkBufC);
    bl.vmBufA.set(bs.vmBufA);
    bl.vmBufB.set(bs.vmBufB);
    bl.vmBufC.set(bs.vmBufC);
    bl.ikmBufA.set(bs.ikmBufA);
    bl.ikmBufB.set(bs.ikmBufB);
    bl.ikmBufC.set(bs.ikmBufC);
    bl.imkBufA.set(bs.imkBufA);
    bl.imkBufB.set(bs.imkBufB);
    bl.imkBufC.set(bs.imkBufC);
  }
  for (let i = 0; i < ctx.syncGenerators.length && i < s.syncGenStates.length; i++) {
    const sg = ctx.syncGenerators[i]!;
    const gs = s.syncGenStates[i]!;
    sg.deltaRad = gs.deltaRad;
    sg.omegaRadSec = gs.omegaRadSec;
    sg.edSubPu = gs.edSubPu;
    sg.eqSubPu = gs.eqSubPu;
  }
  for (let i = 0; i < ctx.switchStates.length && i < s.switchStates.length; i++) {
    ctx.switchStates[i]!.currentClosed = s.switchStates[i]!;
  }
}
