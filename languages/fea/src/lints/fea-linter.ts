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
    const matLine = model.materialLines?.get(matName) ?? 1;
    if (mat.E !== undefined && mat.E <= 0) {
      diagnostics.push({
        code: FeaErrorCode.ZERO_ELASTIC_MODULUS.code,
        rule: FeaErrorCode.ZERO_ELASTIC_MODULUS.rule,
        severity: FeaErrorCode.ZERO_ELASTIC_MODULUS.severity,
        message: FeaErrorCode.ZERO_ELASTIC_MODULUS.message(matName, mat.E),
        line: matLine,
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
        line: matLine,
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
        line: matLine,
        column: 1,
      });
    }

    if (mat.rho !== undefined && mat.rho <= 0) {
      diagnostics.push({
        code: FeaErrorCode.NEGATIVE_DENSITY.code,
        rule: FeaErrorCode.NEGATIVE_DENSITY.rule,
        severity: FeaErrorCode.NEGATIVE_DENSITY.severity,
        message: FeaErrorCode.NEGATIVE_DENSITY.message(matName, mat.rho),
        line: matLine,
        column: 1,
      });
    }

    if (mat.alpha !== undefined && mat.alpha < 0) {
      diagnostics.push({
        code: FeaErrorCode.NON_POSITIVE_THERMAL_EXPANSION.code,
        rule: FeaErrorCode.NON_POSITIVE_THERMAL_EXPANSION.rule,
        severity: FeaErrorCode.NON_POSITIVE_THERMAL_EXPANSION.severity,
        message: FeaErrorCode.NON_POSITIVE_THERMAL_EXPANSION.message(matName, mat.alpha),
        line: matLine,
        column: 1,
      });
    }
  }

  // M7410: Zero or negative shell section thickness
  if (model.sectionThickness) {
    for (const [secName, thickness] of model.sectionThickness.entries()) {
      if (thickness <= 0) {
        const secLine = model.sectionLines?.get(secName) ?? 1;
        diagnostics.push({
          code: FeaErrorCode.ZERO_THICKNESS_SHELL.code,
          rule: FeaErrorCode.ZERO_THICKNESS_SHELL.rule,
          severity: FeaErrorCode.ZERO_THICKNESS_SHELL.severity,
          message: FeaErrorCode.ZERO_THICKNESS_SHELL.message(secName),
          line: secLine,
          column: 1,
        });
      }
    }
  }

  // M7405: Missing material definition or section assignment
  if (model.elements.size > 0 && model.materials.size === 0) {
    const firstElset = model.elementSets.keys().next().value ?? "ALL_ELEMENTS";
    const firstElemId = model.elements.keys().next().value;
    const elemLine = (firstElemId !== undefined ? model.elementLines?.get(firstElemId) : undefined) ?? 1;
    diagnostics.push({
      code: FeaErrorCode.MISSING_MATERIAL_DEFINITION.code,
      rule: FeaErrorCode.MISSING_MATERIAL_DEFINITION.rule,
      severity: FeaErrorCode.MISSING_MATERIAL_DEFINITION.severity,
      message: FeaErrorCode.MISSING_MATERIAL_DEFINITION.message(firstElset),
      line: elemLine,
      column: 1,
    });
  } else if (model.elsetMaterials && model.elsetMaterials.size > 0) {
    for (const [elset, matName] of model.elsetMaterials.entries()) {
      const hasMat =
        model.materials.has(matName) ||
        Array.from(model.materials.keys()).some((k) => k.toUpperCase() === matName.toUpperCase());
      if (!hasMat) {
        const secLine = model.sectionLines?.get(elset) ?? 1;
        diagnostics.push({
          code: FeaErrorCode.MISSING_MATERIAL_DEFINITION.code,
          rule: FeaErrorCode.MISSING_MATERIAL_DEFINITION.rule,
          severity: FeaErrorCode.MISSING_MATERIAL_DEFINITION.severity,
          message: FeaErrorCode.MISSING_MATERIAL_DEFINITION.message(elset),
          line: secLine,
          column: 1,
        });
      }
    }
  }

  // Check boundary constraints for rigid body motion (M7406) & singular stiffness matrix (M7411)
  const totalFixed = model.fixedNodes.size + (model.fixedDofs?.size ?? 0);
  if (model.elements.size > 0 && totalFixed < 3) {
    const boundLine = model.boundaryLines && model.boundaryLines.length > 0 ? model.boundaryLines[0]! : 1;
    diagnostics.push({
      code: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.code,
      rule: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.rule,
      severity: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.severity,
      message: FeaErrorCode.UNCONSTRAINED_RIGID_BODY.message(model.heading || "Structure", totalFixed),
      line: boundLine,
      column: 1,
    });
  }
  if (
    model.elements.size > 0 &&
    model.nodalLoads.size > 0 &&
    totalFixed === 0 &&
    (model.displacements?.size ?? 0) === 0
  ) {
    diagnostics.push({
      code: FeaErrorCode.SINGULAR_STIFFNESS_MATRIX.code,
      rule: FeaErrorCode.SINGULAR_STIFFNESS_MATRIX.rule,
      severity: FeaErrorCode.SINGULAR_STIFFNESS_MATRIX.severity,
      message: FeaErrorCode.SINGULAR_STIFFNESS_MATRIX.message(),
      line: 1,
      column: 1,
    });
  }

  // Check elements for degenerate nodes (M7408) and inverted Jacobian determinant (M7409)
  let reportedDegenerate = false;
  for (const [elemId, elem] of model.elements.entries()) {
    const elemLine = model.elementLines?.get(elemId) ?? 1;
    const uniqueNodes = new Set(elem.nodes);
    if (uniqueNodes.size < elem.nodes.length && !reportedDegenerate) {
      reportedDegenerate = true;
      diagnostics.push({
        code: FeaErrorCode.DEGENERATE_ELEMENT_NODES.code,
        rule: FeaErrorCode.DEGENERATE_ELEMENT_NODES.rule,
        severity: FeaErrorCode.DEGENERATE_ELEMENT_NODES.severity,
        message: FeaErrorCode.DEGENERATE_ELEMENT_NODES.message(elemId, elem.type),
        line: elemLine,
        column: 1,
      });
    }

    // M7409: Inverted Jacobian determinant or coincident vertex coordinates
    let isInverted = false;
    if (elem.nodes.length >= 2) {
      const n1 = model.nodes.get(elem.nodes[0]!);
      const n2 = model.nodes.get(elem.nodes[1]!);
      if (n1 && n2 && n1.x === n2.x && n1.y === n2.y && n1.z === n2.z && elem.nodes[0] !== elem.nodes[1]) {
        isInverted = true;
      }
    }
    if (!isInverted && elem.nodes.length >= 4) {
      const n1 = model.nodes.get(elem.nodes[0]!);
      const n2 = model.nodes.get(elem.nodes[1]!);
      const n3 = model.nodes.get(elem.nodes[2]!);
      const n4 = model.nodes.get(elem.nodes[3]!);
      if (n1 && n2 && n3 && n4) {
        const ax = n2.x - n1.x;
        const ay = n2.y - n1.y;
        const az = n2.z - n1.z;
        const bx = n3.x - n1.x;
        const by = n3.y - n1.y;
        const bz = n3.z - n1.z;
        const cx = n4.x - n1.x;
        const cy = n4.y - n1.y;
        const cz = n4.z - n1.z;
        const det3D = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
        if (det3D < -1e-12) {
          isInverted = true;
        }
      }
    } else if (!isInverted && elem.nodes.length === 3) {
      const n1 = model.nodes.get(elem.nodes[0]!);
      const n2 = model.nodes.get(elem.nodes[1]!);
      const n3 = model.nodes.get(elem.nodes[2]!);
      if (n1 && n2 && n3 && n1.z === 0 && n2.z === 0 && n3.z === 0) {
        const area2D = (n2.x - n1.x) * (n3.y - n1.y) - (n2.y - n1.y) * (n3.x - n1.x);
        if (area2D <= 0) {
          isInverted = true;
        }
      }
    }

    if (isInverted) {
      diagnostics.push({
        code: FeaErrorCode.INVERTED_JACOBIAN_ELEMENT.code,
        rule: FeaErrorCode.INVERTED_JACOBIAN_ELEMENT.rule,
        severity: FeaErrorCode.INVERTED_JACOBIAN_ELEMENT.severity,
        message: FeaErrorCode.INVERTED_JACOBIAN_ELEMENT.message(elemId),
        line: elemLine,
        column: 1,
      });
    }
  }

  return diagnostics;
}
