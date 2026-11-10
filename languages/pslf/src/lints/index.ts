// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Linter rules and topological diagnostics for GE PSLF (.epc and .dyd).
 */

import type { PslfDydCase, PslfEpcCase } from "../types.js";

export interface PslfDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  element?: string | undefined;
}

export const PslfErrorCode = {
  MISSING_SLACK_BUS: {
    code: "PSLF-E001",
    rule: "missing-slack-bus",
    severity: "error",
    message: () => "No slack / swing bus (busType 3) defined in the power flow case.",
  },
  DANGLING_BRANCH_BUS: {
    code: "PSLF-E002",
    rule: "dangling-branch-bus",
    severity: "error",
    message: (busNumber: string) => `Transmission line connects to non-existent bus '${busNumber}'.`,
  },
  DANGLING_TRANSFORMER_BUS: {
    code: "PSLF-E003",
    rule: "dangling-transformer-bus",
    severity: "error",
    message: (busNumber: string) => `Transformer connects to non-existent bus '${busNumber}'.`,
  },
  DANGLING_GENERATOR_BUS: {
    code: "PSLF-E004",
    rule: "dangling-generator-bus",
    severity: "error",
    message: (busNumber: string) => `Generator is connected to non-existent bus '${busNumber}'.`,
  },
  INVERTED_GENERATOR_REACTIVE_LIMITS: {
    code: "PSLF-E005",
    rule: "inverted-generator-reactive-limits",
    severity: "error",
    message: (qmin: string, qmax: string) =>
      `Generator reactive lower limit Q_min (${qmin} Mvar) exceeds Q_max (${qmax} Mvar).`,
  },
  DANGLING_DYNAMIC_MODEL_BUS: {
    code: "PSLF-E006",
    rule: "dangling-dynamic-model-bus",
    severity: "error",
    message: (modelType: string, busNumber: string) =>
      `Dynamic model '${modelType}' refers to non-existent power flow bus '${busNumber}'.`,
  },
  NON_POSITIVE_GENERATOR_INERTIA: {
    code: "PSLF-E007",
    rule: "non-positive-generator-inertia",
    severity: "error",
    message: (inertiaH: string) => `Classical generator model has non-positive inertia H = '${inertiaH}'.`,
  },
  NON_POSITIVE_BRANCH_REACTANCE: {
    code: "PSLF-W001",
    rule: "non-positive-branch-reactance",
    severity: "warning",
    message: (xPu: string) => `Branch series reactance X is non-positive (${xPu} pu).`,
  },
  TRANSFORMER_RATIO_OUT_OF_BOUNDS: {
    code: "PSLF-W002",
    rule: "transformer-ratio-out-of-bounds",
    severity: "warning",
    message: (ratio: string) =>
      `Transformer off-nominal turns ratio ${ratio} pu is outside typical operating envelope [0.8, 1.2].`,
  },
  ISOLATED_BUS: {
    code: "PSLF-W003",
    rule: "isolated-bus",
    severity: "warning",
    message: (busName: string) =>
      `Bus '${busName}' is electrically isolated without any in-service branch or transformer connections.`,
  },
} as const;

/**
 * Lints a GE PSLF .epc power flow case for topological, electrical, and data integrity issues.
 */
