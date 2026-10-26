// SPDX-License-Identifier: AGPL-3.0-or-later

import { FeaErrorCode } from "../errors.js";
import type { FeaModelData } from "../types.js";

export { FeaErrorCode };

export interface FeaDiagnostic {
  code: number;
  standardCode?: string | undefined;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  quickFix?: {
    title: string;
    action: string;
    replacement?: string;
  };
}

/**
 * Pre-flight static linter for FEA decks.
 */
export function lintFeaModel(model: FeaModelData): FeaDiagnostic[] {
  const diagnostics: FeaDiagnostic[] = [];

  // Check empty mesh
  if (model.elements.size === 0) {
    diagnostics.push({
      code: FeaErrorCode.EMPTY_MESH.code,
      rule: FeaErrorCode.EMPTY_MESH.rule,
      severity: FeaErrorCode.EMPTY_MESH.severity,
      message: FeaErrorCode.EMPTY_MESH.message(model.heading || "FiniteElementDeck"),
      line: 1,
      column: 1,
    });
  }

  // Check materials
  for (const [matName, mat] of model.materials.entries()) {
    if (mat.E !== undefined && mat.E <= 0) {
      diagnostics.push({
        code: FeaErrorCode.ZERO_ELASTIC_MODULUS.code,
        rule: FeaErrorCode.ZERO_ELASTIC_MODULUS.rule,
        severity: FeaErrorCode.ZERO_ELASTIC_MODULUS.severity,
        message: FeaErrorCode.ZERO_ELASTIC_MODULUS.message(matName, mat.E),
        line: 1,
        column: 1,
        quickFix: {
          title: "Set default steel Young's modulus (210 GPa)",
          action: "set_modulus",
          replacement: "2.1e11",
        },
      });
    }

    if (mat.nu !== undefined && (mat.nu >= 0.5 || mat.nu <= -1.0)) {
      diagnostics.push({
        code: FeaErrorCode.POISSON_RATIO_LIMIT.code,
        rule: FeaErrorCode.POISSON_RATIO_LIMIT.rule,
        severity: FeaErrorCode.POISSON_RATIO_LIMIT.severity,
        message: FeaErrorCode.POISSON_RATIO_LIMIT.message(matName, mat.nu),
        line: 1,
        column: 1,
        quickFix: {
          title: "Set standard Poisson's ratio (0.3)",
          action: "set_poisson",
          replacement: "0.3",
        },
      });
    }

    if (mat.yieldStrength !== undefined && mat.yieldStrength <= 0) {
      diagnostics.push({
        code: FeaErrorCode.NEGATIVE_YIELD_STRESS.code,
        rule: FeaErrorCode.NEGATIVE_YIELD_STRESS.rule,
        severity: FeaErrorCode.NEGATIVE_YIELD_STRESS.severity,
        message: FeaErrorCode.NEGATIVE_YIELD_STRESS.message(matName, mat.yieldStrength),
        line: 1,
        column: 1,
      });
    }

    if (mat.rho !== undefined && mat.rho <= 0) {
      diagnostics.push({
        code: FeaErrorCode.NEGATIVE_DENSITY.code,
        rule: FeaErrorCode.NEGATIVE_DENSITY.rule,
        severity: FeaErrorCode.NEGATIVE_DENSITY.severity,
        message: FeaErrorCode.NEGATIVE_DENSITY.message(matName, mat.rho),
        line: 1,
        column: 1,
      });
    }
  }

  // Check boundary constraints for rigid body motion
  const totalFixed = model.fixedNodes.size + (model.fixedDofs?.size ?? 0);
  if (model.elements.size > 0 && totalFixed < 3) {
    diagnostics.push({
      code: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.code,
      rule: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.rule,
      severity: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.severity,
      message: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.message(model.heading || "Structure", totalFixed),
      line: 1,
      column: 1,
    });
  }

  // Check elements for degenerate nodes
  for (const [elemId, elem] of model.elements.entries()) {
    const uniqueNodes = new Set(elem.nodes);
    if (uniqueNodes.size < elem.nodes.length) {
      diagnostics.push({
        code: FeaErrorCode.DEGENERATE_ELEMENT_NODES.code,
        rule: FeaErrorCode.DEGENERATE_ELEMENT_NODES.rule,
        severity: FeaErrorCode.DEGENERATE_ELEMENT_NODES.severity,
        message: FeaErrorCode.DEGENERATE_ELEMENT_NODES.message(elemId, elem.type),
        line: 1,
        column: 1,
      });
      break; // Only report once to avoid diagnostic flood
    }
  }

  return diagnostics;
}
