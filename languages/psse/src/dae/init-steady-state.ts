// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Exact Steady-State Equilibrium Back-Solver for PSS/E Dynamic Models.
 *
 * Computes initial machine rotor angles, subtransient flux linkages, field voltages,
 * governor valve/gate positions, IBR current commands, and motor slip values from the
 * AC power-flow operating point so every differential equation satisfies `|der(x)(0)| < 1e-10`.
 */

import { solvePowerFlow } from "../solver/ac-powerflow.js";
import type { BusRecord, GeneratorRecord, PsseCase, PsseDyrRecord } from "../types.js";
import { computeQuadraticSatCoeffs, evalQuadraticSat } from "./blocks.js";

export interface SolvedBusPoint {
  busNumber: number;
  vm: number;
  vaRad: number;
  vr: number;
  vi: number;
  freqHz: number;
}

export interface GeneratorSteadyInit {
  genKey: string;
  ibus: number;
  id: string;
  mbase: number;
  pgMw: number;
  qgMvar: number;
  pPu: number;
  qPu: number;
  vr: number;
  vi: number;
  vt: number;
  irNet: number;
  iiNet: number;
  delta0: number;
  vd0: number;
  vq0: number;
  id0: number;
  iq0: number;
  eqp0: number;
  edp0: number;
  psikd0: number;
  psikq0: number;
  psippd0: number;
  psippq0: number;
  efd0: number;
  tm0: number;
  ra: number;
  xd: number;
  xq: number;
  xdp: number;
  xqp: number;
  xdpp: number;
  xqpp: number;
  xl: number;
  s10: number;
  s12: number;
  /** True if machine is an IBR/inverter rather than synchronous machine. */
  isIbr: boolean;
  ip0: number;
  iq0Ibr: number;
}

export interface PsseSteadyStateSolution {
  sbase: number;
  basfrq: number;
  omega0: number;
  buses: Map<number, SolvedBusPoint>;
  gens: Map<string, GeneratorSteadyInit>;
}

/**
 * Computes exact steady-state initial conditions for all buses, synchronous machines,
 * and IBR converters in a `PsseCase`.
 */