export function lintPslfEpc(epcCase: PslfEpcCase): PslfDiagnostic[] {
  const diagnostics: PslfDiagnostic[] = [];

  // Check 1: Slack / Swing Bus presence
  let slackCount = 0;
  for (const b of epcCase.buses.values()) {
    if (b.busType === 3) slackCount++;
  }
  if (slackCount === 0) {
    diagnostics.push({
      code: "PSLF-E001",
      severity: "error",
      message: "No slack / swing bus (busType 3) defined in the power flow case.",
    });
  }

  // Check 2: Dangling branches
  for (const br of epcCase.branches) {
    if (!epcCase.buses.has(br.fromBus)) {
      diagnostics.push({
        code: "PSLF-E002",
        severity: "error",
        message: `Transmission line connects to non-existent from-bus ${br.fromBus}.`,
        element: `Branch ${br.fromBus}-${br.toBus}`,
      });
    }
    if (!epcCase.buses.has(br.toBus)) {
      diagnostics.push({
        code: "PSLF-E002",
        severity: "error",
        message: `Transmission line connects to non-existent to-bus ${br.toBus}.`,
        element: `Branch ${br.fromBus}-${br.toBus}`,
      });
    }
    if (br.xPu <= 0) {
      diagnostics.push({
        code: "PSLF-W001",
        severity: "warning",
        message: `Branch series reactance X is non-positive (${br.xPu.toFixed(5)} pu).`,
        element: `Branch ${br.fromBus}-${br.toBus}`,
      });
    }
  }

  // Check 3: Dangling transformers
  for (const tr of epcCase.transformers) {
    if (!epcCase.buses.has(tr.fromBus)) {
      diagnostics.push({
        code: "PSLF-E003",
        severity: "error",
        message: `Transformer connects to non-existent from-bus ${tr.fromBus}.`,
        element: `Xfmr ${tr.fromBus}-${tr.toBus}`,
      });
    }
    if (!epcCase.buses.has(tr.toBus)) {
      diagnostics.push({
        code: "PSLF-E003",
        severity: "error",
        message: `Transformer connects to non-existent to-bus ${tr.toBus}.`,
        element: `Xfmr ${tr.fromBus}-${tr.toBus}`,
      });
    }
    if (tr.ratio <= 0.5 || tr.ratio >= 2.0) {
      diagnostics.push({
        code: "PSLF-W002",
        severity: "warning",
        message: `Transformer off-nominal turns ratio ${tr.ratio.toFixed(4)} pu is outside typical operating envelope [0.8, 1.2].`,
        element: `Xfmr ${tr.fromBus}-${tr.toBus}`,
      });
    }
  }

  // Check 4: Generator limits sanity
  for (const g of epcCase.generators) {
    if (!epcCase.buses.has(g.busNumber)) {
      diagnostics.push({
        code: "PSLF-E004",
        severity: "error",
        message: `Generator is connected to non-existent bus ${g.busNumber}.`,
        element: `Gen ${g.busNumber}-${g.genId}`,
      });
    }
    if (g.qminMvar > g.qmaxMvar) {
      diagnostics.push({
        code: "PSLF-E005",
        severity: "error",
        message: `Generator reactive lower limit Q_min (${g.qminMvar} Mvar) exceeds Q_max (${g.qmaxMvar} Mvar).`,
        element: `Gen ${g.busNumber}-${g.genId}`,
      });
    }
  }

  // Check 5: Isolated buses
  const connectedBuses = new Set<number>();
  for (const br of epcCase.branches) {
    if (br.status !== 0) {
      connectedBuses.add(br.fromBus);
      connectedBuses.add(br.toBus);
    }
  }
  for (const tr of epcCase.transformers) {
    if (tr.status !== 0) {
      connectedBuses.add(tr.fromBus);
      connectedBuses.add(tr.toBus);
    }
  }

  for (const [bNum, b] of epcCase.buses.entries()) {
    if (b.busType !== 4 && !connectedBuses.has(bNum)) {
      diagnostics.push({
        code: "PSLF-W003",
        severity: "warning",
        message: `Bus ${bNum} ('${b.name}') is electrically isolated without any in-service branch or transformer connections.`,
        element: `Bus ${bNum}`,
      });
    }
  }

  return diagnostics;
}

/**
 * Lints a GE PSLF .dyd dynamic case against the corresponding .epc power flow case.
 */
export function lintPslfDyd(dydCase: PslfDydCase, epcCase?: PslfEpcCase): PslfDiagnostic[] {
  const diagnostics: PslfDiagnostic[] = [];

  for (const m of dydCase.models) {
    if (epcCase && !epcCase.buses.has(m.busNumber)) {
      diagnostics.push({
        code: "PSLF-E006",
        severity: "error",
        message: `Dynamic model '${m.modelType}' refers to non-existent power flow bus ${m.busNumber}.`,
        element: `${m.modelType} ${m.busNumber}-${m.id}`,
      });
    }

    // Check inertia H in synchronous machine models
    if (m.modelType === "gencls" && m.params[0] !== undefined) {
      // In gencls: CON(1) is H, or if preceded by Mbase, check H
      const h = m.params[0];
      if (h <= 0) {
        diagnostics.push({
          code: "PSLF-E007",
          severity: "error",
          message: `Classical generator model has non-positive inertia H = ${h}.`,
          element: `gencls ${m.busNumber}`,
        });
      }
    }
  }

  return diagnostics;
}
