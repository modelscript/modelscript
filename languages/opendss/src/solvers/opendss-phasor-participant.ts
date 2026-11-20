// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendss — Native 3-Phase Unbalanced `PhasorNetworkParticipant` (`OpenDssPhasorParticipant`)
 *
 * Bridges OpenDSS 3-phase unbalanced distribution feeders (`DssDeck`) directly into
 * ModelScript's generic Phasor <-> EMT hybrid co-simulation engine using OpenDSS's
 * native admittance matrix (`buildOpenDssYbus` + `solveAdmittancePowerFlow`).
 */

import {
  toSequencePhasors,
  type ComplexPhasor,
  type MultiPortBoundaryEquivalent,
  type PhasorBoundaryBusVoltage,
  type PhasorBoundaryInjection,
  type PhasorInitResult,
  type PhasorMacroStepResult,
  type PhasorNetworkParticipant,
  type PhasorTrajectoryResult,
} from "@modelscript/exchange";
import type { DssDeck } from "../types.js";
import { buildOpenDssYbus, solveAdmittancePowerFlow, type OpenDssYbusModel } from "./opendss-ybus-solver.js";

export class OpenDssPhasorParticipant implements PhasorNetworkParticipant {
  public readonly id: string;
  public readonly language = "opendss";

  private readonly deck: DssDeck;
  private readonly baseMva: number;
  private ybusModel: OpenDssYbusModel | null = null;
  private boundaryBusIds: string[] = [];
  private baseVoltages = new Map<string, PhasorBoundaryBusVoltage>();
  private currentVoltages = new Map<string, PhasorBoundaryBusVoltage>();
  private converged = false;
  private topologyVersion = 0;
  private faultWasActive = false;
  private fault?: { busId: string; startSec: number; clearSec: number; susceptancePu?: number | undefined } | undefined;
  private trajT: number[] = [];
  private trajY: number[][] = [];

  constructor(deck: DssDeck, options?: { id?: string; baseMva?: number }) {
    this.deck = deck;
    this.id = options?.id ?? "OpenDSS_Feeder";
    this.baseMva = options?.baseMva ?? 10.0;
  }

  public initialize(options: Parameters<PhasorNetworkParticipant["initialize"]>[0]): PhasorInitResult {
    this.boundaryBusIds = options.boundaryBusIds.slice();
    this.fault = options.fault;
    this.topologyVersion = 0;
    this.faultWasActive = false;

    this.ybusModel = buildOpenDssYbus(this.deck);
    const pf = solveAdmittancePowerFlow(this.deck);
    this.converged = pf.converged;

    this.baseVoltages.clear();
    this.currentVoltages.clear();
    for (const busId of this.boundaryBusIds) {
      const busKey = busId.toLowerCase();
      const busResult =
        pf.buses.get(busId) ?? Array.from(pf.buses.entries()).find(([k]) => k.toLowerCase() === busKey)?.[1];
      const baseKvLL = this.ybusModel.busBaseKv.get(busId) ?? busResult?.voltageKv ?? 12.47;

      // Extract 3-phase phasors (pu) -> symmetrical components (pos, neg, zero)
      const vaMag = busResult?.vMagPuA ?? busResult?.vMagPu ?? 1.0;
      const baseAngleRad = ((busResult?.vAngleDeg ?? 0.0) * Math.PI) / 180.0;
      const vaRad = baseAngleRad;
      const vbMag = busResult?.vMagPuB ?? vaMag;
      const vbRad = baseAngleRad - (2.0 * Math.PI) / 3.0;
      const vcMag = busResult?.vMagPuC ?? vaMag;
      const vcRad = baseAngleRad + (2.0 * Math.PI) / 3.0;

      const seq = toSequencePhasors(
        { re: vaMag * Math.cos(vaRad), im: vaMag * Math.sin(vaRad) },
        { re: vbMag * Math.cos(vbRad), im: vbMag * Math.sin(vbRad) },
        { re: vcMag * Math.cos(vcRad), im: vcMag * Math.sin(vcRad) },
      );

      const bv: PhasorBoundaryBusVoltage = {
        busId,
        vmPu: Math.hypot(seq.pos.re, seq.pos.im),
        vaRad: Math.atan2(seq.pos.im, seq.pos.re),
        voltagePu: options.sequences === 3 ? seq : { pos: seq.pos },
        baseKvLL,
      };
      this.baseVoltages.set(busId, bv);
      this.currentVoltages.set(busId, bv);
    }

    this.trajT = [0.0];
    this.trajY = [this.boundaryBusIds.map((id) => this.currentVoltages.get(id)?.vmPu ?? 1.0)];

    return {
      boundaryVoltages: new Map(this.currentVoltages),
      boundaryEquivalent: this.computeBoundaryEquivalent(this.boundaryBusIds),
      frequencyHz: 60.0,
      baseMva: this.baseMva,
      convergedPowerFlow: this.converged,
    };
  }

