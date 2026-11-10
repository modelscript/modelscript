// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-Flight Electrical Topology & Parameter Linter for DIgSILENT PowerFactory Models.
 *
 * Implements validation rules PF1001–PF1008 detecting topology anomalies,
 * missing type definitions, rating mismatches, and parameter bounds violations.
 */

import type { PowerFactoryModel } from "../types.js";

export interface PowerFactoryDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  element: string;
  message: string;
}

export const PowerFactoryErrorCode = {
  FLOATING_TERMINAL: {
    code: "PF1001",
    rule: "floating-terminal",
    severity: "warning",
    message: (terminalName: string) =>
      `Terminal '${terminalName}' is floating and not connected to any electrical equipment.`,
  },
  INVALID_LINE_PARAMETERS: {
    code: "PF1002",
    rule: "invalid-line-parameters",
    severity: "error",
    message: (lineName: string) =>
      `Line '${lineName}' lacks explicit resistance R1/type definition or has non-positive length.`,
  },
  TRANSFORMER_VOLTAGE_MISMATCH: {
    code: "PF1003",
    rule: "transformer-voltage-mismatch",
    severity: "warning",
    message: (trafoName: string) =>
      `Transformer '${trafoName}' rated HV voltage differs by >20% from connected bus nominal voltage.`,
  },
  GENERATOR_VOLTAGE_SETPOINT_OUT_OF_RANGE: {
    code: "PF1004",
    rule: "generator-voltage-setpoint-bounds",
    severity: "warning",
    message: (genName: string) =>
      `Generator '${genName}' voltage setpoint is outside typical operating range [0.8, 1.2] pu.`,
  },
  GENERATOR_POWER_EXCEEDS_MBASE: {
    code: "PF1005",
    rule: "generator-power-exceeds-mbase",
    severity: "warning",
    message: (genName: string) =>
      `Generator '${genName}' scheduled active power exceeds rated apparent power MVA.`,
  },
  UNRESOLVED_TERMINAL_REFERENCE: {
    code: "PF1008",
    rule: "unresolved-terminal-reference",
    severity: "error",
    message: (elementName: string, terminalId: string) =>
      `Element '${elementName}' references unknown terminal '${terminalId}'.`,
  },
} as const;

/**
 * Lints a PowerFactoryModel for electrical topology and parameter consistency.
 */
export function lintPowerFactoryModel(model: PowerFactoryModel): PowerFactoryDiagnostic[] {
  const diags: PowerFactoryDiagnostic[] = [];

  // Track connected terminals
  const connectedTerms = new Set<string>();

  // 1. Validate Lines
  for (const [, line] of model.lines) {
    if (!model.terminals.has(line.bus1Id)) {
      diags.push({
        code: "PF1008",
        severity: "error",
        element: `ElmLne/${line.loc_name}`,
        message: `Line '${line.loc_name}' references unknown from-terminal '${line.bus1Id}'.`,
      });
    } else {
      connectedTerms.add(line.bus1Id);
    }

    if (!model.terminals.has(line.bus2Id)) {
      diags.push({
        code: "PF1008",
        severity: "error",
        element: `ElmLne/${line.loc_name}`,
        message: `Line '${line.loc_name}' references unknown to-terminal '${line.bus2Id}'.`,
      });
    } else {
      connectedTerms.add(line.bus2Id);
    }

    if (line.dline <= 0) {
      diags.push({
        code: "PF1002",
        severity: "warning",
        element: `ElmLne/${line.loc_name}`,
        message: `Line '${line.loc_name}' has non-positive length (${line.dline} km).`,
      });
    }

    if (!line.r1 && !line.typId) {
      diags.push({
        code: "PF1002",
        severity: "error",
        element: `ElmLne/${line.loc_name}`,
        message: `Line '${line.loc_name}' lacks explicit resistance R1 and has no type definition (typ_id).`,
      });
    }
  }

  // 2. Validate Transformers
  for (const [, tr] of model.transformers2w) {
    const hvTerm = model.terminals.get(tr.bushvId);
    const lvTerm = model.terminals.get(tr.buslvId);

    if (!hvTerm) {
      diags.push({
        code: "PF1008",
        severity: "error",
        element: `ElmTr2/${tr.loc_name}`,
        message: `Transformer '${tr.loc_name}' references unknown HV terminal '${tr.bushvId}'.`,
      });
    } else {
      connectedTerms.add(tr.bushvId);
    }

    if (!lvTerm) {
      diags.push({
        code: "PF1008",
        severity: "error",
        element: `ElmTr2/${tr.loc_name}`,
        message: `Transformer '${tr.loc_name}' references unknown LV terminal '${tr.buslvId}'.`,
      });
    } else {
      connectedTerms.add(tr.buslvId);
    }

    // Rating mismatch check
    if (hvTerm && lvTerm && tr.typId) {
      const type = model.trafo2Types.get(tr.typId);
      if (type) {
        if (Math.abs(type.utrn_h - hvTerm.uknom) / hvTerm.uknom > 0.2) {
          diags.push({
            code: "PF1003",
            severity: "warning",
            element: `ElmTr2/${tr.loc_name}`,
            message: `Transformer '${tr.loc_name}' rated HV voltage (${type.utrn_h} kV) differs by >20% from bus nominal (${hvTerm.uknom} kV).`,
          });
        }
      }
    }
  }

  // 3. Validate Generators
  for (const [, gen] of model.generators) {
    if (!model.terminals.has(gen.bus1Id)) {
      diags.push({
        code: "PF1008",
        severity: "error",
        element: `ElmSym/${gen.loc_name}`,
        message: `Generator '${gen.loc_name}' references unknown terminal '${gen.bus1Id}'.`,
      });
    } else {
      connectedTerms.add(gen.bus1Id);
    }

    if (gen.usetp < 0.8 || gen.usetp > 1.2) {
      diags.push({
        code: "PF1004",
        severity: "warning",
        element: `ElmSym/${gen.loc_name}`,
        message: `Generator '${gen.loc_name}' voltage setpoint (${gen.usetp} pu) is outside typical range [0.8, 1.2].`,
      });
    }

    const mbase = gen.sgini ?? (gen.typId ? model.symTypes.get(gen.typId)?.snom : undefined);
    if (mbase && gen.pgini > mbase) {
      diags.push({
        code: "PF1005",
        severity: "warning",
        element: `ElmSym/${gen.loc_name}`,
        message: `Generator '${gen.loc_name}' scheduled active power (${gen.pgini} MW) exceeds rated apparent power (${mbase} MVA).`,
      });
    }
  }

  // 4. Validate Loads & Switches
  for (const [, lod] of model.loads) {
    if (model.terminals.has(lod.bus1Id)) {
      connectedTerms.add(lod.bus1Id);
    }
  }
  for (const [, sw] of model.switches) {
    if (model.terminals.has(sw.bus1Id)) connectedTerms.add(sw.bus1Id);
    if (model.terminals.has(sw.bus2Id)) connectedTerms.add(sw.bus2Id);
  }

  // 5. Check for isolated or floating terminals
  for (const [id, term] of model.terminals) {
    if (!connectedTerms.has(id)) {
      diags.push({
        code: "PF1001",
        severity: "warning",
        element: `ElmTerm/${term.loc_name}`,
        message: `Terminal '${term.loc_name}' is floating and not connected to any electrical equipment.`,
      });
    }
  }

  return diags;
}
