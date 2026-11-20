// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atp — Native 3-Phase Dommel `EmtNetworkParticipant` (`AtpEmtParticipant`)
 *
 * Executes ATP-EMTP circuits (`AtpCase`) as lock-stepped 3-phase EMT participants
 * inside ModelScript's generic Phasor <-> EMT hybrid co-simulation engine using a
 * trapezoidal Dommel companion-circuit solver with full state rollback (`getState`/`setState`).
 */

import {
  FdneDommelCompanion,
  type EmtBoundaryFeedSpec,
  type EmtNetworkParticipant,
  type EmtSubStepResult,
  type EmtTrajectoryResult,
  type FdneRationalModel,
} from "@modelscript/exchange";
import { solveLinearSystemSparse } from "@modelscript/runtime";
import type { AtpCase } from "./types.js";

interface AtpCompanionBranch {
  i: number; // -1 for ground
  j: number; // -1 for ground
  gEq: number;
  alpha: number; // trapezoidal history factor
  beta: number;
  iHistA: number;
  iHistB: number;
  iHistC: number;
}

export class AtpEmtParticipant implements EmtNetworkParticipant {
  public readonly id: string;
  public readonly language = "atp";

  private readonly atpCase: AtpCase;
  private busIdxMap = new Map<string, number>();
  private busNames: string[] = [];
  private branches: AtpCompanionBranch[] = [];
  private dtSec = 50e-6;
  private timeArr: number[] = [];
  private busTraj = new Map<string, { a: number[]; b: number[]; c: number[] }>();
  private fdneCompanions = new Map<string, { model: FdneRationalModel; companion: FdneDommelCompanion }>();

  constructor(atpCase: AtpCase, options?: { id?: string }) {
    this.atpCase = atpCase;
    this.id = options?.id ?? (atpCase.title || "ATP_EMT_Plant");
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
    for (const feed of feeds) {
      if (feed.fdneModel) {
        const existing = this.fdneCompanions.get(feed.busId);
        if (!existing || !this.isSameFdneModel(existing.model, feed.fdneModel)) {
          this.fdneCompanions.set(feed.busId, {
            model: feed.fdneModel,
            companion: new FdneDommelCompanion(feed.fdneModel, this.dtSec, 3),
          });
        }
      } else {
        this.fdneCompanions.delete(feed.busId);
      }
    }
  }

  private isGround(node: string): boolean {
    const n = node.trim().toUpperCase();
    return n === "" || n === "0" || n === "GND" || n === "GROUND";
  }

  private getOrAddBus(name: string): number {
    if (this.isGround(name)) return -1;
    const key = name.trim();
    const existing = this.busIdxMap.get(key);
    if (existing !== undefined) return existing;
    const idx = this.busNames.length;
    this.busNames.push(key);
    this.busIdxMap.set(key, idx);
    this.busTraj.set(key, { a: [], b: [], c: [] });
    return idx;
  }

  public initialize(options: Parameters<EmtNetworkParticipant["initialize"]>[0]): void {
    this.dtSec = options.dtEmtSec;
    this.busIdxMap.clear();
    this.busNames = [];
    this.busTraj.clear();
    this.branches = [];
    this.timeArr = [];
    this.fdneCompanions.clear();

    for (const b of options.boundaryBusIds) this.getOrAddBus(b);
    for (const br of this.atpCase.branches) {
      const i = this.getOrAddBus(br.node1);
      const j = this.getOrAddBus(br.node2);
      const r = Math.max(0, br.rOhms);
      const l = Math.max(0, br.lMh * 1e-3);
      const c = Math.max(0, br.cUf * 1e-6);

      if (l > 1e-12) {
        // Series R-L Dommel trapezoidal companion: R_eq = R + 2L/dt
        const rL = (2.0 * l) / this.dtSec;
        const rEq = r + rL;
        const gEq = 1.0 / Math.max(1e-9, rEq);
        const alpha = (rL - r) / Math.max(1e-9, rEq);
        this.branches.push({ i, j, gEq, alpha, beta: gEq * (1.0 + alpha), iHistA: 0, iHistB: 0, iHistC: 0 });
      } else if (c > 1e-12) {
        // Series R-C Dommel trapezoidal companion
        const rC = this.dtSec / (2.0 * c);
        const rEq = r + rC;
        const gEq = 1.0 / Math.max(1e-9, rEq);
        const alpha = (r - rC) / Math.max(1e-9, rEq);
        this.branches.push({ i, j, gEq, alpha, beta: -gEq * (1.0 - alpha), iHistA: 0, iHistB: 0, iHistC: 0 });
      } else if (r > 1e-12) {
        this.branches.push({ i, j, gEq: 1.0 / r, alpha: 0, beta: 0, iHistA: 0, iHistB: 0, iHistC: 0 });
      }
    }
  }