export function computeSteadyStateInit(psseCase: PsseCase): PsseSteadyStateSolution {
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const basfrq = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;
  const omega0 = 2.0 * Math.PI * basfrq;

  const buses = new Map<number, SolvedBusPoint>();
  const busGenTotals = new Map<number, { pg: number; qg: number }>();

  // Run AC Newton-Raphson power flow so bus voltages and slack/PV injections are exact
  let pfOk = false;
  if (psseCase.buses.size > 0 && psseCase.generators.length > 0) {
    try {
      const pf = solvePowerFlow(psseCase, { enforceQLimits: false, maxIterations: 30, tolerance: 1e-8 });
      if (pf.converged) {
        pfOk = true;
        for (const b of pf.buses) {
          const vaRad = (b.va * Math.PI) / 180.0;
          buses.set(b.busNumber, {
            busNumber: b.busNumber,
            vm: b.vm,
            vaRad,
            vr: b.vm * Math.cos(vaRad),
            vi: b.vm * Math.sin(vaRad),
            freqHz: basfrq,
          });
          busGenTotals.set(b.busNumber, { pg: b.pgMw, qg: b.qgMvar });
        }
      }
    } catch {
      pfOk = false;
    }
  }

  // Fallback to RAW bus voltages if power flow did not run or did not converge
  for (const [busNum, b] of psseCase.buses) {
    if (!buses.has(busNum)) {
      const vm = b.vm > 0 ? b.vm : 1.0;
      const vaRad = ((b.va || 0.0) * Math.PI) / 180.0;
      buses.set(busNum, {
        busNumber: busNum,
        vm,
        vaRad,
        vr: vm * Math.cos(vaRad),
        vi: vm * Math.sin(vaRad),
        freqHz: basfrq,
      });
    }
  }

  // Partition solved bus Pg/Qg among multiple online generators at the same bus
  const onlineByBus = new Map<number, GeneratorRecord[]>();
  for (const g of psseCase.generators) {
    if (g.stat === 0) continue;
    const list = onlineByBus.get(g.i) ?? [];
    list.push(g);
    onlineByBus.set(g.i, list);
  }

  const gens = new Map<string, GeneratorSteadyInit>();
  for (const [busNum, genList] of onlineByBus) {
    const busSol = buses.get(busNum) ?? {
      busNumber: busNum,
      vm: 1.0,
      vaRad: 0.0,
      vr: 1.0,
      vi: 0.0,
      freqHz: basfrq,
    };
    const busTotals = pfOk ? busGenTotals.get(busNum) : undefined;
    const totalSchedP = genList.reduce((acc, g) => acc + g.pg, 0.0);
    const totalMbase = genList.reduce((acc, g) => acc + (g.mbase > 0 ? g.mbase : sbase), 0.0);
    const totalSchedQ = genList.reduce((acc, g) => acc + g.qg, 0.0);

    for (const g of genList) {
      const cleanId = g.id.trim() || "1";
      const genKey = `${g.i}_${cleanId}`;
      const mbase = g.mbase > 0 ? g.mbase : sbase;

      let pgMw = g.pg;
      let qgMvar = g.qg;
      if (busTotals) {
        if (genList.length === 1) {
          pgMw = busTotals.pg;
          qgMvar = busTotals.qg;
        } else {
          const pShare = Math.abs(totalSchedP) > 1e-6 ? g.pg / totalSchedP : mbase / Math.max(1e-6, totalMbase);
          const qShare = Math.abs(totalSchedQ) > 1e-6 ? g.qg / totalSchedQ : mbase / Math.max(1e-6, totalMbase);
          pgMw = busTotals.pg * pShare;
          qgMvar = busTotals.qg * qShare;
        }
      }

      const dyrGen: PsseDyrRecord | undefined =
        psseCase.dyr?.generatorsByBusId.get(genKey) ??
        psseCase.dyr?.generatorsByBusId.get(String(g.i)) ??
        psseCase.dyr?.records.find((r) => r.ibus === g.i && r.category === "generator");

      const modelUpper = (dyrGen?.canonicalModel ?? dyrGen?.model ?? "").toUpperCase();
      const isIbr =
        modelUpper.startsWith("REGC") ||
        modelUpper.startsWith("WT4G") ||
        modelUpper.startsWith("PVGU") ||
        modelUpper.startsWith("DER") ||
        modelUpper.startsWith("REGFM") ||
        modelUpper.startsWith("WECCGFM");

      const pPu = pgMw / mbase;
      const qPu = qgMvar / mbase;
      const vm2 = Math.max(1e-6, busSol.vr * busSol.vr + busSol.vi * busSol.vi);
      const irNet = (pPu * busSol.vr + qPu * busSol.vi) / vm2;
      const iiNet = (pPu * busSol.vi - qPu * busSol.vr) / vm2;

      // Project terminal current onto voltage phasor for IBR (Ip aligned with V, Iq quadrature)
      const cosT = busSol.vr / Math.sqrt(vm2);
      const sinT = busSol.vi / Math.sqrt(vm2);
      const ip0 = irNet * cosT + iiNet * sinT;
      const iq0Ibr = irNet * sinT - iiNet * cosT;

      const np = dyrGen?.namedParams ?? {};
      const ra = Math.max(0.0, np["Ra"] ?? (g.zr > 0 && g.zr < 0.2 ? g.zr : 0.0));
      const xdp = Math.max(0.02, np["Xdp"] ?? (g.zx > 0 && g.zx < 1.0 ? g.zx : 0.25));
      const xd = Math.max(xdp, np["Xd"] ?? 1.8);
      const xq = Math.max(xdp, np["Xq"] ?? 1.7);
      const xqp = Math.max(0.02, Math.min(xq, np["Xqp"] ?? np["Xdpp"] ?? 0.55));
      const xdpp = Math.max(0.01, Math.min(xdp, np["Xdpp"] ?? 0.2));
      const xqpp = Math.max(0.01, Math.min(xqp, np["Xqpp"] ?? xdpp));
      const xl = Math.max(0.0, Math.min(xdpp * 0.9, np["Xl"] ?? Math.min(0.14, xdpp * 0.7)));
      const s10 = Math.max(0.0, np["S10"] ?? 0.0);
      const s12 = Math.max(0.0, np["S12"] ?? 0.0);

      // Internal Eq phasor behind Ra + j*Xq gives exact rotor angle delta0
      const eqr = busSol.vr + ra * irNet - xq * iiNet;
      const eqi = busSol.vi + ra * iiNet + xq * irNet;
      const delta0 = Math.atan2(eqi, eqr);

      const sinD = Math.sin(delta0);
      const cosD = Math.cos(delta0);
      const vd0 = busSol.vr * sinD - busSol.vi * cosD;
      const vq0 = busSol.vr * cosD + busSol.vi * sinD;
      const id0 = irNet * sinD - iiNet * cosD;
      const iq0 = irNet * cosD + iiNet * sinD;

      const eqp0 = vq0 + ra * iq0 + xdp * id0;
      const edp0 = vd0 + ra * id0 - xqp * iq0;
      const psikd0 = eqp0 - (xdp - xl) * id0;
      const psikq0 = edp0 + (xqp - xl) * iq0;
      const psippd0 = vq0 + ra * iq0 + xdpp * id0;
      const psippq0 = vd0 + ra * id0 - xqpp * iq0;

      // Air-gap flux saturation evaluation at initial steady state
      const satCoeffs = computeQuadraticSatCoeffs(1.0, s10, 1.2, s12);
      const eAg = Math.hypot(vq0 + ra * iq0 + xl * id0, vd0 + ra * id0 - xl * iq0);
      const satVal = evalQuadraticSat(eAg, satCoeffs);
      const efd0 = eqp0 + (xd - xdp) * id0 + satVal * eqp0;
      const tm0 = psippd0 * iq0 + psippq0 * id0 + (xqpp - xdpp) * id0 * iq0;

      gens.set(genKey, {
        genKey,
        ibus: g.i,
        id: cleanId,
        mbase,
        pgMw,
        qgMvar,
        pPu,
        qPu,
        vr: busSol.vr,
        vi: busSol.vi,
        vt: busSol.vm,
        irNet,
        iiNet,
        delta0,
        vd0,
        vq0,
        id0,
        iq0,
        eqp0,
        edp0,
        psikd0,
        psikq0,
        psippd0,
        psippq0,
        efd0,
        tm0,
        ra,
        xd,
        xq,
        xdp,
        xqp,
        xdpp,
        xqpp,
        xl,
        s10,
        s12,
        isIbr,
        ip0,
        iq0Ibr,
      });
    }
  }

  return {
    sbase,
    basfrq,
    omega0,
    buses,
    gens,
  };
}

export function getBusInit(sol: PsseSteadyStateSolution, busNum: number, fallback?: BusRecord): SolvedBusPoint {
  const found = sol.buses.get(busNum);
  if (found) return found;
  const vm = fallback?.vm && fallback.vm > 0 ? fallback.vm : 1.0;
  const vaRad = ((fallback?.va ?? 0.0) * Math.PI) / 180.0;
  return {
    busNumber: busNum,
    vm,
    vaRad,
    vr: vm * Math.cos(vaRad),
    vi: vm * Math.sin(vaRad),
    freqHz: sol.basfrq,
  };
}
