// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Step-Wise `PhasorNetworkParticipant` Implementation (`PssePhasorParticipant`)
 *
 * Exposes PSS/E positive-sequence and 3-sequence (pos/neg/zero) electro-mechanical
 * transient stability simulation as an incremental, lock-stepped `PhasorNetworkParticipant`
 * with state rollback (`getState`/`setState`), dynamic multi-port Kron-reduced Thévenin
 * boundary equivalents (`Y_eq`), and coordinated t=0 steady-state power-flow initialization.
 */

import type {
  ComplexPhasor,
  FmiLsRmsCompanionInstance,
  MultiPortBoundaryEquivalent,
  PhasorBoundaryBusVoltage,
  PhasorBoundaryInjection,
  PhasorInitResult,
  PhasorMacroStepResult,
  PhasorNetworkParticipant,
  PhasorTrajectoryResult,
} from "@modelscript/exchange";
import { solveLinearSystemSparse } from "@modelscript/runtime";
import { extractPowerFlowNetlist, type PowerFlowNetlist } from "../netlist/powerflow-netlist.js";
import { computeMultiPortThevenin, scanExternalNetworkAdmittance } from "../netlist/ward-equivalencer.js";
import type { PsseCase, PsseDyrCase, PsseSeqCase } from "../types.js";
import { solvePowerFlow } from "./ac-powerflow.js";

interface DynamicGenState {
  busIdx: number;
  busNumber: number;
  id: string;
  hSec: number;
  damping: number;
  xdPrimePu: number; // on system MVA base
  ePrimeMag: number;
  deltaRad: number;
  omegaPu: number;
  pmPu: number;
  // Optional closed-loop Exciter (SEXS/EXST1/IEEEX1/ESST4B)
  hasExciter: boolean;
  vRefPu: number;
  ka: number;
  taSec: number;
  td0pSec: number;
  efdPu: number;
  efdMin: number;
  efdMax: number;
  // Optional closed-loop Governor (TGOV1/HYGOV/IEESGO/GGOV1)
  hasGovernor: boolean;
  pRefPu: number;
  droopR: number;
  tGovSec: number;
  pMinPu: number;
  pMaxPu: number;
}

interface DynamicIbrState {
  busIdx: number;
  busNumber: number;
  id: string;
  pRefPu: number;
  qRefPu: number;
  vRefPu: number;
  kQv: number; // LVRT reactive current support gain
  iMaxPu: number;
  ipPu: number;
  iqPu: number;
}

export interface PssePhasorSnapshot {
  tSec: number;
  topologyVersion: number;
  faultWasActive: boolean;
  genDeltas: Float64Array;
  genOmegas: Float64Array;
  genEPrimes: Float64Array;
  genEfds: Float64Array;
  genPms: Float64Array;
  ibrIps: Float64Array;
  ibrIqs: Float64Array;
  companionSnaps?: unknown[] | undefined;
  vPosRe: Float64Array;
  vPosIm: Float64Array;
  vNegRe: Float64Array;
  vNegIm: Float64Array;
  vZeroRe: Float64Array;
  vZeroIm: Float64Array;
  trajLen: number;
}

export class PssePhasorParticipant implements PhasorNetworkParticipant {
  public readonly id: string;
  public readonly language = "psse";

  private readonly psseCase: PsseCase;
  private readonly dyrCase?: PsseDyrCase | undefined;
  private readonly seqCase?: PsseSeqCase | undefined;
  private readonly nortonCompanions: FmiLsRmsCompanionInstance[];

  private netlist!: PowerFlowNetlist;
  private sbaseMva = 100.0;
  private f0 = 60.0;
  private omega0 = 2.0 * Math.PI * 60.0;
  private sequences: 1 | 3 = 1;
  private boundaryBusNumbers: number[] = [];
  private convergedPowerFlow = false;

  private fault?:
    | {
        busNumber: number;
        busIdx: number;
        startSec: number;
        clearSec: number;
        susceptancePu: number;
        faultType: "3ph" | "slg" | "ll" | "llg";
      }
    | undefined;

  private gens: DynamicGenState[] = [];
  private ibrs: DynamicIbrState[] = [];
  private loadShuntG!: Float64Array;
  private loadShuntB!: Float64Array;
  private vPosRe!: Float64Array;
  private vPosIm!: Float64Array;
  private vNegRe!: Float64Array;
  private vNegIm!: Float64Array;
  private vZeroRe!: Float64Array;
  private vZeroIm!: Float64Array;

  private tSec = 0.0;
  private topologyVersion = 0;
  private faultWasActive = false;

  private trajT: number[] = [];
  private trajY: number[][] = [];
  private stateNames: string[] = [];

  constructor(
    psseCase: PsseCase,
    options?: {
      id?: string;
      dyrCase?: PsseDyrCase | undefined;
      seqCase?: PsseSeqCase | undefined;
      nortonCompanions?: FmiLsRmsCompanionInstance[] | undefined;
    },
  ) {
    this.psseCase = psseCase;
    this.dyrCase = options?.dyrCase;
    this.seqCase = options?.seqCase;
    this.nortonCompanions = options?.nortonCompanions ?? [];
    this.id = options?.id ?? "PSS_E_BulkGrid";
  }