  public stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
  ): EmtSubStepResult {
    this.syncFdneCompanions(feeds);
    const N = this.busNames.length;
    const dim = 3 * N;
    const boundaryCurrents = new Map<string, { ia: number[]; ib: number[]; ic: number[] }>();
    const boundaryVoltages = new Map<string, { va: number[]; vb: number[]; vc: number[] }>();
    for (const f of feeds) {
      boundaryCurrents.set(f.busId, { ia: [], ib: [], ic: [] });
      boundaryVoltages.set(f.busId, { va: [], vb: [], vc: [] });
    }

    const G = new Float64Array(dim * dim);
    const J = new Float64Array(dim);

    for (let s = 0; s < nSubSteps; s++) {
      const t = tStartSec + (s + 1) * dtEmtSec;
      G.fill(0);
      J.fill(0);

      // 1. Stamp RLC companion branches (3 phases)
      for (const br of this.branches) {
        const hist = [br.iHistA, br.iHistB, br.iHistC];
        for (let p = 0; p < 3; p++) {
          if (br.i >= 0) {
            const ni = 3 * br.i + p;
            G[ni * dim + ni] = G[ni * dim + ni]! + br.gEq;
            J[ni] = J[ni]! - hist[p]!;
          }
          if (br.j >= 0) {
            const nj = 3 * br.j + p;
            G[nj * dim + nj] = G[nj * dim + nj]! + br.gEq;
            J[nj] = J[nj]! + hist[p]!;
          }
          if (br.i >= 0 && br.j >= 0) {
            const ni = 3 * br.i + p;
            const nj = 3 * br.j + p;
            G[ni * dim + nj] = G[ni * dim + nj]! - br.gEq;
            G[nj * dim + ni] = G[nj * dim + ni]! - br.gEq;
          }
        }
      }

      // 2. Stamp time-controlled ATP switches
      for (const sw of this.atpCase.switches) {
        const closed = t >= sw.tCloseSec && t < sw.tOpenSec;
        if (!closed) continue;
        const i = this.busIdxMap.get(sw.node1.trim()) ?? -1;
        const j = this.busIdxMap.get(sw.node2.trim()) ?? -1;
        const gSw = 1e4;
        for (let p = 0; p < 3; p++) {
          if (i >= 0) G[(3 * i + p) * dim + (3 * i + p)] = G[(3 * i + p) * dim + (3 * i + p)]! + gSw;
          if (j >= 0) G[(3 * j + p) * dim + (3 * j + p)] = G[(3 * j + p) * dim + (3 * j + p)]! + gSw;
          if (i >= 0 && j >= 0) {
            G[(3 * i + p) * dim + (3 * j + p)] = G[(3 * i + p) * dim + (3 * j + p)]! - gSw;
            G[(3 * j + p) * dim + (3 * i + p)] = G[(3 * j + p) * dim + (3 * i + p)]! - gSw;
          }
        }
      }

      // 3. Stamp internal ATP sources
      for (const src of this.atpCase.sources) {
        const i = this.busIdxMap.get(src.node.trim());
        if (i === undefined) continue;
        const gSrc = 100.0;
        const w = 2 * Math.PI * src.frequencyHz;
        const phi = (src.phaseDeg * Math.PI) / 180.0;
        const ea = src.amplitude * Math.sin(w * t + phi);
        const eb = src.amplitude * Math.sin(w * t + phi - (2 * Math.PI) / 3);
        const ec = src.amplitude * Math.sin(w * t + phi + (2 * Math.PI) / 3);
        const eArr = [ea, eb, ec];
        for (let p = 0; p < 3; p++) {
          const ni = 3 * i + p;
          G[ni * dim + ni] = G[ni * dim + ni]! + gSrc;
          J[ni] = J[ni]! + gSrc * eArr[p]!;
        }
      }

      // 4. Stamp co-simulation boundary feeds (per-micro-step FDNE, 3x3 + mutualCouplings)
      const evalFeeds = feeds.map((f) => ({ feed: f, th: f.evaluateThevenin(t) }));
      for (const { feed, th } of evalFeeds) {
        const bIdx = this.busIdxMap.get(feed.busId);
        if (bIdx === undefined) continue;
        const eVec = [th.ea, th.eb, th.ec];
        const fdneEntry = this.fdneCompanions.get(feed.busId);
        if (fdneEntry) {
          const stamp = fdneEntry.companion.stampCompanion(t, dtEmtSec);
          const gF = fdneEntry.companion.getConductanceSiemens();
          for (let p = 0; p < 3; p++) {
            const ni = 3 * bIdx + p;
            G[ni * dim + ni] = G[ni * dim + ni]! + gF;
            J[ni] = J[ni]! + gF * eVec[p]! + (stamp.iHist[p] ?? 0.0);
          }
        } else {
          const gm = th.gMatrix3x3;
          const iHistVec = [th.iHistA ?? 0, th.iHistB ?? 0, th.iHistC ?? 0];
          if (gm && gm.length >= 9) {
            for (let p = 0; p < 3; p++) {
              let rhsSum = iHistVec[p]!;
              for (let q = 0; q < 3; q++) {
                const gVal = gm[p * 3 + q]!;
                G[(3 * bIdx + p) * dim + (3 * bIdx + q)] = G[(3 * bIdx + p) * dim + (3 * bIdx + q)]! + gVal;
                rhsSum += gVal * eVec[q]!;
              }
              J[3 * bIdx + p] = J[3 * bIdx + p]! + rhsSum;
            }
          } else {
            for (let p = 0; p < 3; p++) {
              const ni = 3 * bIdx + p;
              G[ni * dim + ni] = G[ni * dim + ni]! + th.gSrc;
              J[ni] = J[ni]! + th.gSrc * eVec[p]! + iHistVec[p]!;
            }
          }
        }
        if (th.mutualCouplings) {
          for (const mc of th.mutualCouplings) {
            const peerIdx = this.busIdxMap.get(mc.peerBusId);
            if (peerIdx === undefined || mc.gMatrix3x3.length < 9) continue;
            for (let p = 0; p < 3; p++) {
              for (let q = 0; q < 3; q++) {
                G[(3 * bIdx + p) * dim + (3 * peerIdx + q)] =
                  G[(3 * bIdx + p) * dim + (3 * peerIdx + q)]! + mc.gMatrix3x3[p * 3 + q]!;
              }
            }
          }
        }
      }

      // Diagonal guard
      for (let d = 0; d < dim; d++) {
        if (Math.abs(G[d * dim + d]!) < 1e-12) G[d * dim + d] = 1e-9;
      }

      solveLinearSystemSparse(G, J, dim, { sparseThreshold: 24 });

      // Update companion branch histories
      for (const br of this.branches) {
        if (br.alpha === 0 && br.beta === 0) continue;
        const vA = (br.i >= 0 ? J[3 * br.i + 0]! : 0) - (br.j >= 0 ? J[3 * br.j + 0]! : 0);
        const vB = (br.i >= 0 ? J[3 * br.i + 1]! : 0) - (br.j >= 0 ? J[3 * br.j + 1]! : 0);
        const vC = (br.i >= 0 ? J[3 * br.i + 2]! : 0) - (br.j >= 0 ? J[3 * br.j + 2]! : 0);
        br.iHistA = br.alpha * br.iHistA + br.beta * vA;
        br.iHistB = br.alpha * br.iHistB + br.beta * vB;
        br.iHistC = br.alpha * br.iHistC + br.beta * vC;
      }

      // Record trajectories & boundary currents
      this.timeArr.push(t);
      for (let b = 0; b < N; b++) {
        const tr = this.busTraj.get(this.busNames[b]!)!;
        tr.a.push(J[3 * b + 0]!);
        tr.b.push(J[3 * b + 1]!);
        tr.c.push(J[3 * b + 2]!);
      }

      for (const { feed, th } of evalFeeds) {
        const bIdx = this.busIdxMap.get(feed.busId);
        if (bIdx === undefined) continue;
        const va = J[3 * bIdx + 0]!;
        const vb = J[3 * bIdx + 1]!;
        const vc = J[3 * bIdx + 2]!;
        const dva = va - th.ea;
        const dvb = vb - th.eb;
        const dvc = vc - th.ec;
        let ia: number;
        let ib: number;
        let ic: number;
        const fdneEntry = this.fdneCompanions.get(feed.busId);
        if (fdneEntry) {
          const stamp = fdneEntry.companion.stampCompanion(t, dtEmtSec);
          const gF = fdneEntry.companion.getConductanceSiemens();
          ia = gF * dva - (stamp.iHist[0] ?? 0.0);
          ib = gF * dvb - (stamp.iHist[1] ?? 0.0);
          ic = gF * dvc - (stamp.iHist[2] ?? 0.0);
          fdneEntry.companion.doStep(t, dtEmtSec, [dva, dvb, dvc]);
        } else {
          const gm = th.gMatrix3x3;
          ia =
            gm && gm.length >= 9
              ? gm[0]! * dva + gm[1]! * dvb + gm[2]! * dvc - (th.iHistA ?? 0)
              : th.gSrc * dva - (th.iHistA ?? 0);
          ib =
            gm && gm.length >= 9
              ? gm[3]! * dva + gm[4]! * dvb + gm[5]! * dvc - (th.iHistB ?? 0)
              : th.gSrc * dvb - (th.iHistB ?? 0);
          ic =
            gm && gm.length >= 9
              ? gm[6]! * dva + gm[7]! * dvb + gm[8]! * dvc - (th.iHistC ?? 0)
              : th.gSrc * dvc - (th.iHistC ?? 0);
        }
        boundaryCurrents.get(feed.busId)!.ia.push(ia);
        boundaryCurrents.get(feed.busId)!.ib.push(ib);
        boundaryCurrents.get(feed.busId)!.ic.push(ic);
        boundaryVoltages.get(feed.busId)!.va.push(va);
        boundaryVoltages.get(feed.busId)!.vb.push(vb);
        boundaryVoltages.get(feed.busId)!.vc.push(vc);
      }
    }

    return {
      timeSec: tStartSec + nSubSteps * dtEmtSec,
      stepsExecuted: nSubSteps,
      boundaryCurrents,
      boundaryVoltages,
    };
  }

  public getState(): unknown {
    const fdneSnaps = new Map<string, ReturnType<FdneDommelCompanion["captureState"]>>();
    for (const [busId, entry] of this.fdneCompanions) {
      fdneSnaps.set(busId, entry.companion.captureState());
    }
    return {
      branches: this.branches.map((b) => ({ iHistA: b.iHistA, iHistB: b.iHistB, iHistC: b.iHistC })),
      timeLen: this.timeArr.length,
      fdneSnaps,
    };
  }

  public setState(snapshot: unknown): void {
    const s = snapshot as {
      branches: Array<{ iHistA: number; iHistB: number; iHistC: number }>;
      timeLen: number;
      fdneSnaps?: Map<string, ReturnType<FdneDommelCompanion["captureState"]>>;
    };
    for (let i = 0; i < this.branches.length && i < s.branches.length; i++) {
      this.branches[i]!.iHistA = s.branches[i]!.iHistA;
      this.branches[i]!.iHistB = s.branches[i]!.iHistB;
      this.branches[i]!.iHistC = s.branches[i]!.iHistC;
    }
    this.timeArr.length = s.timeLen;
    for (const tr of this.busTraj.values()) {
      tr.a.length = s.timeLen;
      tr.b.length = s.timeLen;
      tr.c.length = s.timeLen;
    }
    if (s.fdneSnaps) {
      for (const [busId, snap] of s.fdneSnaps) {
        this.fdneCompanions.get(busId)?.companion.restoreState(snap);
      }
    }
  }

  public finalize(): EmtTrajectoryResult {
    const busPhaseVoltages = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();
    for (const [k, v] of this.busTraj) {
      busPhaseVoltages.set(k, {
        a: Float64Array.from(v.a),
        b: Float64Array.from(v.b),
        c: Float64Array.from(v.c),
      });
    }
    return {
      time: Float64Array.from(this.timeArr),
      busPhaseVoltages,
    };
  }
}
