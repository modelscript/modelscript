// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PowerFlowBranchSnapshot, PowerFlowBusSnapshot, PowerFlowSnapshot } from "@modelscript/exchange";
import type { EmtNetlist } from "../types.js";
import type { EmtNetlistInput } from "./emt-solver-types.js";
import { runEmtSimulation } from "./emt-solver.js";

export interface PscadSteadyStateSnapshotOptions {
  /** Solver label (default: `"pscad"`). */
  solver?: string | undefined;
  /** Optional display label. */
  label?: string | undefined;
  /** EMT time step in seconds (default: `netlist.metadata?.timeStepSec ?? 50e-6`). */
  timeStepSec?: number | undefined;
  /** Nominal frequency in Hz (default: `netlist.metadata?.nominalFrequencyHz ?? 60`). */
  nominalFrequencyHz?: number | undefined;
  /** Default line-to-line base kV if a bus does not specify `baseKv` (default: `230`). */
  defaultBaseKv?: number | undefined;
}

function normalizeToEmtInput(raw: EmtNetlist | EmtNetlistInput): {
  netlist: EmtNetlistInput;
  meta: { projectName?: string; nominalFrequencyHz?: number; timeStepSec?: number } | undefined;
} {
  const anyRaw = raw as unknown as Record<string, unknown>;
  const meta = ("metadata" in raw ? raw.metadata : undefined) as
    { projectName?: string; nominalFrequencyHz?: number; timeStepSec?: number } | undefined;

  // Detect PsseEmtNetlist shape (branches have resistanceOhm / loads array exists)
  const rawBranches = Array.isArray(anyRaw["branches"]) ? (anyRaw["branches"] as Array<Record<string, unknown>>) : [];
  const rawLoads = Array.isArray(anyRaw["loads"]) ? (anyRaw["loads"] as Array<Record<string, unknown>>) : [];
  const rawSources = Array.isArray(anyRaw["sources"]) ? (anyRaw["sources"] as Array<Record<string, unknown>>) : [];
  const isPsseEmt =
    rawLoads.length > 0 || rawBranches.some((b) => "resistanceOhm" in b) || rawSources.some((s) => "phaseRad" in s);

  if (!isPsseEmt) {
    return { netlist: raw as EmtNetlistInput, meta };
  }

  const busesArr =
    anyRaw["buses"] instanceof Map
      ? Array.from((anyRaw["buses"] as Map<string, { id: string; name?: string; baseKv?: number }>).values()).map(
          (b) => ({ id: b.id, name: b.name, baseKv: b.baseKv }),
        )
      : (raw.buses as EmtNetlistInput["buses"]);

  const mapBranch = (b: Record<string, unknown>) => ({
    id: String(b["id"] ?? "BR"),
    name: String(b["id"] ?? "BR"),
    kind: "rlc" as const,
    fromBus: String(b["fromBus"] ?? ""),
    toBus: String(b["toBus"] ?? "GND"),
    rOhm: Number(b["resistanceOhm"] ?? b["rOhm"] ?? 0),
    lHenry: Number(b["inductanceH"] ?? b["lHenry"] ?? 0),
    cFarad: Number(b["capacitanceF"] ?? b["cFarad"] ?? 0),
  });

  const rawTransformers = Array.isArray(anyRaw["transformers"])
    ? (anyRaw["transformers"] as Array<Record<string, unknown>>)
    : [];

  const branches = [...rawBranches.map(mapBranch), ...rawLoads.map(mapBranch)];
  const transformers = rawTransformers.map((t) => ({
    id: String(t["id"] ?? "XFMR"),
    fromBus: String(t["fromBus"] ?? ""),
    toBus: String(t["toBus"] ?? ""),
    primaryKv: Number(t["primaryKv"] ?? 230),
    secondaryKv: Number(t["secondaryKv"] ?? t["primaryKv"] ?? 230),
    mvaRating: Number(t["mvaRating"] ?? 100),
    leakageReactancePu: Number(t["leakageReactancePu"] ?? 0.08),
    tapPu: typeof t["tapRatio"] === "number" && t["tapRatio"] > 0 ? t["tapRatio"] : 1.0,
    windingConnection: (t["windingConnection"] as "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" | undefined) ?? "Yg-Yg",
  }));
  const sources = rawSources.map((s) => ({
    id: String(s["id"] ?? "SRC"),
    name: String(s["name"] ?? s["id"] ?? "SRC"),
    bus: String(s["bus"] ?? ""),
    vPeakKv: Number(s["vPeakKv"] ?? 0),
    frequencyHz: Number(s["frequencyHz"] ?? 60),
    phaseDeg: typeof s["phaseRad"] === "number" ? (s["phaseRad"] * 180) / Math.PI : Number(s["phaseDeg"] ?? 0),
    rOhm: Number(s["rSourceOhm"] ?? s["rOhm"] ?? 0.5),
    lHenry: Number(s["lSourceH"] ?? s["lHenry"] ?? 0.005),
  }));

  return {
    netlist: {
      buses: busesArr,
      branches,
      transformers,
      sources,
    },
    meta: {
      nominalFrequencyHz: typeof anyRaw["frequencyHz"] === "number" ? (anyRaw["frequencyHz"] as number) : 60,
    },
  };
}

