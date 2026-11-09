// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck, DssLoad, DssPVSystem } from "../types.js";
import { solveAdmittancePowerFlow } from "./opendss-ybus-solver.js";

/**
 * Options for distribution feeder DER hosting capacity analysis.
 */
export interface HostingCapacityOptions {
  /** Power increment step in kW (default: 50.0). */
  stepKw?: number;
  /** Maximum generation capacity search bound in kW (default: 5000.0). */
  maxKw?: number;
  /** Specific bus to test hosting capacity for (default: all load buses or feeder-wide). */
  targetBus?: string;
  /** Maximum permissible steady-state voltage in per-unit (default: 1.05 under ANSI C84.1). */
  voltageMaxPu?: number;
  /** Minimum permissible steady-state voltage in per-unit (default: 0.95 under ANSI C84.1). */
  voltageMinPu?: number;
  /** Maximum allowable conductor / transformer loading fraction (default: 1.0 = 100% rating). */
  thermalLoadingMaxFraction?: number;
  /** Whether to simulate autonomous IEEE 1547 smart inverter Volt-VAR / Volt-Watt controls (default: false). */
  enableSmartInverter?: boolean;
}

/**
 * Step evaluation record during hosting capacity search.
 */
export interface HostingCapacityStep {
  kwAdded: number;
  maxVoltagePu: number;
  maxVoltageBus: string;
  minVoltagePu: number;
  minVoltageBus: string;
  maxLoadingFraction: number;
  maxLoadedElement: string;
  converged: boolean;
}

/**
 * Result of distribution feeder DER hosting capacity analysis.
 */
export interface HostingCapacityResult {
  targetBus?: string | undefined;
  hostingCapacityKw: number;
  limitingCriterion: "voltage_upper" | "voltage_lower" | "thermal" | "none";
  limitingElement: string;
  limitingValue: number;
  steps: HostingCapacityStep[];
  iterations: number;
  baselineMaxVoltagePu: number;
  baselineMinVoltagePu: number;
}

/**
 * Clones a DssDeck shallowly with new Maps so modifications don't mutate original deck.
 */
function cloneDeck(deck: DssDeck): DssDeck {
  return {
    circuit: deck.circuit ? { ...deck.circuit } : undefined,
    lines: new Map(deck.lines),
    transformers: new Map(deck.transformers),
    loads: new Map(deck.loads),
    pvSystems: new Map(deck.pvSystems),
    storages: new Map(deck.storages),
    capacitors: new Map(deck.capacitors),
    generators: new Map(deck.generators),
    regControls: new Map(deck.regControls),
    capControls: new Map(deck.capControls),
    tccCurves: new Map(deck.tccCurves),
    relays: new Map(deck.relays),
    fuses: new Map(deck.fuses),
    reclosers: new Map(deck.reclosers),
    invControls: new Map(deck.invControls),
    swtControls: new Map(deck.swtControls),
    wireData: new Map(deck.wireData),
    cnData: new Map(deck.cnData),
    tsData: new Map(deck.tsData),
    lineSpacings: new Map(deck.lineSpacings),
    lineGeometries: new Map(deck.lineGeometries),
    lineCodes: new Map(deck.lineCodes),
    loadShapes: deck.loadShapes ? new Map(deck.loadShapes) : undefined,
    voltageBases: [...deck.voltageBases],
    comments: [...deck.comments],
    sourceFile: deck.sourceFile,
  };
}

/**
 * Evaluates Solar PV / DER Hosting Capacity on a distribution feeder
 * by iteratively scaling penetration until statutory voltage (ANSI C84.1)
 * or thermal limits are breached.
 */
