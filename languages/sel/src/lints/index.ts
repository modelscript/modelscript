// SPDX-License-Identifier: AGPL-3.0-or-later

import { tokenizeSELogic } from "../analysis/selogic-evaluator.js";
import type { SELRelaySettings } from "../types.js";

export interface SelDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string | undefined;
  group?: number | undefined;
}

const KNOWN_RELAY_WORDS = new Set([
  // Phase Overcurrent
  "50P1",
  "50P1P",
  "50P2",
  "50P2P",
  "51P1",
  "51P1P",
  "51P1T",
  // Ground Overcurrent
  "50G1",
  "50G1P",
  "50G2",
  "50G2P",
  "51G1",
  "51G1P",
  "51G1T",
  "50N1",
  "50N1P",
  "51N1",
  // Distance
  "Z1P",
  "M1P",
  "Z2P",
  "M2P",
  "Z3P",
  "M3P",
  "Z1G",
  "Z2G",
  "Z3G",
  "Z1",
  "Z2",
  "Z3",
  // Voltage & Frequency
  "27P",
  "27P1",
  "59P",
  "59P1",
  "81U",
  "81O",
  // Controls & Targets
  "TRIP",
  "CLOSE",
  "DLOGIC",
  // Operators & Literals
  "AND",
  "OR",
  "NOT",
  "TRUE",
  "FALSE",
  "1",
  "0",
  "NA",
  "OFF",
  "(",
  ")",
  "!",
]);

// Add dynamic slots: IN101..IN108, OUT101..OUT108, SV01..SV16, LT01..LT16
for (let i = 1; i <= 32; i++) {
  const pad = i < 10 ? `0${i}` : `${i}`;
  KNOWN_RELAY_WORDS.add(`IN10${i}`);
  KNOWN_RELAY_WORDS.add(`OUT10${i}`);
  KNOWN_RELAY_WORDS.add(`SV${pad}`);
  KNOWN_RELAY_WORDS.add(`LT${pad}`);
}

/**
 * Validates SELRelaySettings against utility engineering rules.
 */
export function lintSELSettings(settings: SELRelaySettings): SelDiagnostic[] {
  const diagnostics: SelDiagnostic[] = [];

  // SEL1001: Missing relay identifier or model
  if (!settings.relayId || settings.relayId === "SEL_RELAY_1" || settings.relayId.trim() === "") {
    diagnostics.push({
      code: "SEL1001",
      severity: "warning",
      message: "Relay identifier (RID) is not configured or using default placeholder.",
      field: "relayId",
    });
  }
  if (!settings.relayType || settings.relayType.trim() === "") {
    diagnostics.push({
      code: "SEL1001",
      severity: "error",
      message: "Relay model type is missing.",
      field: "relayType",
    });
  }

  for (const [gNum, group] of settings.groups.entries()) {
    // SEL3001: Inverted pickup or reach settings
    if (group.phaseOvercurrent) {
      const po = group.phaseOvercurrent;
      if (po.inst50P1P !== undefined && po.time51P1P !== undefined && po.inst50P1P <= po.time51P1P) {
        diagnostics.push({
          code: "SEL3001",
          severity: "error",
          message: `Group ${gNum}: Instantaneous pickup 50P1P (${po.inst50P1P}A) must be strictly greater than time-overcurrent pickup 51P1P (${po.time51P1P}A).`,
          field: "50P1P",
          group: gNum,
        });
      }
    }

    if (group.distance) {
      const dist = group.distance;
      if (dist.zone1Reach !== undefined && dist.zone2Reach !== undefined && dist.zone2Reach <= dist.zone1Reach) {
        diagnostics.push({
          code: "SEL3001",
          severity: "error",
          message: `Group ${gNum}: Zone 2 reach Z2P (${dist.zone2Reach} Ohms) must be greater than Zone 1 reach Z1P (${dist.zone1Reach} Ohms).`,
          field: "Z2P",
          group: gNum,
        });
      }
      if (dist.zone2Reach !== undefined && dist.zone3Reach !== undefined && dist.zone3Reach <= dist.zone2Reach) {
        diagnostics.push({
          code: "SEL3001",
          severity: "error",
          message: `Group ${gNum}: Zone 3 reach Z3P (${dist.zone3Reach} Ohms) must be greater than Zone 2 reach Z2P (${dist.zone2Reach} Ohms).`,
          field: "Z3P",
          group: gNum,
        });
      }
    }

    // SEL2001: Undefined SELogic variable / Relay Word bit reference
    const declaredTargets = new Set(Object.keys(group.equations).map((k) => k.toUpperCase()));
    for (const [target, expr] of Object.entries(group.equations)) {
      const tokens = tokenizeSELogic(expr);
      for (const tok of tokens) {
        if (!KNOWN_RELAY_WORDS.has(tok) && !declaredTargets.has(tok)) {
          diagnostics.push({
            code: "SEL2001",
            severity: "error",
            message: `Group ${gNum}: Undefined Relay Word bit or equation reference '${tok}' in '${target}'.`,
            field: target,
            group: gNum,
          });
        }
      }
    }

    // SEL4001: Circular SELogic equation dependency
    const graph = new Map<string, string[]>();
    for (const [target, expr] of Object.entries(group.equations)) {
      const uTarget = target.toUpperCase();
      const deps: string[] = [];
      const tokens = tokenizeSELogic(expr);
      for (const tok of tokens) {
        if (declaredTargets.has(tok) && tok !== uTarget) {
          deps.push(tok);
        }
      }
      graph.set(uTarget, deps);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycle(node: string): boolean {
      visited.add(node);
      recStack.add(node);

      const neighbors = graph.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }

      recStack.delete(node);
      return false;
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        if (hasCycle(node)) {
          diagnostics.push({
            code: "SEL4001",
            severity: "error",
            message: `Group ${gNum}: Circular SELogic dependency detected involving variable '${node}'.`,
            field: node,
            group: gNum,
          });
          break;
        }
      }
    }
  }

  return diagnostics;
}
