// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Step-Wise `EmtNetworkParticipant` Implementation (`PscadEmtParticipant`)
 *
 * Wraps `EmtSolver` with incremental macro-step batching (`beginStepSession`, `stepSessionBatch`,
 * `endStepSession`), unbalanced 3-phase Thévenin/Norton feeds (`threePhaseThevenin`),
 * and coordinated t=0 steady-state load-flow initialization.
 */

import {
  FdneDommelCompanion,
  type EmtBoundaryFeedSpec,
  type EmtNetworkParticipant,
  type EmtSubStepResult,
  type EmtTrajectoryResult,
  type FdneRationalModel,
  type PhasorBoundaryBusVoltage,
} from "@modelscript/exchange";
import type { EmtNetlist } from "../types.js";
import { EmtSolver, type EmtBoundaryFeed, type EmtSolverOptions } from "./emt-solver.js";

export class PscadEmtParticipant implements EmtNetworkParticipant {
  public readonly id: string;
  public readonly language = "pscad";

  private readonly netlist: EmtNetlist;
  private readonly extraOptions?: Partial<EmtSolverOptions> | undefined;

  private solver: EmtSolver | null = null;
  private session: ReturnType<EmtSolver["beginStepSession"]> | null = null;
  private dtEmtSec = 50e-6;
  private boundaryBusIds: string[] = [];
  private activeFeeds: EmtBoundaryFeedSpec[] = [];
  private fdneCompanions = new Map<string, { model: FdneRationalModel; companion: FdneDommelCompanion }>();

  // Per-macro-step sample buffers populated by `EmtSolver`'s `onStep` hook
  private stepCurrents = new Map<string, { ia: number[]; ib: number[]; ic: number[] }>();
  private stepVoltages = new Map<string, { va: number[]; vb: number[]; vc: number[] }>();

  constructor(netlist: EmtNetlist, options?: { id?: string; solverOptions?: Partial<EmtSolverOptions> | undefined }) {
    this.netlist = netlist;
    this.id = options?.id ?? "PSCAD_EMT_Plant";
    this.extraOptions = options?.solverOptions;
  }

  private isSameFdneModel(a: FdneRationalModel, b: FdneRationalModel): boolean {
    if (a === b) return true;
    if (a.d !== b.d || a.e !== b.e || a.poles.length !== b.poles.length) return false;
    for (let i = 0; i < a.poles.length; i++) {
      if (a.poles[i]!.pole !== b.poles[i]!.pole || a.poles[i]!.residue !== b.poles[i]!.residue) return false;
    }
    return true;
  }

  private syncFdneCompanions(feeds: EmtBoundaryFeedSpec[]): void {
    for (const f of feeds) {
      if (f.fdneModel) {
        const existing = this.fdneCompanions.get(f.busId);
        if (!existing || !this.isSameFdneModel(existing.model, f.fdneModel)) {
          this.fdneCompanions.set(f.busId, {
            model: f.fdneModel,
            companion: new FdneDommelCompanion(f.fdneModel, this.dtEmtSec, 3),
          });
        }
      } else {
        this.fdneCompanions.delete(f.busId);
      }
    }
  }

  private toEmtBoundaryFeeds(feeds: EmtBoundaryFeedSpec[]): EmtBoundaryFeed[] {
    return feeds.map((f) => ({
      busId: f.busId,
      threePhaseThevenin: (t: number) => {
        const base = f.evaluateThevenin(t);
        const fdneEntry = this.fdneCompanions.get(f.busId);
        if (!fdneEntry) return base;
        const stamp = fdneEntry.companion.stampCompanion(t, this.dtEmtSec);
        return {
          ...base,
          gSrc: fdneEntry.companion.getConductanceSiemens(),
          gMatrix3x3: stamp.gEq,
          iHistA: (base.iHistA ?? 0.0) + (stamp.iHist[0] ?? 0.0),
          iHistB: (base.iHistB ?? 0.0) + (stamp.iHist[1] ?? 0.0),
          iHistC: (base.iHistC ?? 0.0) + (stamp.iHist[2] ?? 0.0),
        };
      },
    }));
  }

