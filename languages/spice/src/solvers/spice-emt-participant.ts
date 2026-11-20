// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Native MNA `EmtNetworkParticipant` (`SpiceEmtParticipant`)
 *
 * Bridges SPICE power-electronics / inverter circuits (`SpiceCircuit`) into
 * ModelScript's generic Phasor <-> EMT hybrid co-simulation engine using
 * trapezoidal Modified Nodal Analysis (MNA) with 3-phase boundary port stamping
 * (`<bus>_A`, `<bus>_B`, `<bus>_C` or single-phase `<bus>`) and state rollback.
 */

import type {
  EmtBoundaryFeedSpec,
  EmtNetworkParticipant,
  EmtSubStepResult,
  EmtTrajectoryResult,
} from "@modelscript/exchange";
import type { SpiceCircuit, SpiceComponent } from "../types.js";
import {
  buildMnaIndexing,
  DenseMatrix,
  flattenSpiceCircuit,
  type MnaIndexing,
  solveLinearSystem,
  stampConductance,
  stampCurrentSource,
} from "./mna.js";

interface CapState {
  comp: SpiceComponent;
  n1: string;
  n2: string;
  c: number;
  vPrev: number;
  iPrev: number;
}

interface IndState {
  comp: SpiceComponent;
  n1: string;
  n2: string;
  l: number;
  vPrev: number;
  iPrev: number;
}

export class SpiceEmtParticipant implements EmtNetworkParticipant {
  public readonly id: string;
  public readonly language = "spice";

  private readonly circuit: SpiceCircuit;
  private flatComps: SpiceComponent[] = [];
  private indexing!: MnaIndexing;
  private resistors: Array<{ n1: string; n2: string; g: number }> = [];
  private caps: CapState[] = [];
  private inds: IndState[] = [];
  private timeArr: number[] = [];
  private busTraj = new Map<string, { a: number[]; b: number[]; c: number[] }>();

  constructor(circuit: SpiceCircuit, options?: { id?: string }) {
    this.circuit = circuit;
    this.id = options?.id ?? (circuit.title || "SPICE_EMT_Plant");
  }

  private phaseNodeNames(busId: string): [string, string, string] {
    // Support both explicit 3-phase nodes (`BUS_A`, `BUS_B`, `BUS_C`) and single-phase fallback (`BUS`)
    const upperA = `${busId}_A`;
    const upperB = `${busId}_B`;
    const upperC = `${busId}_C`;
    if (this.indexing.nodeToIdx.has(upperA)) {
      return [upperA, upperB, upperC];
    }
    return [busId, busId, busId];
  }

  public initialize(options: Parameters<EmtNetworkParticipant["initialize"]>[0]): void {
    this.flatComps = flattenSpiceCircuit(this.circuit);
    // Ensure boundary nodes exist in MNA indexing
    const syntheticComps: SpiceComponent[] = [...this.flatComps];
    for (const b of options.boundaryBusIds) {
      syntheticComps.push({
        name: `__boundary_guard_${b}`,
        kind: "R",
        nodes: [b, "0"],
        value: 1e9,
        params: new Map(),
      });
    }
    this.indexing = buildMnaIndexing(syntheticComps);
    this.resistors = [];
    this.caps = [];
    this.inds = [];
    this.timeArr = [];
    this.busTraj.clear();

    for (const b of options.boundaryBusIds) {
      this.busTraj.set(b, { a: [], b: [], c: [] });
    }

    for (const comp of this.flatComps) {
      const n1 = comp.nodes[0] ?? "0";
      const n2 = comp.nodes[1] ?? "0";
      const val = comp.value ?? 0;
      if (comp.kind === "R" && val > 1e-12) {
        this.resistors.push({ n1, n2, g: 1.0 / val });
      } else if (comp.kind === "C" && val > 1e-15) {
        this.caps.push({ comp, n1, n2, c: val, vPrev: 0, iPrev: 0 });
      } else if (comp.kind === "L" && val > 1e-15) {
        this.inds.push({ comp, n1, n2, l: val, vPrev: 0, iPrev: 0 });
      }
    }
  }

  private getNodeV(sol: Float64Array, nodeName: string): number {
    const idx = this.indexing.nodeToIdx.get(nodeName);
    return idx !== undefined ? (sol[idx] ?? 0.0) : 0.0;
  }