/**
 * Runs PSCAD EMT steady-state initialization (`initializeFromLoadFlow: true`) over two
 * fundamental cycles and extracts positive-sequence fundamental-frequency bus phasors
 * (`vmPu`, `vaDeg`) via single-cycle DFT into a canonical `PowerFlowSnapshot`.
 */
export function extractPscadSteadyStateSnapshot(
  rawNetlist: EmtNetlist | EmtNetlistInput,
  options: PscadSteadyStateSnapshotOptions = {},
): PowerFlowSnapshot {
  const tStart = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { netlist, meta } = normalizeToEmtInput(rawNetlist);
  const f0 = options.nominalFrequencyHz ?? meta?.nominalFrequencyHz ?? 60.0;
  const dt = options.timeStepSec ?? meta?.timeStepSec ?? 50e-6;
  const periodSec = 1.0 / Math.max(1.0, f0);
  const durationSec = 2.0 * periodSec;
  const omega = 2.0 * Math.PI * f0;
  const defaultBaseKv = options.defaultBaseKv ?? 230.0;

  const busList = Array.isArray(netlist.buses)
    ? netlist.buses
    : Array.from((netlist.buses as Map<string, { id: string; name?: string; baseKv?: number }>).values());

  const accum = new Map<
    string,
    {
      vaRe: number;
      vaIm: number;
      vbRe: number;
      vbIm: number;
      vcRe: number;
      vcIm: number;
      count: number;
      baseKv: number;
      name?: string | undefined;
    }
  >();

  for (const b of busList) {
    if (typeof b === "string") {
      accum.set(b, {
        vaRe: 0,
        vaIm: 0,
        vbRe: 0,
        vbIm: 0,
        vcRe: 0,
        vcIm: 0,
        count: 0,
        baseKv: defaultBaseKv,
        name: b,
      });
    } else {
      const rawKv = "baseKv" in b ? b.baseKv : "nominalKv" in b ? b.nominalKv : undefined;
      accum.set(b.id, {
        vaRe: 0,
        vaIm: 0,
        vbRe: 0,
        vbIm: 0,
        vcRe: 0,
        vcIm: 0,
        count: 0,
        baseKv: typeof rawKv === "number" && rawKv > 0 ? rawKv : defaultBaseKv,
        name: b.name,
      });
    }
  }

  // Integrate DFT over the second cycle [periodSec, 2*periodSec]
  runEmtSimulation(netlist, {
    timeStepSec: dt,
    durationSec,
    nominalFrequencyHz: f0,
    initializeFromLoadFlow: true,
    onStep: (t, _stepIdx, busVoltages) => {
      if (t < periodSec - 0.5 * dt) return;
      const cosWt = Math.cos(omega * t);
      const sinWt = Math.sin(omega * t);
      for (const [busId, v] of busVoltages.entries()) {
        const entry = accum.get(busId);
        if (!entry) continue;
        // EmtSolver uses sin(omega*t + phi) in Volts:
        // Re = (2/N) * sum v * sin(wt), Im = (2/N) * sum v * cos(wt)
        entry.vaRe += v.a * sinWt;
        entry.vaIm += v.a * cosWt;
        entry.vbRe += v.b * sinWt;
        entry.vbIm += v.b * cosWt;
        entry.vcRe += v.c * sinWt;
        entry.vcIm += v.c * cosWt;
        entry.count++;
      }
    },
  });

  // Positive-sequence Fortescue operator a = exp(j*2*pi/3), a^2 = exp(-j*2*pi/3)
  const cos120 = -0.5;
  const sin120 = Math.sqrt(3) * 0.5;

  const buses: PowerFlowBusSnapshot[] = [];
  const busPhasorV = new Map<string, { re: number; im: number }>();
  for (const [busId, entry] of accum.entries()) {
    const n = Math.max(1, entry.count);
    const scale = 2.0 / n;
    const vaRe = entry.vaRe * scale;
    const vaIm = entry.vaIm * scale;
    const vbRe = entry.vbRe * scale;
    const vbIm = entry.vbIm * scale;
    const vcRe = entry.vcRe * scale;
    const vcIm = entry.vcIm * scale;

    // V1 = (Va + a*Vb + a^2*Vc) / 3
    const aVbRe = cos120 * vbRe - sin120 * vbIm;
    const aVbIm = cos120 * vbIm + sin120 * vbRe;
    const a2VcRe = cos120 * vcRe + sin120 * vcIm;
    const a2VcIm = cos120 * vcIm - sin120 * vcRe;

    const v1Re = (vaRe + aVbRe + a2VcRe) / 3.0;
    const v1Im = (vaIm + aVbIm + a2VcIm) / 3.0;
    busPhasorV.set(busId, { re: v1Re, im: v1Im });

    const v1PeakV = Math.hypot(v1Re, v1Im);
    const basePeakPhaseV = entry.baseKv * 1000.0 * Math.sqrt(2.0 / 3.0);
    const vmPu = basePeakPhaseV > 0 ? v1PeakV / basePeakPhaseV : 0;
    const vaDeg = (Math.atan2(v1Im, v1Re) * 180.0) / Math.PI;

    buses.push({
      busId,
      name: entry.name,
      baseKv: entry.baseKv,
      vmPu,
      vaDeg,
    });
  }

  // Extract 3-phase fundamental branch power flows S_ij = (3/2) * V_i * conj((V_i - V_j) / (R + j*omega*L))
  const branches: PowerFlowBranchSnapshot[] = [];
  const rawBranches = Array.isArray(netlist.branches) ? netlist.branches : [];
  for (const br of rawBranches) {
    const fromBus = br.fromBus;
    const toBus = br.toBus;
    if (!fromBus || !toBus || fromBus === "GND" || toBus === "GND") continue;
    const vi = busPhasorV.get(fromBus);
    const vj = busPhasorV.get(toBus);
    if (!vi || !vj) continue;
    const rOhm = typeof br.rOhm === "number" ? br.rOhm : 0;
    const xOhm = omega * (typeof br.lHenry === "number" ? br.lHenry : 0);
    const z2 = rOhm * rOhm + xOhm * xOhm;
    if (z2 < 1e-12) continue;

    const dVRe = vi.re - vj.re;
    const dVIm = vi.im - vj.im;
    const iRe = (dVRe * rOhm + dVIm * xOhm) / z2;
    const iIm = (dVIm * rOhm - dVRe * xOhm) / z2;

    const pFlowMw = 1.5 * (vi.re * iRe + vi.im * iIm) * 1e-6;
    const qFlowMvar = 1.5 * (vi.im * iRe - vi.re * iIm) * 1e-6;

    branches.push({
      id: br.id || `${fromBus}-${toBus}-1`,
      fromBus,
      toBus,
      ckt: "1",
      pFlowMw,
      qFlowMvar,
    });
  }

  const tEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    solver: options.solver ?? "pscad",
    label: options.label ?? meta?.projectName,
    converged: buses.length > 0 && buses.every((b) => Number.isFinite(b.vmPu)),
    frequencyHz: f0,
    sbaseMva: 100.0,
    buses,
    branches,
    executionTimeMs: Math.max(0, tEnd - tStart),
  };
}