  public initialize(options: {
    durationSec: number;
    dtEmtSec: number;
    frequencyHz: number;
    boundaryBusIds: string[];
    initialBoundaryVoltages?: Map<string, PhasorBoundaryBusVoltage> | undefined;
    initialFeeds?: EmtBoundaryFeedSpec[] | undefined;
  }): void {
    this.dtEmtSec = options.dtEmtSec;
    this.boundaryBusIds = options.boundaryBusIds.slice();
    this.activeFeeds = options.initialFeeds ?? [];
    this.fdneCompanions.clear();
    this.syncFdneCompanions(this.activeFeeds);

    const solverOpts: EmtSolverOptions = {
      ...this.extraOptions,
      timeStepSec: options.dtEmtSec,
      durationSec: options.durationSec,
      nominalFrequencyHz: options.frequencyHz,
      initializeFromLoadFlow: this.extraOptions?.initializeFromLoadFlow ?? true,
      boundaryFeeds: this.toEmtBoundaryFeeds(this.activeFeeds),
      onStep: (t, _stepIdx, busVoltages) => {
        for (const feed of this.activeFeeds) {
          const vBus = busVoltages.get(feed.busId);
          if (!vBus) continue;
          const th = feed.evaluateThevenin(t);
          const fdneEntry = this.fdneCompanions.get(feed.busId);
          const dva = vBus.a - th.ea;
          const dvb = vBus.b - th.eb;
          const dvc = vBus.c - th.ec;

          let ia: number;
          let ib: number;
          let ic: number;
          if (fdneEntry) {
            const stamp = fdneEntry.companion.stampCompanion(t, this.dtEmtSec);
            const gF = fdneEntry.companion.getConductanceSiemens();
            ia = gF * dva - (stamp.iHist[0] ?? 0.0);
            ib = gF * dvb - (stamp.iHist[1] ?? 0.0);
            ic = gF * dvc - (stamp.iHist[2] ?? 0.0);
            // Advance FDNE recursive-convolution state at EVERY micro-step!
            fdneEntry.companion.doStep(t, this.dtEmtSec, [dva, dvb, dvc]);
          } else {
            const gm = th.gMatrix3x3;
            if (gm && gm.length >= 9) {
              ia = gm[0]! * dva + gm[1]! * dvb + gm[2]! * dvc - (th.iHistA ?? 0.0);
              ib = gm[3]! * dva + gm[4]! * dvb + gm[5]! * dvc - (th.iHistB ?? 0.0);
              ic = gm[6]! * dva + gm[7]! * dvb + gm[8]! * dvc - (th.iHistC ?? 0.0);
            } else {
              ia = th.gSrc * dva - (th.iHistA ?? 0.0);
              ib = th.gSrc * dvb - (th.iHistB ?? 0.0);
              ic = th.gSrc * dvc - (th.iHistC ?? 0.0);
            }
          }

          let cBuf = this.stepCurrents.get(feed.busId);
          if (!cBuf) {
            cBuf = { ia: [], ib: [], ic: [] };
            this.stepCurrents.set(feed.busId, cBuf);
          }
          cBuf.ia.push(ia);
          cBuf.ib.push(ib);
          cBuf.ic.push(ic);

          let vBuf = this.stepVoltages.get(feed.busId);
          if (!vBuf) {
            vBuf = { va: [], vb: [], vc: [] };
            this.stepVoltages.set(feed.busId, vBuf);
          }
          vBuf.va.push(vBus.a);
          vBuf.vb.push(vBus.b);
          vBuf.vc.push(vBus.c);
        }
      },
    };

    this.solver = new EmtSolver(this.netlist, solverOpts);
    this.session = this.solver.beginStepSession();
  }

  public stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
  ): EmtSubStepResult {
    if (!this.solver || !this.session) {
      throw new Error(`PscadEmtParticipant '${this.id}' has not been initialized.`);
    }

    this.activeFeeds = feeds;
    this.syncFdneCompanions(feeds);
    this.stepCurrents = new Map();
    this.stepVoltages = new Map();
    for (const busId of this.boundaryBusIds) {
      this.stepCurrents.set(busId, { ia: [], ib: [], ic: [] });
      this.stepVoltages.set(busId, { va: [], vb: [], vc: [] });
    }

    const executed = this.solver.stepSessionBatch(this.session, nSubSteps, this.toEmtBoundaryFeeds(feeds));

    return {
      timeSec: tStartSec + executed * dtEmtSec,
      stepsExecuted: executed,
      boundaryCurrents: this.stepCurrents,
      boundaryVoltages: this.stepVoltages,
    };
  }

  public getState(): unknown {
    if (!this.solver || !this.session) return undefined;
    const fdneSnaps = new Map<string, ReturnType<FdneDommelCompanion["captureState"]>>();
    for (const [busId, entry] of this.fdneCompanions) {
      fdneSnaps.set(busId, entry.companion.captureState());
    }
    return {
      solverSnap: this.solver.captureStepSessionState(this.session),
      fdneSnaps,
    };
  }

  public setState(snapshot: unknown): void {
    if (!this.solver || !this.session || !snapshot) return;
    const s = snapshot as {
      solverSnap: unknown;
      fdneSnaps?: Map<string, ReturnType<FdneDommelCompanion["captureState"]>>;
    };
    this.solver.restoreStepSessionState(this.session, s.solverSnap);
    if (s.fdneSnaps) {
      for (const [busId, snap] of s.fdneSnaps) {
        this.fdneCompanions.get(busId)?.companion.restoreState(snap);
      }
    }
  }

  public finalize(): EmtTrajectoryResult {
    if (!this.solver || !this.session) {
      return {
        time: new Float64Array(0),
        busPhaseVoltages: new Map(),
      };
    }
    const res = this.solver.endStepSession(this.session);
    return {
      time: res.time,
      busPhaseVoltages: res.busPhaseVoltages,
      controlSignals: res.controlSignals,
    };
  }
}
