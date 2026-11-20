// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/modelica — Polyglot `EmtNetworkParticipant` (`ModelicaEmtParticipant`)
 *
 * Bridges Modelica 3-phase electrical / inverter plant models (exposed via
 * `FmiLsEmtCompanionInstance` Norton companions or compiled Modelica plant callbacks)
 * into ModelScript's generic Phasor <-> EMT hybrid co-simulation engine with
 * simultaneous Dommel nodal coupling and optional state rollback.
 */

import type {
  EmtBoundaryFeedSpec,
  EmtNetworkParticipant,
  EmtSubStepResult,
  EmtTrajectoryResult,
  FmiLsEmtCompanionInstance,
} from "@modelscript/exchange";
import { solveLinearSystemSparse } from "@modelscript/runtime";

export interface ModelicaEmtCompanionPort {
  /** Boundary bus identifier in this Modelica plant. */
  busId: string;
  /** Modelica `fmi-ls-emt` Norton companion (3x3 G_eq + 3-phase I_hist). */
  companion: FmiLsEmtCompanionInstance;
  /** Optional state capture/restore hooks for Picard rollback. */
  captureState?: (() => unknown) | undefined;
  restoreState?: ((snap: unknown) => void) | undefined;
}

export class ModelicaEmtParticipant implements EmtNetworkParticipant {
  public readonly id: string;
  public readonly language = "modelica";

  private readonly ports = new Map<string, ModelicaEmtCompanionPort>();
  private timeArr: number[] = [];
  private busTraj = new Map<string, { a: number[]; b: number[]; c: number[] }>();

  constructor(ports: ModelicaEmtCompanionPort[], options?: { id?: string }) {
    this.id = options?.id ?? "Modelica_EMT_Plant";
    for (const p of ports) {
      this.ports.set(p.busId, p);
    }
  }

  public initialize(options: Parameters<EmtNetworkParticipant["initialize"]>[0]): void {
    this.timeArr = [];
    this.busTraj.clear();
    for (const b of options.boundaryBusIds) {
      this.busTraj.set(b, { a: [], b: [], c: [] });
    }
  }

  public stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
  ): EmtSubStepResult {
    const boundaryCurrents = new Map<string, { ia: number[]; ib: number[]; ic: number[] }>();
    const boundaryVoltages = new Map<string, { va: number[]; vb: number[]; vc: number[] }>();
    for (const f of feeds) {
      boundaryCurrents.set(f.busId, { ia: [], ib: [], ic: [] });
      boundaryVoltages.set(f.busId, { va: [], vb: [], vc: [] });
    }

    const G3 = new Float64Array(9);
    const J3 = new Float64Array(3);

    for (let s = 0; s < nSubSteps; s++) {
      const t = tStartSec + (s + 1) * dtEmtSec;
      this.timeArr.push(t);

      for (const feed of feeds) {
        const th = feed.evaluateThevenin(t);
        const port = this.ports.get(feed.busId);
        const compStamp = port?.companion.stampCompanion(t, dtEmtSec);

        // Assemble 3x3 nodal system: (G_th + G_modelica) * v = G_th * e_th + iHist_th + iHist_modelica
        G3.fill(0);
        J3.fill(0);
        const eVec = [th.ea, th.eb, th.ec];
        const iHistTh = [th.iHistA ?? 0, th.iHistB ?? 0, th.iHistC ?? 0];
        const gm = th.gMatrix3x3;

        for (let p = 0; p < 3; p++) {
          let rhsP = iHistTh[p]! + (compStamp?.iHist[p] ?? 0);
          for (let q = 0; q < 3; q++) {
            const gThPQ = gm && gm.length >= 9 ? gm[p * 3 + q]! : p === q ? th.gSrc : 0.0;
            const gModPQ = compStamp && compStamp.gEq.length >= 9 ? (compStamp.gEq[p * 3 + q] ?? 0) : 0.0;
            G3[p * 3 + q] = gThPQ + gModPQ;
            rhsP += gThPQ * eVec[q]!;
          }
          J3[p] = rhsP;
        }

        solveLinearSystemSparse(G3, J3, 3, { sparseThreshold: 100 });
        const va = J3[0]!;
        const vb = J3[1]!;
        const vc = J3[2]!;

        port?.companion.doStep(t, dtEmtSec, [va, vb, vc]);

        const dva = va - th.ea;
        const dvb = vb - th.eb;
        const dvc = vc - th.ec;
        const ia =
          gm && gm.length >= 9 ? gm[0]! * dva + gm[1]! * dvb + gm[2]! * dvc - iHistTh[0]! : th.gSrc * dva - iHistTh[0]!;
        const ib =
          gm && gm.length >= 9 ? gm[3]! * dva + gm[4]! * dvb + gm[5]! * dvc - iHistTh[1]! : th.gSrc * dvb - iHistTh[1]!;
        const ic =
          gm && gm.length >= 9 ? gm[6]! * dva + gm[7]! * dvb + gm[8]! * dvc - iHistTh[2]! : th.gSrc * dvc - iHistTh[2]!;

        boundaryCurrents.get(feed.busId)!.ia.push(ia);
        boundaryCurrents.get(feed.busId)!.ib.push(ib);
        boundaryCurrents.get(feed.busId)!.ic.push(ic);
        boundaryVoltages.get(feed.busId)!.va.push(va);
        boundaryVoltages.get(feed.busId)!.vb.push(vb);
        boundaryVoltages.get(feed.busId)!.vc.push(vc);

        const tr = this.busTraj.get(feed.busId);
        if (tr) {
          tr.a.push(va);
          tr.b.push(vb);
          tr.c.push(vc);
        }
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
    const portSnaps = new Map<string, unknown>();
    for (const [busId, p] of this.ports) {
      if (p.captureState) portSnaps.set(busId, p.captureState());
    }
    return { portSnaps, timeLen: this.timeArr.length };
  }

  public setState(snapshot: unknown): void {
    const s = snapshot as { portSnaps: Map<string, unknown>; timeLen: number };
    for (const [busId, snap] of s.portSnaps) {
      this.ports.get(busId)?.restoreState?.(snap);
    }
    this.timeArr.length = s.timeLen;
    for (const tr of this.busTraj.values()) {
      tr.a.length = s.timeLen;
      tr.b.length = s.timeLen;
      tr.c.length = s.timeLen;
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