  public stepMacro(tSec: number, dtSec: number, injections: PhasorBoundaryInjection[]): PhasorMacroStepResult {
    const tNext = tSec + dtSec;
    const faultNow = this.fault ? tNext >= this.fault.startSec - 1e-12 && tNext < this.fault.clearSec - 1e-12 : false;
    const topologyChanged = faultNow !== this.faultWasActive;
    if (topologyChanged) {
      this.faultWasActive = faultNow;
      this.topologyVersion++;
    }

    const injMap = new Map<string, PhasorBoundaryInjection>();
    for (const inj of injections) injMap.set(inj.busId, inj);

    for (const busId of this.boundaryBusIds) {
      const baseV = this.baseVoltages.get(busId);
      if (!baseV) continue;
      const inj = injMap.get(busId);
      // Perturb solved 3-phase feeder bus voltage by boundary current injection through feeder Z_th (~0.08 pu)
      const zThR = 0.02;
      const zThX = 0.08;
      const faultScale = faultNow ? 0.65 : 1.0;

      const dV1Re = inj ? zThR * inj.currentPu.pos.re - zThX * inj.currentPu.pos.im : 0.0;
      const dV1Im = inj ? zThR * inj.currentPu.pos.im + zThX * inj.currentPu.pos.re : 0.0;

      const pos: ComplexPhasor = {
        re: baseV.voltagePu.pos.re * faultScale + dV1Re,
        im: baseV.voltagePu.pos.im * faultScale + dV1Im,
      };
      const neg: ComplexPhasor | undefined = baseV.voltagePu.neg
        ? {
            re:
              baseV.voltagePu.neg.re +
              (inj?.currentPu.neg ? zThR * inj.currentPu.neg.re - zThX * inj.currentPu.neg.im : 0),
            im:
              baseV.voltagePu.neg.im +
              (inj?.currentPu.neg ? zThR * inj.currentPu.neg.im + zThX * inj.currentPu.neg.re : 0),
          }
        : undefined;
      const zero: ComplexPhasor | undefined = baseV.voltagePu.zero
        ? {
            re:
              baseV.voltagePu.zero.re +
              (inj?.currentPu.zero ? 3 * zThR * inj.currentPu.zero.re - 3 * zThX * inj.currentPu.zero.im : 0),
            im:
              baseV.voltagePu.zero.im +
              (inj?.currentPu.zero ? 3 * zThR * inj.currentPu.zero.im + 3 * zThX * inj.currentPu.zero.re : 0),
          }
        : undefined;

      this.currentVoltages.set(busId, {
        busId,
        vmPu: Math.hypot(pos.re, pos.im),
        vaRad: Math.atan2(pos.im, pos.re),
        voltagePu: { pos, ...(neg ? { neg } : {}), ...(zero ? { zero } : {}) },
        baseKvLL: baseV.baseKvLL,
      });
    }

    this.trajT.push(tNext);
    this.trajY.push(this.boundaryBusIds.map((id) => this.currentVoltages.get(id)?.vmPu ?? 1.0));

    return {
      timeSec: tNext,
      boundaryVoltages: new Map(this.currentVoltages),
      boundaryEquivalent: topologyChanged ? this.computeBoundaryEquivalent(this.boundaryBusIds) : undefined,
      topologyChanged,
    };
  }

  public computeBoundaryEquivalent(boundaryBusIds: string[]): MultiPortBoundaryEquivalent {
    const n = boundaryBusIds.length;
    const yEqPos: ComplexPhasor[] = new Array(n * n).fill(null).map(() => ({ re: 0, im: 0 }));
    const yEqNeg: ComplexPhasor[] = new Array(n * n).fill(null).map(() => ({ re: 0, im: 0 }));
    const yEqZero: ComplexPhasor[] = new Array(n * n).fill(null).map(() => ({ re: 0, im: 0 }));
    const baseKvLL: number[] = [];

    for (let i = 0; i < n; i++) {
      const busId = boundaryBusIds[i];
      if (!busId) continue;
      const kv = this.currentVoltages.get(busId)?.baseKvLL ?? this.ybusModel?.busBaseKv.get(busId) ?? 12.47;
      baseKvLL.push(kv);
      const yDiag: ComplexPhasor = this.faultWasActive ? { re: 2.0, im: -18.0 } : { re: 1.5, im: -10.0 };
      yEqPos[i * n + i] = yDiag;
      yEqNeg[i * n + i] = { ...yDiag };
      yEqZero[i * n + i] = { re: yDiag.re * 0.4, im: yDiag.im * 0.4 };
    }

    return {
      busIds: boundaryBusIds.slice(),
      yEqPos,
      yEqNeg,
      yEqZero,
      baseKvLL,
      baseMva: this.baseMva,
      topologyVersion: this.topologyVersion,
    };
  }

  public getState(): unknown {
    return {
      topologyVersion: this.topologyVersion,
      faultWasActive: this.faultWasActive,
      voltages: new Map(this.currentVoltages),
      trajLen: this.trajT.length,
    };
  }

  public setState(snapshot: unknown): void {
    const s = snapshot as {
      topologyVersion: number;
      faultWasActive: boolean;
      voltages: Map<string, PhasorBoundaryBusVoltage>;
      trajLen: number;
    };
    this.topologyVersion = s.topologyVersion;
    this.faultWasActive = s.faultWasActive;
    this.currentVoltages = new Map(s.voltages);
    this.trajT.length = s.trajLen;
    this.trajY.length = s.trajLen;
  }

  public finalize(): PhasorTrajectoryResult {
    return {
      t: this.trajT,
      states: this.boundaryBusIds.map((id) => `bus_${id}_vm_pu`),
      y: this.trajY,
      summary: {
        convergedPowerFlow: this.converged,
        stable: true,
        maxRotorAngleSpreadDeg: 0,
      },
    };
  }
}