  public initialize(options: {
    durationSec: number;
    dtMacroSec: number;
    boundaryBusIds: string[];
    sequences?: 1 | 3 | undefined;
    fault?:
      | {
          busId: string;
          startSec: number;
          clearSec: number;
          susceptancePu?: number | undefined;
          faultType?: "3ph" | "slg" | "ll" | "llg" | undefined;
        }
      | undefined;
  }): PhasorInitResult {
    this.f0 = this.psseCase.header.basfrq > 0 ? this.psseCase.header.basfrq : 60.0;
    this.omega0 = 2.0 * Math.PI * this.f0;
    this.sbaseMva = this.psseCase.header.sbase > 0 ? this.psseCase.header.sbase : 100.0;
    this.sequences = options.sequences ?? 1;
    this.boundaryBusNumbers = options.boundaryBusIds.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n));

    const pf = solvePowerFlow(this.psseCase);
    this.convergedPowerFlow = pf.converged;
    this.netlist = extractPowerFlowNetlist(this.psseCase);
    const N = this.netlist.nBuses;

    this.vPosRe = new Float64Array(N);
    this.vPosIm = new Float64Array(N);
    this.vNegRe = new Float64Array(N);
    this.vNegIm = new Float64Array(N);
    this.vZeroRe = new Float64Array(N);
    this.vZeroIm = new Float64Array(N);
    this.loadShuntG = new Float64Array(N);
    this.loadShuntB = new Float64Array(N);

    const pfBusMap = new Map<number, (typeof pf.buses)[number]>();
    for (const b of pf.buses) pfBusMap.set(b.busNumber, b);

    for (let i = 0; i < N; i++) {
      const bNum = this.netlist.busNumbers[i]!;
      const pfB = pfBusMap.get(bNum);
      const vm = pfB ? pfB.vm : (this.netlist.vMagPu[i] ?? 1.0);
      const vaRad = pfB ? (pfB.va * Math.PI) / 180.0 : (this.netlist.vAngRad[i] ?? 0.0);
      this.vPosRe[i] = vm * Math.cos(vaRad);
      this.vPosIm[i] = vm * Math.sin(vaRad);

      // Convert steady-state loads to constant-impedance shunts Y_L = (P - j Q) / |V|^2
      if (pfB && vm > 0.1) {
        const v2 = vm * vm;
        const plPu = pfB.plMw / this.sbaseMva;
        const qlPu = pfB.qlMvar / this.sbaseMva;
        this.loadShuntG[i] = plPu / v2;
        this.loadShuntB[i] = -qlPu / v2;
      }
    }

    // Build generator & IBR dynamic states from power flow + optional DYR parameters
    this.gens = [];
    this.ibrs = [];
    this.stateNames = [];
    const dyrHMap = new Map<string, { h: number; d: number; xdPrime: number; td0p: number }>();
    const dyrExcMap = new Map<string, { ka: number; ta: number; efdMin: number; efdMax: number }>();
    const dyrGovMap = new Map<string, { r: number; t1: number; pMin: number; pMax: number }>();
    const dyrIbrKeys = new Set<string>();

    if (this.dyrCase) {
      for (const rec of this.dyrCase.records) {
        const model = rec.model.toUpperCase();
        const key = `${rec.ibus}:${(rec.id ?? "1").trim() || "1"}`;
        if (model === "GENCLS" || model === "GENROU" || model === "GENSAL") {
          if (model === "GENCLS") {
            dyrHMap.set(key, {
              h: rec.con[0] && rec.con[0] > 0 ? rec.con[0] : 4.0,
              d: rec.con[1] ?? 2.0,
              xdPrime: 0.25,
              td0p: 6.0,
            });
          } else {
            dyrHMap.set(key, {
              h: rec.con[4] && rec.con[4] > 0 ? rec.con[4] : 4.0,
              d: rec.con[5] ?? 2.0,
              xdPrime: rec.con[8] && rec.con[8] > 0 ? rec.con[8] : 0.25,
              td0p: rec.con[0] && rec.con[0] > 0.1 ? rec.con[0] : 6.0,
            });
          }
        } else if (model.startsWith("EX") || model === "SEXS" || model === "IEEEX1" || model === "ESST4B") {
          dyrExcMap.set(key, {
            ka: Math.max(5.0, rec.con[2] ?? rec.con[1] ?? 50.0),
            ta: Math.max(0.01, rec.con[3] ?? rec.con[2] ?? 0.05),
            efdMin: rec.con[4] !== undefined && rec.con[4] < 0 ? rec.con[4] : -3.0,
            efdMax: rec.con[5] !== undefined && rec.con[5] > 0 ? rec.con[5] : 5.0,
          });
        } else if (model.startsWith("TGOV") || model === "HYGOV" || model === "IEESGO" || model === "GGOV1") {
          dyrGovMap.set(key, {
            r: Math.max(0.01, rec.con[0] ?? 0.05),
            t1: Math.max(0.05, rec.con[1] ?? 0.5),
            pMax: rec.con[2] && rec.con[2] > 0 ? rec.con[2] : 1.2,
            pMin: rec.con[3] ?? 0.0,
          });
        } else if (model.startsWith("REGC") || model.startsWith("REEC") || model.startsWith("REPC")) {
          dyrIbrKeys.add(key);
        }
      }
    }

    for (const gen of this.psseCase.generators) {
      if (gen.stat === 0) continue;
      const bIdx = this.netlist.busIndices.get(gen.i);
      if (bIdx === undefined) continue;
      const pfB = pfBusMap.get(gen.i);
      const vr = this.vPosRe[bIdx]!;
      const vi = this.vPosIm[bIdx]!;
      const vm = Math.hypot(vr, vi);
      const v2 = Math.max(0.01, vr * vr + vi * vi);

      const mbase = gen.mbase > 0 ? gen.mbase : this.sbaseMva;
      const genIdTrim = (gen.id ?? "1").trim() || "1";
      const dyrKey = `${gen.i}:${genIdTrim}`;

      // Generator steady-state P, Q from solved PF (split across multiple gens on same bus)
      const gensOnBus = this.psseCase.generators.filter((g) => g.stat !== 0 && g.i === gen.i).length || 1;
      const pgPu = (pfB ? pfB.pgMw / gensOnBus : gen.pg) / this.sbaseMva;
      const qgPu = (pfB ? pfB.qgMvar / gensOnBus : gen.qg) / this.sbaseMva;

      if (dyrIbrKeys.has(dyrKey)) {
        const ip0 = pgPu / Math.max(0.1, vm);
        const iq0 = -qgPu / Math.max(0.1, vm);
        this.ibrs.push({
          busIdx: bIdx,
          busNumber: gen.i,
          id: genIdTrim,
          pRefPu: pgPu,
          qRefPu: qgPu,
          vRefPu: vm,
          kQv: 2.0,
          iMaxPu: (1.2 * mbase) / this.sbaseMva,
          ipPu: ip0,
          iqPu: iq0,
        });
        continue;
      }

      const dyrP = dyrHMap.get(dyrKey);
      const excP = dyrExcMap.get(dyrKey);
      const govP = dyrGovMap.get(dyrKey);
      const xdPrimeOnSys = ((dyrP?.xdPrime ?? (gen.zx > 0 ? gen.zx : 0.2)) * this.sbaseMva) / mbase;
      const hSec = (dyrP?.h ?? 4.0) * (mbase / this.sbaseMva);
      const damping = dyrP?.d ?? 2.0;

      // I_g = (P - j Q) / V* = ((P*Vr + Q*Vi) + j(P*Vi - Q*Vr)) / |V|^2
      const igRe = (pgPu * vr + qgPu * vi) / v2;
      const igIm = (pgPu * vi - qgPu * vr) / v2;

      // E' = V + j * Xd' * I_g = (Vr - Xd' * IgIm) + j * (Vi + Xd' * IgRe)
      const epRe = vr - xdPrimeOnSys * igIm;
      const epIm = vi + xdPrimeOnSys * igRe;
      const ePrimeMag = Math.hypot(epRe, epIm);
      const deltaRad = Math.atan2(epIm, epRe);

      this.gens.push({
        busIdx: bIdx,
        busNumber: gen.i,
        id: genIdTrim,
        hSec: Math.max(0.5, hSec),
        damping,
        xdPrimePu: Math.max(0.02, xdPrimeOnSys),
        ePrimeMag,
        deltaRad,
        omegaPu: 1.0,
        pmPu: pgPu,
        hasExciter: Boolean(excP),
        vRefPu: vm,
        ka: excP?.ka ?? 50.0,
        taSec: excP?.ta ?? 0.05,
        td0pSec: dyrP?.td0p ?? 6.0,
        efdPu: ePrimeMag,
        efdMin: excP?.efdMin ?? -3.0,
        efdMax: excP?.efdMax ?? 5.0,
        hasGovernor: Boolean(govP),
        pRefPu: pgPu,
        droopR: govP?.r ?? 0.05,
        tGovSec: govP?.t1 ?? 0.5,
        pMinPu: govP ? govP.pMin * (mbase / this.sbaseMva) : 0.0,
        pMaxPu: govP ? govP.pMax * (mbase / this.sbaseMva) : Math.max(pgPu * 1.2, mbase / this.sbaseMva),
      });
      this.stateNames.push(`gen_${gen.i}_${genIdTrim}_delta_deg`, `gen_${gen.i}_${genIdTrim}_omega_pu`);
    }

    if (options.fault) {
      const fBusNum = parseInt(options.fault.busId, 10);
      const fBusIdx = this.netlist.busIndices.get(fBusNum);
      if (fBusIdx !== undefined) {
        this.fault = {
          busNumber: fBusNum,
          busIdx: fBusIdx,
          startSec: options.fault.startSec,
          clearSec: options.fault.clearSec,
          susceptancePu: options.fault.susceptancePu ?? -20.0,
          faultType: options.fault.faultType ?? "3ph",
        };
      }
    } else {
      this.fault = undefined;
    }

    this.tSec = 0.0;
    this.topologyVersion = 0;
    this.faultWasActive = false;
    this.trajT = [0.0];
    this.trajY = [this.recordStateRow()];

    return {
      boundaryVoltages: this.collectBoundaryVoltages(),
      boundaryEquivalent: this.computeBoundaryEquivalent(options.boundaryBusIds),
      frequencyHz: this.f0,
      baseMva: this.sbaseMva,
      convergedPowerFlow: this.convergedPowerFlow,
    };
  }

  private isFaultActive(tSec: number): boolean {
    if (!this.fault) return false;
    return tSec >= this.fault.startSec - 1e-12 && tSec < this.fault.clearSec - 1e-12;
  }

  private getActiveFaultShunts(tSec: number): Map<number, { g: number; b: number }> | undefined {
    if (!this.fault || !this.isFaultActive(tSec)) return undefined;
    const m = new Map<number, { g: number; b: number }>();
    // Positive-sequence equivalent shunt depends on fault type
    const bFault = this.fault.susceptancePu;
    const scalePos =
      this.fault.faultType === "3ph"
        ? 1.0
        : this.fault.faultType === "llg"
          ? 0.75
          : this.fault.faultType === "ll"
            ? 0.5
            : 0.35; // slg
    m.set(this.fault.busNumber, { g: 0.0, b: bFault * scalePos });
    return m;
  }

  private solveSequenceNetwork(
    seqScale: number,
    extraShuntB: Map<number, number> | undefined,
    rhsRe: Float64Array,
    rhsIm: Float64Array,
    outRe: Float64Array,
    outIm: Float64Array,
  ): void {
    const N = this.netlist.nBuses;
    const dim = 2 * N;
    const mat = new Float64Array(dim * dim);
    const rhs = new Float64Array(dim);

    for (let i = 0; i < N; i++) {
      const gRow = this.netlist.ybus.g.get(i);
      const bRow = this.netlist.ybus.b.get(i);
      if (gRow) {
        for (const [j, gVal] of gRow) {
          const g = gVal * seqScale;
          mat[2 * i * dim + 2 * j] = mat[2 * i * dim + 2 * j]! + g;
          mat[(2 * i + 1) * dim + (2 * j + 1)] = mat[(2 * i + 1) * dim + (2 * j + 1)]! + g;
        }
      }
      if (bRow) {
        for (const [j, bVal] of bRow) {
          const b = bVal * seqScale;
          mat[2 * i * dim + (2 * j + 1)] = mat[2 * i * dim + (2 * j + 1)]! - b;
          mat[(2 * i + 1) * dim + 2 * j] = mat[(2 * i + 1) * dim + 2 * j]! + b;
        }
      }

      // Add load constant-impedance shunt on diagonal
      const gL = this.loadShuntG[i]! * seqScale;
      const bL = this.loadShuntB[i]! * seqScale + (extraShuntB?.get(i) ?? 0.0);
      mat[2 * i * dim + 2 * i] = mat[2 * i * dim + 2 * i]! + gL;
      mat[2 * i * dim + (2 * i + 1)] = mat[2 * i * dim + (2 * i + 1)]! - bL;
      mat[(2 * i + 1) * dim + 2 * i] = mat[(2 * i + 1) * dim + 2 * i]! + bL;
      mat[(2 * i + 1) * dim + (2 * i + 1)] = mat[(2 * i + 1) * dim + (2 * i + 1)]! + gL;

      rhs[2 * i] = rhsRe[i]!;
      rhs[2 * i + 1] = rhsIm[i]!;
    }

    // Add generator Norton admittance 1 / (j * Xd') = -j / Xd' on diagonal
    for (const gen of this.gens) {
      const bGen = (-1.0 / gen.xdPrimePu) * seqScale;
      const i = gen.busIdx;
      mat[2 * i * dim + (2 * i + 1)] = mat[2 * i * dim + (2 * i + 1)]! - bGen;
      mat[(2 * i + 1) * dim + 2 * i] = mat[(2 * i + 1) * dim + 2 * i]! + bGen;
    }

    // Tiny diagonal guard for isolated buses
    for (let i = 0; i < N; i++) {
      if (Math.abs(mat[2 * i * dim + 2 * i]!) < 1e-12 && Math.abs(mat[(2 * i + 1) * dim + 2 * i]!) < 1e-12) {
        mat[2 * i * dim + 2 * i] = 1e-6;
        mat[(2 * i + 1) * dim + (2 * i + 1)] = 1e-6;
      }
    }

    if (solveLinearSystemSparse(mat, rhs, dim, { sparseThreshold: 30 })) {
      for (let i = 0; i < N; i++) {
        outRe[i] = rhs[2 * i]!;
        outIm[i] = rhs[2 * i + 1]!;
      }
    }
  }

  private solveAllNetworks(tSec: number, injections: PhasorBoundaryInjection[], deltas: Float64Array): void {
    const N = this.netlist.nBuses;
    const rhsPosRe = new Float64Array(N);
    const rhsPosIm = new Float64Array(N);
    const rhsNegRe = new Float64Array(N);
    const rhsNegIm = new Float64Array(N);
    const rhsZeroRe = new Float64Array(N);
    const rhsZeroIm = new Float64Array(N);

    // Generator Norton current injections: I_norton = E' / (j * Xd') = (E'_im - j E'_re) / Xd'
    for (let g = 0; g < this.gens.length; g++) {
      const gen = this.gens[g]!;
      const d = deltas[g]!;
      const epRe = gen.ePrimeMag * Math.cos(d);
      const epIm = gen.ePrimeMag * Math.sin(d);
      const invX = 1.0 / gen.xdPrimePu;
      rhsPosRe[gen.busIdx] = rhsPosRe[gen.busIdx]! + epIm * invX;
      rhsPosIm[gen.busIdx] = rhsPosIm[gen.busIdx]! - epRe * invX;
    }

    // IBR (REGC_A/REEC_A/REPC_A) current injections rotated to network frame
    for (const ibr of this.ibrs) {
      const vr = this.vPosRe[ibr.busIdx]!;
      const vi = this.vPosIm[ibr.busIdx]!;
      const theta = Math.atan2(vi, vr);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      // I = (Ip + j Iq) * e^(j theta)
      rhsPosRe[ibr.busIdx] = rhsPosRe[ibr.busIdx]! + (ibr.ipPu * cosT - ibr.iqPu * sinT);
      rhsPosIm[ibr.busIdx] = rhsPosIm[ibr.busIdx]! + (ibr.ipPu * sinT + ibr.iqPu * cosT);
    }

    // Simultaneous `fmi-ls-rms` Norton companions
    const extraPosB = new Map<number, number>();
    const extraPosG = new Map<number, number>();
    for (const comp of this.nortonCompanions) {
      const bIdx = this.netlist.busIndices.get(comp.busNumber);
      if (bIdx === undefined) continue;
      const st = comp.stampNorton(tSec, 0.005);
      rhsPosRe[bIdx] = rhsPosRe[bIdx]! + st.irHist;
      rhsPosIm[bIdx] = rhsPosIm[bIdx]! + st.iiHist;
      if (st.gEq !== 0) extraPosG.set(bIdx, (extraPosG.get(bIdx) ?? 0) + st.gEq);
      if (st.bEq !== 0) extraPosB.set(bIdx, (extraPosB.get(bIdx) ?? 0) + st.bEq);
    }

    // External boundary current injections from EMT plants
    for (const inj of injections) {
      const bNum = parseInt(inj.busId, 10);
      const bIdx = this.netlist.busIndices.get(bNum);
      if (bIdx === undefined) continue;
      rhsPosRe[bIdx] = rhsPosRe[bIdx]! + inj.currentPu.pos.re;
      rhsPosIm[bIdx] = rhsPosIm[bIdx]! + inj.currentPu.pos.im;
      if (this.sequences === 3) {
        if (inj.currentPu.neg) {
          rhsNegRe[bIdx] = rhsNegRe[bIdx]! + inj.currentPu.neg.re;
          rhsNegIm[bIdx] = rhsNegIm[bIdx]! + inj.currentPu.neg.im;
        }
        if (inj.currentPu.zero) {
          rhsZeroRe[bIdx] = rhsZeroRe[bIdx]! + inj.currentPu.zero.re;
          rhsZeroIm[bIdx] = rhsZeroIm[bIdx]! + inj.currentPu.zero.im;
        }
      }
    }

    const faultActive = this.isFaultActive(tSec);
    if (faultActive && this.fault) {
      const scalePos =
        this.fault.faultType === "3ph"
          ? 1.0
          : this.fault.faultType === "llg"
            ? 0.75
            : this.fault.faultType === "ll"
              ? 0.5
              : 0.35;
      extraPosB.set(this.fault.busIdx, (extraPosB.get(this.fault.busIdx) ?? 0) + this.fault.susceptancePu * scalePos);
    }

    // Apply extraPosG into loadShuntG temporarily if nortonCompanions added conductance
    if (extraPosG.size > 0) {
      for (const [bi, gAdd] of extraPosG) this.loadShuntG[bi] = this.loadShuntG[bi]! + gAdd;
    }
    this.solveSequenceNetwork(1.0, extraPosB, rhsPosRe, rhsPosIm, this.vPosRe, this.vPosIm);
    if (extraPosG.size > 0) {
      for (const [bi, gAdd] of extraPosG) this.loadShuntG[bi] = this.loadShuntG[bi]! - gAdd;
    }

    if (this.sequences === 3) {
      // If unbalanced fault is active at fault.busIdx, inject negative/zero sequence fault currents
      if (faultActive && this.fault && this.fault.faultType !== "3ph") {
        const fi = this.fault.busIdx;
        const v1Re = this.vPosRe[fi]!;
        const v1Im = this.vPosIm[fi]!;
        const yF = Math.abs(this.fault.susceptancePu);
        // Inductive fault current I_f1 ≈ -j * yF * V_1 = (yF * V1_im) - j (yF * V1_re)
        const ifRe = 0.35 * yF * v1Im;
        const ifIm = -0.35 * yF * v1Re;
        if (this.fault.faultType === "slg") {
          // I_2 = I_0 = I_1 (injected into neg & zero sequence networks)
          rhsNegRe[fi] = rhsNegRe[fi]! - ifRe;
          rhsNegIm[fi] = rhsNegIm[fi]! - ifIm;
          rhsZeroRe[fi] = rhsZeroRe[fi]! - ifRe;
          rhsZeroIm[fi] = rhsZeroIm[fi]! - ifIm;
        } else if (this.fault.faultType === "ll") {
          // I_2 = -I_1, I_0 = 0
          rhsNegRe[fi] = rhsNegRe[fi]! + ifRe;
          rhsNegIm[fi] = rhsNegIm[fi]! + ifIm;
        } else if (this.fault.faultType === "llg") {
          rhsNegRe[fi] = rhsNegRe[fi]! - 0.5 * ifRe;
          rhsNegIm[fi] = rhsNegIm[fi]! - 0.5 * ifIm;
          rhsZeroRe[fi] = rhsZeroRe[fi]! - 0.5 * ifRe;
          rhsZeroIm[fi] = rhsZeroIm[fi]! - 0.5 * ifIm;
        }
      }
      if (this.seqCase) {
        this.solveExactSeqNetwork("neg", rhsNegRe, rhsNegIm, this.vNegRe, this.vNegIm);
        this.solveExactSeqNetwork("zero", rhsZeroRe, rhsZeroIm, this.vZeroRe, this.vZeroIm);
      } else {
        this.solveSequenceNetwork(1.0, undefined, rhsNegRe, rhsNegIm, this.vNegRe, this.vNegIm);
        this.solveSequenceNetwork(1.0 / 3.0, undefined, rhsZeroRe, rhsZeroIm, this.vZeroRe, this.vZeroIm);
      }
    } else {
      this.vNegRe.fill(0);
      this.vNegIm.fill(0);
      this.vZeroRe.fill(0);
      this.vZeroIm.fill(0);
    }
  }

  /**
   * Builds and solves the exact negative- or zero-sequence nodal network from `this.seqCase`
   * (honoring `.seq` branch R0/X0/B0, transformer connection codes `cc`, generator Z2/Z0/Zg, and shunts).
   */
  private solveExactSeqNetwork(
    kind: "neg" | "zero",
    rhsRe: Float64Array,
    rhsIm: Float64Array,
    outRe: Float64Array,
    outIm: Float64Array,
  ): void {
    const seq = this.seqCase!;
    const N = this.netlist.nBuses;
    const dim = 2 * N;
    const mat = new Float64Array(dim * dim);
    const rhs = new Float64Array(dim);

    const addY = (i: number, j: number, g: number, b: number) => {
      mat[2 * i * dim + 2 * j] = mat[2 * i * dim + 2 * j]! + g;
      mat[2 * i * dim + (2 * j + 1)] = mat[2 * i * dim + (2 * j + 1)]! - b;
      mat[(2 * i + 1) * dim + 2 * j] = mat[(2 * i + 1) * dim + 2 * j]! + b;
      mat[(2 * i + 1) * dim + (2 * j + 1)] = mat[(2 * i + 1) * dim + (2 * j + 1)]! + g;
    };

    const stampSeries = (i: number, j: number, r: number, x: number, bShunt = 0.0) => {
      const denom = r * r + x * x;
      if (denom <= 1e-12) return;
      const g = r / denom;
      const b = -x / denom;
      addY(i, i, g, b + 0.5 * bShunt);
      addY(j, j, g, b + 0.5 * bShunt);
      addY(i, j, -g, -b);
      addY(j, i, -g, -b);
    };

    if (kind === "neg") {
      // Negative-sequence network uses positive-sequence branches/transformers + exact SeqGenerator Z2
      for (let i = 0; i < N; i++) {
        const gRow = this.netlist.ybus.g.get(i);
        const bRow = this.netlist.ybus.b.get(i);
        if (gRow) {
          for (const [j, gVal] of gRow) addY(i, j, gVal, 0);
        }
        if (bRow) {
          for (const [j, bVal] of bRow) addY(i, j, 0, bVal);
        }
      }
      const seqGenMap = new Map<string, (typeof seq.generators)[number]>();
      for (const sg of seq.generators) seqGenMap.set(`${sg.i}:${sg.id.trim()}`, sg);
      for (const gen of this.gens) {
        const sg = seqGenMap.get(`${gen.busNumber}:${gen.id}`);
        const r2 = sg && sg.zrneg >= 0 ? sg.zrneg : 0.0;
        const x2 = sg && sg.zxneg > 0 ? sg.zxneg : gen.xdPrimePu;
        const denom = r2 * r2 + x2 * x2;
        if (denom > 1e-12) addY(gen.busIdx, gen.busIdx, r2 / denom, -x2 / denom);
      }
    } else {
      // Zero-sequence network from `.seq` branches, transformers, generators, and shunts
      const seqBrMap = new Map<string, (typeof seq.branches)[number]>();
      for (const sb of seq.branches) {
        seqBrMap.set(`${sb.i}:${sb.j}:${sb.ckt.trim()}`, sb);
        seqBrMap.set(`${sb.j}:${sb.i}:${sb.ckt.trim()}`, sb);
      }
      for (const br of this.psseCase.branches) {
        if (br.st === 0) continue;
        const i = this.netlist.busIndices.get(br.i);
        const j = this.netlist.busIndices.get(br.j);
        if (i === undefined || j === undefined) continue;
        const sb = seqBrMap.get(`${br.i}:${br.j}:${br.ckt.trim()}`);
        const r0 = sb ? sb.r0 : br.r * 3.0;
        const x0 = sb ? sb.x0 : br.x * 3.0;
        const b0 = sb ? sb.b0 : br.b * 0.6;
        stampSeries(i, j, r0, x0, b0);
        if (sb) {
          if (sb.gi0 !== 0 || sb.bi0 !== 0) addY(i, i, sb.gi0, sb.bi0);
          if (sb.gj0 !== 0 || sb.bj0 !== 0) addY(j, j, sb.gj0, sb.bj0);
        }
      }

      const seqTfMap = new Map<string, (typeof seq.transformers)[number]>();
      for (const st of seq.transformers) {
        seqTfMap.set(`${st.i}:${st.j}:${st.ckt.trim()}`, st);
      }
      for (const tf of this.psseCase.transformers) {
        if (tf.stat === 0) continue;
        const i = this.netlist.busIndices.get(tf.i);
        const j = this.netlist.busIndices.get(tf.j);
        if (i === undefined || j === undefined) continue;
        const st = seqTfMap.get(`${tf.i}:${tf.j}:${tf.ckt.trim()}`);
        const cc = st?.cc ?? 1;
        const r0 = st ? st.r01 + 3.0 * st.rg1 : tf.r12;
        const x0 = st ? st.x01 + 3.0 * st.xg1 : tf.x12;
        const denom = r0 * r0 + x0 * x0;
        if (cc === 1) {
          // Yg-Yg: series pass-through
          stampSeries(i, j, r0, x0, 0);
        } else if (cc === 2 && denom > 1e-12) {
          // Yg-D: shunt to ground on primary bus i, open on delta side j
          addY(i, i, r0 / denom, -x0 / denom);
        } else if (cc === 3 && denom > 1e-12) {
          // D-Yg: shunt to ground on secondary bus j, open on delta side i
          addY(j, j, r0 / denom, -x0 / denom);
        }
        // cc === 4 (D-D) or 5 (Y-Y ungrounded): open in zero sequence
      }

      const seqGenMap = new Map<string, (typeof seq.generators)[number]>();
      for (const sg of seq.generators) seqGenMap.set(`${sg.i}:${sg.id.trim()}`, sg);
      for (const gen of this.gens) {
        const sg = seqGenMap.get(`${gen.busNumber}:${gen.id}`);
        const r0 = sg ? sg.zr0 + 3.0 * sg.zrg : 0.0;
        const x0 = sg && sg.zx0 > 0 ? sg.zx0 + 3.0 * sg.zxg : gen.xdPrimePu * 0.5;
        const denom = r0 * r0 + x0 * x0;
        if (denom > 1e-12) addY(gen.busIdx, gen.busIdx, r0 / denom, -x0 / denom);
      }

      for (const sh of seq.shunts) {
        const i = this.netlist.busIndices.get(sh.i);
        if (i !== undefined) addY(i, i, sh.g0, sh.b0);
      }
    }

    for (let i = 0; i < N; i++) {
      rhs[2 * i] = rhsRe[i]!;
      rhs[2 * i + 1] = rhsIm[i]!;
      if (Math.abs(mat[2 * i * dim + 2 * i]!) < 1e-12 && Math.abs(mat[(2 * i + 1) * dim + 2 * i]!) < 1e-12) {
        mat[2 * i * dim + 2 * i] = 1e-6;
        mat[(2 * i + 1) * dim + (2 * i + 1)] = 1e-6;
      }
    }

    if (solveLinearSystemSparse(mat, rhs, dim, { sparseThreshold: 30 })) {
      for (let i = 0; i < N; i++) {
        outRe[i] = rhs[2 * i]!;
        outIm[i] = rhs[2 * i + 1]!;
      }
    }
  }

  private computeSwingDerivatives(
    deltas: Float64Array,
    omegas: Float64Array,
    dDelta: Float64Array,
    dOmega: Float64Array,
  ): void {
    for (let g = 0; g < this.gens.length; g++) {
      const gen = this.gens[g]!;
      const vr = this.vPosRe[gen.busIdx]!;
      const vi = this.vPosIm[gen.busIdx]!;
      const vm = Math.hypot(vr, vi);
      const va = Math.atan2(vi, vr);
      const pePu = (gen.ePrimeMag * vm * Math.sin(deltas[g]! - va)) / gen.xdPrimePu;
      dDelta[g] = this.omega0 * (omegas[g]! - 1.0);
      dOmega[g] = (gen.pmPu - pePu - gen.damping * (omegas[g]! - 1.0)) / (2.0 * gen.hSec);
    }
  }

  public stepMacro(tSec: number, dtSec: number, injections: PhasorBoundaryInjection[]): PhasorMacroStepResult {
    const nG = this.gens.length;
    const d0 = new Float64Array(nG);
    const w0 = new Float64Array(nG);
    for (let g = 0; g < nG; g++) {
      d0[g] = this.gens[g]!.deltaRad;
      w0[g] = this.gens[g]!.omegaPu;
    }

    const k1d = new Float64Array(nG);
    const k1w = new Float64Array(nG);
    const k2d = new Float64Array(nG);
    const k2w = new Float64Array(nG);
    const k3d = new Float64Array(nG);
    const k3w = new Float64Array(nG);
    const k4d = new Float64Array(nG);
    const k4w = new Float64Array(nG);
    const tmpD = new Float64Array(nG);
    const tmpW = new Float64Array(nG);

    // RK4 stage 1
    this.solveAllNetworks(tSec, injections, d0);
    this.computeSwingDerivatives(d0, w0, k1d, k1w);

    // RK4 stage 2
    for (let g = 0; g < nG; g++) {
      tmpD[g] = d0[g]! + 0.5 * dtSec * k1d[g]!;
      tmpW[g] = w0[g]! + 0.5 * dtSec * k1w[g]!;
    }
    this.solveAllNetworks(tSec + 0.5 * dtSec, injections, tmpD);
    this.computeSwingDerivatives(tmpD, tmpW, k2d, k2w);

    // RK4 stage 3
    for (let g = 0; g < nG; g++) {
      tmpD[g] = d0[g]! + 0.5 * dtSec * k2d[g]!;
      tmpW[g] = w0[g]! + 0.5 * dtSec * k2w[g]!;
    }
    this.solveAllNetworks(tSec + 0.5 * dtSec, injections, tmpD);
    this.computeSwingDerivatives(tmpD, tmpW, k3d, k3w);

    // RK4 stage 4
    for (let g = 0; g < nG; g++) {
      tmpD[g] = d0[g]! + dtSec * k3d[g]!;
      tmpW[g] = w0[g]! + dtSec * k3w[g]!;
    }
    const tNext = tSec + dtSec;
    this.solveAllNetworks(tNext, injections, tmpD);
    this.computeSwingDerivatives(tmpD, tmpW, k4d, k4w);

    for (let g = 0; g < nG; g++) {
      this.gens[g]!.deltaRad = d0[g]! + (dtSec / 6.0) * (k1d[g]! + 2.0 * k2d[g]! + 2.0 * k3d[g]! + k4d[g]!);
      this.gens[g]!.omegaPu = w0[g]! + (dtSec / 6.0) * (k1w[g]! + 2.0 * k2w[g]! + 2.0 * k3w[g]! + k4w[g]!);
      tmpD[g] = this.gens[g]!.deltaRad;
    }

    // Final algebraic solve at tNext with updated rotor angles
    this.solveAllNetworks(tNext, injections, tmpD);

    // Advance closed-loop DYR exciters, governors, IBRs, and `fmi-ls-rms` companions
    for (const gen of this.gens) {
      const vm = Math.hypot(this.vPosRe[gen.busIdx]!, this.vPosIm[gen.busIdx]!);
      if (gen.hasExciter) {
        const vErr = gen.vRefPu - vm;
        const efdTarget = Math.max(gen.efdMin, Math.min(gen.efdMax, gen.efdPu + gen.ka * vErr));
        const alphaExc = Math.min(1.0, dtSec / Math.max(1e-3, gen.taSec));
        gen.efdPu = Math.max(gen.efdMin, Math.min(gen.efdMax, gen.efdPu + alphaExc * (efdTarget - gen.efdPu)));
        const alphaField = Math.min(1.0, dtSec / Math.max(0.05, gen.td0pSec));
        gen.ePrimeMag = Math.max(0.2, Math.min(2.5, gen.ePrimeMag + alphaField * (gen.efdPu - gen.ePrimeMag)));
      }
      if (gen.hasGovernor) {
        const dOmega = gen.omegaPu - 1.0;
        const pmTarget = Math.max(gen.pMinPu, Math.min(gen.pMaxPu, gen.pRefPu - dOmega / gen.droopR));
        const alphaGov = Math.min(1.0, dtSec / Math.max(0.01, gen.tGovSec));
        gen.pmPu = Math.max(gen.pMinPu, Math.min(gen.pMaxPu, gen.pmPu + alphaGov * (pmTarget - gen.pmPu)));
      }
    }

    for (const ibr of this.ibrs) {
      const vm = Math.max(0.05, Math.hypot(this.vPosRe[ibr.busIdx]!, this.vPosIm[ibr.busIdx]!));
      const vDip = Math.max(0.0, ibr.vRefPu - 0.1 - vm);
      const iqCmd = -ibr.qRefPu / vm + ibr.kQv * vDip;
      const iqClamped = Math.max(-ibr.iMaxPu, Math.min(ibr.iMaxPu, iqCmd));
      const ipMax = Math.sqrt(Math.max(0.0, ibr.iMaxPu * ibr.iMaxPu - iqClamped * iqClamped));
      const ipCmd = Math.max(-ipMax, Math.min(ipMax, ibr.pRefPu / vm));
      const alphaIbr = Math.min(1.0, dtSec / 0.02);
      ibr.ipPu += alphaIbr * (ipCmd - ibr.ipPu);
      ibr.iqPu += alphaIbr * (iqClamped - ibr.iqPu);
    }

    for (const comp of this.nortonCompanions) {
      const bIdx = this.netlist.busIndices.get(comp.busNumber);
      if (bIdx === undefined) continue;
      comp.doStep(tNext, dtSec, this.vPosRe[bIdx]!, this.vPosIm[bIdx]!);
    }

    this.tSec = tNext;

    const faultNow = this.isFaultActive(tNext);
    const topologyChanged = faultNow !== this.faultWasActive;
    if (topologyChanged) {
      this.faultWasActive = faultNow;
      this.topologyVersion++;
    }

    this.trajT.push(tNext);
    this.trajY.push(this.recordStateRow());

    return {
      timeSec: tNext,
      boundaryVoltages: this.collectBoundaryVoltages(),
      boundaryEquivalent: topologyChanged
        ? this.computeBoundaryEquivalent(this.boundaryBusNumbers.map(String))
        : undefined,
      topologyChanged,
    };
  }

  public computeBoundaryEquivalent(boundaryBusIds: string[]): MultiPortBoundaryEquivalent {
    const busNums = boundaryBusIds.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n));
    return computeMultiPortThevenin(this.psseCase, busNums, {
      topologyVersion: this.topologyVersion,
      extraBusShuntsPu: this.getActiveFaultShunts(this.tSec),
      includeGenSubtransient: true,
    });
  }

  public scanBoundaryAdmittance(
    busId: string,
    freqGridHz: number[],
  ): Array<{ freqHz: number; ySiemens: ComplexPhasor }> {
    const busNum = parseInt(busId, 10);
    if (!Number.isFinite(busNum)) return [];
    return scanExternalNetworkAdmittance(this.psseCase, busNum, freqGridHz, {
      extraBusShuntsPu: this.getActiveFaultShunts(this.tSec),
      includeGenSubtransient: true,
    });
  }

  public getState(): PssePhasorSnapshot {
    const nG = this.gens.length;
    const nI = this.ibrs.length;
    const genDeltas = new Float64Array(nG);
    const genOmegas = new Float64Array(nG);
    const genEPrimes = new Float64Array(nG);
    const genEfds = new Float64Array(nG);
    const genPms = new Float64Array(nG);
    for (let g = 0; g < nG; g++) {
      genDeltas[g] = this.gens[g]!.deltaRad;
      genOmegas[g] = this.gens[g]!.omegaPu;
      genEPrimes[g] = this.gens[g]!.ePrimeMag;
      genEfds[g] = this.gens[g]!.efdPu;
      genPms[g] = this.gens[g]!.pmPu;
    }
    const ibrIps = new Float64Array(nI);
    const ibrIqs = new Float64Array(nI);
    for (let i = 0; i < nI; i++) {
      ibrIps[i] = this.ibrs[i]!.ipPu;
      ibrIqs[i] = this.ibrs[i]!.iqPu;
    }
    const companionSnaps = this.nortonCompanions.map((c) => {
      const stateful = c as unknown as { captureState?: () => unknown };
      return stateful.captureState ? stateful.captureState() : undefined;
    });
    return {
      tSec: this.tSec,
      topologyVersion: this.topologyVersion,
      faultWasActive: this.faultWasActive,
      genDeltas,
      genOmegas,
      genEPrimes,
      genEfds,
      genPms,
      ibrIps,
      ibrIqs,
      companionSnaps,
      vPosRe: new Float64Array(this.vPosRe),
      vPosIm: new Float64Array(this.vPosIm),
      vNegRe: new Float64Array(this.vNegRe),
      vNegIm: new Float64Array(this.vNegIm),
      vZeroRe: new Float64Array(this.vZeroRe),
      vZeroIm: new Float64Array(this.vZeroIm),
      trajLen: this.trajT.length,
    };
  }

  public setState(snapshot: unknown): void {
    const snap = snapshot as PssePhasorSnapshot & { companionSnaps?: unknown[] };
    this.tSec = snap.tSec;
    this.topologyVersion = snap.topologyVersion;
    this.faultWasActive = snap.faultWasActive;
    for (let g = 0; g < this.gens.length; g++) {
      this.gens[g]!.deltaRad = snap.genDeltas[g]!;
      this.gens[g]!.omegaPu = snap.genOmegas[g]!;
      if (snap.genEPrimes) this.gens[g]!.ePrimeMag = snap.genEPrimes[g]!;
      if (snap.genEfds) this.gens[g]!.efdPu = snap.genEfds[g]!;
      if (snap.genPms) this.gens[g]!.pmPu = snap.genPms[g]!;
    }
    for (let i = 0; i < this.ibrs.length && snap.ibrIps; i++) {
      this.ibrs[i]!.ipPu = snap.ibrIps[i]!;
      this.ibrs[i]!.iqPu = snap.ibrIqs[i]!;
    }
    if (snap.companionSnaps) {
      for (let i = 0; i < this.nortonCompanions.length && i < snap.companionSnaps.length; i++) {
        const stateful = this.nortonCompanions[i] as unknown as { restoreState?: (s: unknown) => void };
        if (stateful.restoreState && snap.companionSnaps[i] !== undefined) {
          stateful.restoreState(snap.companionSnaps[i]);
        }
      }
    }
    this.vPosRe.set(snap.vPosRe);
    this.vPosIm.set(snap.vPosIm);
    this.vNegRe.set(snap.vNegRe);
    this.vNegIm.set(snap.vNegIm);
    this.vZeroRe.set(snap.vZeroRe);
    this.vZeroIm.set(snap.vZeroIm);
    this.trajT.length = snap.trajLen;
    this.trajY.length = snap.trajLen;
  }

  public finalize(): PhasorTrajectoryResult {
    let maxSpreadDeg = 0.0;
    for (const row of this.trajY) {
      let minDeg = Infinity;
      let maxDeg = -Infinity;
      for (let g = 0; g < this.gens.length; g++) {
        const deg = row[2 * g]!;
        if (deg < minDeg) minDeg = deg;
        if (deg > maxDeg) maxDeg = deg;
      }
      if (this.gens.length > 1) {
        maxSpreadDeg = Math.max(maxSpreadDeg, maxDeg - minDeg);
      }
    }
    return {
      t: this.trajT,
      states: this.stateNames,
      y: this.trajY,
      summary: {
        convergedPowerFlow: this.convergedPowerFlow,
        stable: maxSpreadDeg < 180.0,
        maxRotorAngleSpreadDeg: Number(maxSpreadDeg.toFixed(2)),
      },
    };
  }

  private recordStateRow(): number[] {
    const row: number[] = [];
    for (const gen of this.gens) {
      row.push((gen.deltaRad * 180.0) / Math.PI, gen.omegaPu);
    }
    return row;
  }

  private computeCoiFrequencyHz(): number {
    if (this.gens.length === 0) return this.f0;
    let sumH = 0.0;
    let sumHOmega = 0.0;
    for (const gen of this.gens) {
      sumH += gen.hSec;
      sumHOmega += gen.hSec * gen.omegaPu;
    }
    return sumH > 1e-9 ? this.f0 * (sumHOmega / sumH) : this.f0;
  }

  private collectBoundaryVoltages(): Map<string, PhasorBoundaryBusVoltage> {
    const out = new Map<string, PhasorBoundaryBusVoltage>();
    const coiFreqHz = this.computeCoiFrequencyHz();
    for (const bNum of this.boundaryBusNumbers) {
      const idx = this.netlist.busIndices.get(bNum);
      if (idx === undefined) continue;
      const v1: ComplexPhasor = { re: this.vPosRe[idx]!, im: this.vPosIm[idx]! };
      const v2: ComplexPhasor = { re: this.vNegRe[idx]!, im: this.vNegIm[idx]! };
      const v0: ComplexPhasor = { re: this.vZeroRe[idx]!, im: this.vZeroIm[idx]! };
      const bus = this.psseCase.buses.get(bNum);
      out.set(String(bNum), {
        busId: String(bNum),
        vmPu: Math.hypot(v1.re, v1.im),
        vaRad: Math.atan2(v1.im, v1.re),
        voltagePu: this.sequences === 3 ? { pos: v1, neg: v2, zero: v0 } : { pos: v1 },
        baseKvLL: bus && bus.baseKv > 0 ? bus.baseKv : 230.0,
        freqHz: coiFreqHz,
      });
    }
    return out;
  }
}