  public stepSubSteps(
    tStartSec: number,
    dtEmtSec: number,
    nSubSteps: number,
    feeds: EmtBoundaryFeedSpec[],
  ): EmtSubStepResult {
    const dim = this.indexing.totalSize;
    const boundaryCurrents = new Map<string, { ia: number[]; ib: number[]; ic: number[] }>();
    const boundaryVoltages = new Map<string, { va: number[]; vb: number[]; vc: number[] }>();
    for (const f of feeds) {
      boundaryCurrents.set(f.busId, { ia: [], ib: [], ic: [] });
      boundaryVoltages.set(f.busId, { va: [], vb: [], vc: [] });
    }

    for (let s = 0; s < nSubSteps; s++) {
      const t = tStartSec + (s + 1) * dtEmtSec;
      const mat = new DenseMatrix(dim);
      const rhs = new Float64Array(dim);

      // 1. Resistors
      for (const r of this.resistors) {
        stampConductance(mat, this.indexing, r.n1, r.n2, r.g);
      }

      // 2. Capacitors (trapezoidal companion: gC = 2C/dt, iEq = gC*vPrev + iPrev)
      for (const cap of this.caps) {
        const gC = (2.0 * cap.c) / dtEmtSec;
        const iEq = gC * cap.vPrev + cap.iPrev;
        stampConductance(mat, this.indexing, cap.n1, cap.n2, gC);
        stampCurrentSource(rhs, this.indexing, cap.n2, cap.n1, iEq);
      }

      // 3. Inductors (trapezoidal companion: gL = dt/(2L), iEq = iPrev + gL*vPrev)
      for (const ind of this.inds) {
        const gL = dtEmtSec / (2.0 * ind.l);
        const iEq = ind.iPrev + gL * ind.vPrev;
        stampConductance(mat, this.indexing, ind.n1, ind.n2, gL);
        stampCurrentSource(rhs, this.indexing, ind.n1, ind.n2, iEq);
      }

      // 4. Co-simulation boundary feeds
      const evalFeeds = feeds.map((f) => ({ feed: f, th: f.evaluateThevenin(t) }));
      for (const { feed, th } of evalFeeds) {
        const [nA, nB, nC] = this.phaseNodeNames(feed.busId);
        if (nA === nB) {
          // Single-phase SPICE circuit coupled on phase A
          stampConductance(mat, this.indexing, nA, "0", th.gSrc);
          stampCurrentSource(rhs, this.indexing, "0", nA, th.gSrc * th.ea + (th.iHistA ?? 0));
        } else {
          const nodes = [nA, nB, nC];
          const eVec = [th.ea, th.eb, th.ec];
          const iHist = [th.iHistA ?? 0, th.iHistB ?? 0, th.iHistC ?? 0];
          const gm = th.gMatrix3x3;
          for (let p = 0; p < 3; p++) {
            const node = nodes[p];
            if (!node) continue;
            const gDiag = gm && gm.length >= 9 ? (gm[p * 3 + p] ?? th.gSrc) : th.gSrc;
            stampConductance(mat, this.indexing, node, "0", gDiag);
            stampCurrentSource(rhs, this.indexing, "0", node, gDiag * (eVec[p] ?? 0) + (iHist[p] ?? 0));
          }
        }
      }

      // Tiny diagonal guard
      for (let i = 0; i < dim; i++) {
        if (Math.abs(mat.get(i, i)) < 1e-12) mat.add(i, i, 1e-9);
      }

      const sol = solveLinearSystem(mat, rhs) ?? new Float64Array(dim);

      // Update reactive element states
      for (const cap of this.caps) {
        const vNow = this.getNodeV(sol, cap.n1) - this.getNodeV(sol, cap.n2);
        const gC = (2.0 * cap.c) / dtEmtSec;
        cap.iPrev = gC * (vNow - cap.vPrev) - cap.iPrev;
        cap.vPrev = vNow;
      }
      for (const ind of this.inds) {
        const vNow = this.getNodeV(sol, ind.n1) - this.getNodeV(sol, ind.n2);
        const gL = dtEmtSec / (2.0 * ind.l);
        ind.iPrev = ind.iPrev + gL * (vNow + ind.vPrev);
        ind.vPrev = vNow;
      }

      this.timeArr.push(t);
      for (const { feed, th } of evalFeeds) {
        const [nA, nB, nC] = this.phaseNodeNames(feed.busId);
        const va = this.getNodeV(sol, nA);
        const vb = nB === nA ? th.eb * (va / (Math.abs(th.ea) > 1e-6 ? th.ea : 1.0)) : this.getNodeV(sol, nB);
        const vc = nC === nA ? th.ec * (va / (Math.abs(th.ea) > 1e-6 ? th.ea : 1.0)) : this.getNodeV(sol, nC);
        const ia = th.gSrc * (va - th.ea) - (th.iHistA ?? 0);
        const ib = nB === nA ? 0 : th.gSrc * (vb - th.eb) - (th.iHistB ?? 0);
        const ic = nC === nA ? 0 : th.gSrc * (vc - th.ec) - (th.iHistC ?? 0);
        const bc = boundaryCurrents.get(feed.busId);
        if (bc) {
          bc.ia.push(ia);
          bc.ib.push(ib);
          bc.ic.push(ic);
        }
        const bv = boundaryVoltages.get(feed.busId);
        if (bv) {
          bv.va.push(va);
          bv.vb.push(vb);
          bv.vc.push(vc);
        }
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
    return {
      caps: this.caps.map((c) => ({ vPrev: c.vPrev, iPrev: c.iPrev })),
      inds: this.inds.map((l) => ({ vPrev: l.vPrev, iPrev: l.iPrev })),
      timeLen: this.timeArr.length,
    };
  }

  public setState(snapshot: unknown): void {
    const s = snapshot as {
      caps: Array<{ vPrev: number; iPrev: number }>;
      inds: Array<{ vPrev: number; iPrev: number }>;
      timeLen: number;
    };
    for (let i = 0; i < this.caps.length && i < s.caps.length; i++) {
      const cap = this.caps[i];
      const sc = s.caps[i];
      if (cap && sc) {
        cap.vPrev = sc.vPrev;
        cap.iPrev = sc.iPrev;
      }
    }
    for (let i = 0; i < this.inds.length && i < s.inds.length; i++) {
      const ind = this.inds[i];
      const si = s.inds[i];
      if (ind && si) {
        ind.vPrev = si.vPrev;
        ind.iPrev = si.iPrev;
      }
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