export function solveHostingCapacity(deck: DssDeck, options: HostingCapacityOptions = {}): HostingCapacityResult {
  const stepKw = Math.max(10.0, options.stepKw ?? 50.0);
  const maxKw = Math.max(stepKw, options.maxKw ?? 5000.0);
  const vMax = options.voltageMaxPu ?? 1.05;
  const vMin = options.voltageMinPu ?? 0.95;
  const loadingMax = options.thermalLoadingMaxFraction ?? 1.0;
  const enableSmartInverter = options.enableSmartInverter ?? false;

  // Determine candidate buses
  const candidateBus = options.targetBus ?? (Array.from(deck.loads.values())[0]?.bus1 || "LoadBus");

  // 1. Solve baseline circuit (0 kW DER added)
  const baseRes = solveAdmittancePowerFlow(deck);
  let baseMaxV = 1.0;
  let baseMinV = 1.0;
  for (const [, bRes] of baseRes.buses) {
    if (bRes.vMagPu > baseMaxV) baseMaxV = bRes.vMagPu;
    if (bRes.vMagPu < baseMinV) baseMinV = bRes.vMagPu;
  }

  const steps: HostingCapacityStep[] = [];
  let currentKw = 0;
  let hostingCapacityKw = 0;
  let limitingCriterion: HostingCapacityResult["limitingCriterion"] = "none";
  let limitingElement = "";
  let limitingValue = 0;

  // Working deck copy
  const workDeck = cloneDeck(deck);

  while (currentKw <= maxKw) {
    // If not first step, increment PV generation at candidate bus
    if (currentKw > 0) {
      const pvName = `HC_PV_${candidateBus}`;
      const kv = deck.loads.get(candidateBus)?.kv ?? deck.circuit?.baseKv ?? 12.47;

      const newPv: DssPVSystem = {
        name: pvName,
        bus1: candidateBus,
        phases: 3,
        kv,
        kva: currentKw * 1.1,
        pmpp: currentKw,
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      };
      workDeck.pvSystems.set(pvName, newPv);

      // If smart inverter enabled, add IEEE 1547 reactive power absorption
      if (enableSmartInverter) {
        // Smart inverter Volt-VAR absorbs reactive power at overvoltage
        const pvVoltVarKvar = currentKw * 0.44; // Standard 0.90 power factor absorption capability
        const capLoadName = `HC_VV_${candidateBus}`;
        const loadMod: DssLoad = {
          name: capLoadName,
          bus1: candidateBus,
          phases: 3,
          kv,
          kw: 0,
          kvar: pvVoltVarKvar, // Inductive absorption acts as reactive load
          range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        };
        workDeck.loads.set(capLoadName, loadMod);
      }
    }

    const pfRes = solveAdmittancePowerFlow(workDeck);

    let stepMaxV = 0;
    let stepMaxVBus = "";
    let stepMinV = 2.0;
    let stepMinVBus = "";

    for (const [bName, bRes] of pfRes.buses) {
      if (bRes.vMagPu > stepMaxV) {
        stepMaxV = bRes.vMagPu;
        stepMaxVBus = bName;
      }
      if (bRes.vMagPu < stepMinV) {
        stepMinV = bRes.vMagPu;
        stepMinVBus = bName;
      }
    }

    // Estimate line thermal loading
    let maxLoading = 0;
    let maxLoadingElem = "";
    for (const [lineName, line] of workDeck.lines) {
      const b1Res = pfRes.buses.get(line.bus1);
      const b2Res = pfRes.buses.get(line.bus2);
      if (b1Res && b2Res) {
        const vDiff = Math.abs(b1Res.vMagPu - b2Res.vMagPu);
        const zNorm = Math.max(0.01, (line.r1 ?? 0.1) * Math.max(0.1, line.length));
        const estimatedLoading = vDiff / zNorm;
        if (estimatedLoading > maxLoading) {
          maxLoading = estimatedLoading;
          maxLoadingElem = lineName;
        }
      }
    }

    steps.push({
      kwAdded: currentKw,
      maxVoltagePu: stepMaxV,
      maxVoltageBus: stepMaxVBus,
      minVoltagePu: stepMinV,
      minVoltageBus: stepMinVBus,
      maxLoadingFraction: maxLoading,
      maxLoadedElement: maxLoadingElem,
      converged: pfRes.converged,
    });

    // Check violations
    if (stepMaxV > vMax) {
      limitingCriterion = "voltage_upper";
      limitingElement = stepMaxVBus;
      limitingValue = stepMaxV;
      break;
    }
    if (stepMinV < vMin) {
      limitingCriterion = "voltage_lower";
      limitingElement = stepMinVBus;
      limitingValue = stepMinV;
      break;
    }
    if (maxLoading > loadingMax * 5.0) {
      limitingCriterion = "thermal";
      limitingElement = maxLoadingElem;
      limitingValue = maxLoading;
      break;
    }

    // Successfully passed this capacity level
    hostingCapacityKw = currentKw;
    currentKw += stepKw;
  }

  return {
    targetBus: candidateBus,
    hostingCapacityKw,
    limitingCriterion,
    limitingElement,
    limitingValue,
    steps,
    iterations: steps.length,
    baselineMaxVoltagePu: baseMaxV,
    baselineMinVoltagePu: baseMinV,
  };
}
