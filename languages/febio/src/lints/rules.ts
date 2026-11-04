// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Biomechanics, Continuum Mechanics & SOFA Scene Graph Linter.
 *
 * Implements diagnostic rules M9401–M9410:
 * - M9401 (febio-invalid-material-constant): Hyperelastic/elastic material constant is non-physical (E <= 0, v <= -1 or v >= 0.5, density <= 0, or c1 + c2 <= 0).
 * - M9402 (febio-inverted-element-jacobian): 4-node tetrahedral (tet4) or 8-node hexahedral (hex8) element has non-positive signed volume / Jacobian determinant (det(J) <= 0).
 * - M9403 (febio-unresolved-node-or-set): Element connectivity, boundary condition, or load references an undefined node ID, <NodeSet>, or <Surface>.
 * - M9404 (febio-unconstrained-rigid-body): Model has no fixed/prescribed displacement boundary conditions to prevent rigid-body motion.
 * - M9405 (febio-invalid-biphasic-permeability): Biphasic/poroelastic tissue material specifies hydraulic permeability k <= 0 or solid volume fraction phi^s not in (0, 1).
 * - M9406 (febio-invalid-time-stepper): <Control> specifies time_steps <= 0 or step_size <= 0.
 * - M9407 (febio-unresolved-material-id): <SolidDomain> or element block references an undeclared mat material ID.
 * - M9408 (febio-contact-penalty-invalid): Sliding/tied contact interface specifies non-positive penalty factor (<= 0) or empty primary/secondary surface.
 * - M9409 (febio-sofa-missing-mechanical-object): SOFA .scn <Node> with a <TetrahedronFEMForceField> or <MassSpringForceField> lacks a <MechanicalObject> state container.
 * - M9410 (febio-duplicate-entity-id): Duplicate node, element, or material ID.
 */

import type { FebioDiagnostic, FebioDocument, FebioElement, FebioMaterial, FebioNode, FebioSurface } from "../types.js";

export const FebioErrorCode = {
  INVALID_MATERIAL_CONSTANT: {
    code: "M9401",
    rule: "febio-invalid-material-constant",
    severity: "error" as const,
    message: (materialName: string, paramDesc: string) =>
      `Non-physical material constant ${paramDesc} in material '${materialName}'.`,
  },
  INVERTED_ELEMENT_JACOBIAN: {
    code: "M9402",
    rule: "febio-inverted-element-jacobian",
    severity: "error" as const,
    message: (elemId: string, elemType: string, detJ: string) =>
      `Element '${elemId}' (${elemType}) has non-positive Jacobian determinant det(J) = '${detJ}'.`,
  },
  UNRESOLVED_NODE_OR_SET: {
    code: "M9403",
    rule: "febio-unresolved-node-or-set",
    severity: "error" as const,
    message: (refKind: string, refId: string, contextName: string) =>
      `Unresolved ${refKind} reference '${refId}' in '${contextName}'.`,
  },
  UNCONSTRAINED_RIGID_BODY: {
    code: "M9404",
    rule: "febio-unconstrained-rigid-body",
    severity: "warning" as const,
    message: (modelTitle: string) =>
      `Model '${modelTitle}' has no fixed or prescribed displacement boundary conditions to prevent rigid-body motion.`,
  },
  INVALID_BIPHASIC_PERMEABILITY: {
    code: "M9405",
    rule: "febio-invalid-biphasic-permeability",
    severity: "error" as const,
    message: (materialName: string, reason: string) =>
      `Invalid biphasic/poroelastic parameter (${reason}) in material '${materialName}'.`,
  },
  INVALID_TIME_STEPPER: {
    code: "M9406",
    rule: "febio-invalid-time-stepper",
    severity: "error" as const,
    message: (timeSteps: number, stepSize: number) =>
      `Invalid <Control> time-stepper configuration: time_steps='${timeSteps}', step_size='${stepSize}' (both must be > 0).`,
  },
  UNRESOLVED_MATERIAL_ID: {
    code: "M9407",
    rule: "febio-unresolved-material-id",
    severity: "error" as const,
    message: (matId: string, contextName: string) =>
      `Unresolved material ID '${matId}' referenced in '${contextName}'.`,
  },
  CONTACT_PENALTY_INVALID: {
    code: "M9408",
    rule: "febio-contact-penalty-invalid",
    severity: "error" as const,
    message: (contactName: string, detail: string) =>
      `Contact interface '${contactName}' has invalid configuration: ${detail}.`,
  },
  SOFA_MISSING_MECHANICAL_OBJECT: {
    code: "M9409",
    rule: "febio-sofa-missing-mechanical-object",
    severity: "error" as const,
    message: (nodeName: string, forceFieldType: string) =>
      `SOFA <Node> '${nodeName}' contains '<${forceFieldType}>' without a '<MechanicalObject>' state container.`,
  },
  DUPLICATE_ENTITY_ID: {
    code: "M9410",
    rule: "febio-duplicate-entity-id",
    severity: "error" as const,
    message: (entityKind: string, id: string) => `Duplicate ${entityKind} identifier '${id}'.`,
  },
};

/**
 * Computes the Jacobian determinant det(J) of a 3D finite element (`tet4` or `hex8`).
 * For `tet4`: det(J) = (x1 - x0) . ((x2 - x0) x (x3 - x0)), signed volume V = det(J) / 6.
 * For `hex8`: det(J) evaluated at the principal corner triad (x1 - x0) . ((x3 - x0) x (x4 - x0)).
 */
export function computeElementJacobianDeterminant(
  elem: FebioElement,
  nodeById: ReadonlyMap<string, FebioNode>,
): number | null {
  if (elem.type === "tet4") {
    if (elem.nodeIds.length < 4) return null;
    const n0 = nodeById.get(elem.nodeIds[0]!);
    const n1 = nodeById.get(elem.nodeIds[1]!);
    const n2 = nodeById.get(elem.nodeIds[2]!);
    const n3 = nodeById.get(elem.nodeIds[3]!);
    if (!n0 || !n1 || !n2 || !n3) return null;

    const ax = n1.x - n0.x;
    const ay = n1.y - n0.y;
    const az = n1.z - n0.z;

    const bx = n2.x - n0.x;
    const by = n2.y - n0.y;
    const bz = n2.z - n0.z;

    const cx = n3.x - n0.x;
    const cy = n3.y - n0.y;
    const cz = n3.z - n0.z;

    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;

    return ax * crossX + ay * crossY + az * crossZ;
  }

  if (elem.type === "hex8") {
    if (elem.nodeIds.length < 8) return null;
    const n0 = nodeById.get(elem.nodeIds[0]!);
    const n1 = nodeById.get(elem.nodeIds[1]!);
    const n3 = nodeById.get(elem.nodeIds[3]!);
    const n4 = nodeById.get(elem.nodeIds[4]!);
    if (!n0 || !n1 || !n3 || !n4) return null;

    const ax = n1.x - n0.x;
    const ay = n1.y - n0.y;
    const az = n1.z - n0.z;

    const bx = n3.x - n0.x;
    const by = n3.y - n0.y;
    const bz = n3.z - n0.z;

    const cx = n4.x - n0.x;
    const cy = n4.y - n0.y;
    const cz = n4.z - n0.z;

    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;

    return ax * crossX + ay * crossY + az * crossZ;
  }

  return null;
}

/**
 * Computes the signed volume of a 3D element (`tet4` or `hex8`).
 */
export function computeElementSignedVolume(
  elem: FebioElement,
  nodeById: ReadonlyMap<string, FebioNode>,
): number | null {
  const detJ = computeElementJacobianDeterminant(elem, nodeById);
  if (detJ === null) return null;
  return elem.type === "tet4" ? detJ / 6.0 : detJ;
}

export function lintFebioDocument(doc: FebioDocument): FebioDiagnostic[] {
  const diagnostics: FebioDiagnostic[] = [];

  // ───────────────────────────────────────────────────────────────────────────
  // 1. M9410: Duplicate entity IDs (materials, nodes, elements, nodeSets, surfaces)
  // ───────────────────────────────────────────────────────────────────────────
  const seenMatIds = new Set<string>();
  const matById = new Map<string, FebioMaterial>();
  for (const mat of doc.materials) {
    if (seenMatIds.has(mat.id)) {
      diagnostics.push({
        code: FebioErrorCode.DUPLICATE_ENTITY_ID.code,
        rule: FebioErrorCode.DUPLICATE_ENTITY_ID.rule,
        severity: FebioErrorCode.DUPLICATE_ENTITY_ID.severity,
        message: FebioErrorCode.DUPLICATE_ENTITY_ID.message("material", mat.id),
        range: mat.range,
      });
    } else {
      seenMatIds.add(mat.id);
    }
    matById.set(mat.id, mat);
    if (mat.name) matById.set(mat.name, mat);
  }

  const seenNodeIds = new Set<string>();
  const nodeById = new Map<string, FebioNode>();
  for (const node of doc.nodes) {
    if (seenNodeIds.has(node.id)) {
      diagnostics.push({
        code: FebioErrorCode.DUPLICATE_ENTITY_ID.code,
        rule: FebioErrorCode.DUPLICATE_ENTITY_ID.rule,
        severity: FebioErrorCode.DUPLICATE_ENTITY_ID.severity,
        message: FebioErrorCode.DUPLICATE_ENTITY_ID.message("node", node.id),
        range: node.range,
      });
    } else {
      seenNodeIds.add(node.id);
    }
    nodeById.set(node.id, node);
  }

  const seenElemIds = new Set<string>();
  for (const elem of doc.elements) {
    if (seenElemIds.has(elem.id)) {
      diagnostics.push({
        code: FebioErrorCode.DUPLICATE_ENTITY_ID.code,
        rule: FebioErrorCode.DUPLICATE_ENTITY_ID.rule,
        severity: FebioErrorCode.DUPLICATE_ENTITY_ID.severity,
        message: FebioErrorCode.DUPLICATE_ENTITY_ID.message("element", elem.id),
        range: elem.range,
      });
    } else {
      seenElemIds.add(elem.id);
    }
  }

  const nodeSetByName = new Map<string, (typeof doc.nodeSets)[number]>();
  for (const ns of doc.nodeSets) {
    nodeSetByName.set(ns.name, ns);
  }

  const surfaceByName = new Map<string, FebioSurface>();
  for (const surf of doc.surfaces) {
    surfaceByName.set(surf.name, surf);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. M9401 & M9405: Material Constants & Biphasic Permeability Validation
  // ───────────────────────────────────────────────────────────────────────────
  for (const mat of doc.materials) {
    if (mat.E !== undefined && mat.E <= 0) {
      diagnostics.push({
        code: FebioErrorCode.INVALID_MATERIAL_CONSTANT.code,
        rule: FebioErrorCode.INVALID_MATERIAL_CONSTANT.rule,
        severity: FebioErrorCode.INVALID_MATERIAL_CONSTANT.severity,
        message: FebioErrorCode.INVALID_MATERIAL_CONSTANT.message(mat.name || mat.id, `E='${mat.E}' (must be > 0)`),
        range: mat.range,
      });
    }
    if (mat.v !== undefined && (mat.v <= -1.0 || mat.v >= 0.5)) {
      diagnostics.push({
        code: FebioErrorCode.INVALID_MATERIAL_CONSTANT.code,
        rule: FebioErrorCode.INVALID_MATERIAL_CONSTANT.rule,
        severity: FebioErrorCode.INVALID_MATERIAL_CONSTANT.severity,
        message: FebioErrorCode.INVALID_MATERIAL_CONSTANT.message(
          mat.name || mat.id,
          `v='${mat.v}' (Poisson ratio must be in (-1, 0.5))`,
        ),
        range: mat.range,
      });
    }
    if (mat.density !== undefined && mat.density <= 0) {
      diagnostics.push({
        code: FebioErrorCode.INVALID_MATERIAL_CONSTANT.code,
        rule: FebioErrorCode.INVALID_MATERIAL_CONSTANT.rule,
        severity: FebioErrorCode.INVALID_MATERIAL_CONSTANT.severity,
        message: FebioErrorCode.INVALID_MATERIAL_CONSTANT.message(
          mat.name || mat.id,
          `density='${mat.density}' (must be > 0)`,
        ),
        range: mat.range,
      });
    }
    if (mat.k !== undefined && mat.k <= 0) {
      diagnostics.push({
        code: FebioErrorCode.INVALID_MATERIAL_CONSTANT.code,
        rule: FebioErrorCode.INVALID_MATERIAL_CONSTANT.rule,
        severity: FebioErrorCode.INVALID_MATERIAL_CONSTANT.severity,
        message: FebioErrorCode.INVALID_MATERIAL_CONSTANT.message(
          mat.name || mat.id,
          `bulk modulus k='${mat.k}' (must be > 0)`,
        ),
        range: mat.range,
      });
    }
    if (mat.c1 !== undefined || mat.c2 !== undefined) {
      const c1 = mat.c1 ?? 0;
      const c2 = mat.c2 ?? 0;
      if (c1 + c2 <= 0) {
        diagnostics.push({
          code: FebioErrorCode.INVALID_MATERIAL_CONSTANT.code,
          rule: FebioErrorCode.INVALID_MATERIAL_CONSTANT.rule,
          severity: FebioErrorCode.INVALID_MATERIAL_CONSTANT.severity,
          message: FebioErrorCode.INVALID_MATERIAL_CONSTANT.message(
            mat.name || mat.id,
            `c1 + c2 = '${c1 + c2}' (Mooney-Rivlin / neo-Hookean shear stiffness must be > 0)`,
          ),
          range: mat.range,
        });
      }
    }

    // M9405: Biphasic / poroelastic permeability & solid volume fraction
    const isBiphasic =
      mat.type.toLowerCase().includes("biphasic") ||
      mat.type.toLowerCase().includes("poroelastic") ||
      mat.perm !== undefined ||
      mat.phi0 !== undefined;
    if (isBiphasic) {
      if (mat.perm !== undefined && mat.perm <= 0) {
        diagnostics.push({
          code: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.code,
          rule: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.rule,
          severity: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.severity,
          message: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.message(
            mat.name || mat.id,
            `hydraulic permeability perm='${mat.perm}' <= 0`,
          ),
          range: mat.range,
        });
      }
      if (mat.phi0 !== undefined && (mat.phi0 <= 0 || mat.phi0 >= 1)) {
        diagnostics.push({
          code: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.code,
          rule: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.rule,
          severity: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.severity,
          message: FebioErrorCode.INVALID_BIPHASIC_PERMEABILITY.message(
            mat.name || mat.id,
            `solid volume fraction phi0='${mat.phi0}' outside (0, 1)`,
          ),
          range: mat.range,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. M9402, M9403, M9407: Elements (connectivity, material ID, Jacobian det(J))
  // ───────────────────────────────────────────────────────────────────────────
  for (const elem of doc.elements) {
    if (elem.materialId !== undefined && !matById.has(elem.materialId)) {
      diagnostics.push({
        code: FebioErrorCode.UNRESOLVED_MATERIAL_ID.code,
        rule: FebioErrorCode.UNRESOLVED_MATERIAL_ID.rule,
        severity: FebioErrorCode.UNRESOLVED_MATERIAL_ID.severity,
        message: FebioErrorCode.UNRESOLVED_MATERIAL_ID.message(
          elem.materialId,
          `Element '${elem.id}' (${elem.domainName ?? elem.type})`,
        ),
        range: elem.range,
      });
    }

    let allNodesResolved = true;
    for (const nid of elem.nodeIds) {
      if (!nodeById.has(nid)) {
        allNodesResolved = false;
        diagnostics.push({
          code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
          rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
          severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
          message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message("node", nid, `Element '${elem.id}'`),
          range: elem.range,
        });
      }
    }

    if (allNodesResolved && (elem.type === "tet4" || elem.type === "hex8")) {
      const detJ = computeElementJacobianDeterminant(elem, nodeById);
      if (detJ !== null && detJ <= 1e-12) {
        diagnostics.push({
          code: FebioErrorCode.INVERTED_ELEMENT_JACOBIAN.code,
          rule: FebioErrorCode.INVERTED_ELEMENT_JACOBIAN.rule,
          severity: FebioErrorCode.INVERTED_ELEMENT_JACOBIAN.severity,
          message: FebioErrorCode.INVERTED_ELEMENT_JACOBIAN.message(elem.id, elem.type, detJ.toFixed(6)),
          range: elem.range,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. M9407: SolidDomain material reference check
  // ───────────────────────────────────────────────────────────────────────────
  for (const dom of doc.solidDomains) {
    if (!matById.has(dom.materialId)) {
      diagnostics.push({
        code: FebioErrorCode.UNRESOLVED_MATERIAL_ID.code,
        rule: FebioErrorCode.UNRESOLVED_MATERIAL_ID.rule,
        severity: FebioErrorCode.UNRESOLVED_MATERIAL_ID.severity,
        message: FebioErrorCode.UNRESOLVED_MATERIAL_ID.message(dom.materialId, `SolidDomain '${dom.name}'`),
        range: dom.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. M9403: NodeSet, Surface, BoundaryCondition, and Load references
  // ───────────────────────────────────────────────────────────────────────────
  for (const ns of doc.nodeSets) {
    for (const nid of ns.nodeIds) {
      if (!nodeById.has(nid)) {
        diagnostics.push({
          code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
          rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
          severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
          message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message("node", nid, `NodeSet '${ns.name}'`),
          range: ns.range,
        });
      }
    }
  }

  for (const surf of doc.surfaces) {
    for (const facet of surf.facets) {
      for (const nid of facet.nodeIds) {
        if (!nodeById.has(nid)) {
          diagnostics.push({
            code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
            rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
            severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
            message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message(
              "node",
              nid,
              `Surface '${surf.name}' facet '${facet.id}'`,
            ),
            range: facet.range,
          });
        }
      }
    }
  }

  for (const bc of doc.boundaryConditions) {
    if (bc.nodeSet && !nodeSetByName.has(bc.nodeSet) && !surfaceByName.has(bc.nodeSet)) {
      diagnostics.push({
        code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
        rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
        severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
        message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message(
          "NodeSet",
          bc.nodeSet,
          `BoundaryCondition '${bc.name || bc.id}'`,
        ),
        range: bc.range,
      });
    }
  }

  for (const load of doc.loads) {
    if (load.surface && !surfaceByName.has(load.surface)) {
      diagnostics.push({
        code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
        rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
        severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
        message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message(
          "Surface",
          load.surface,
          `Load '${load.name || load.id}'`,
        ),
        range: load.range,
      });
    }
    if (load.nodeSet && !nodeSetByName.has(load.nodeSet)) {
      diagnostics.push({
        code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
        rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
        severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
        message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message(
          "NodeSet",
          load.nodeSet,
          `Load '${load.name || load.id}'`,
        ),
        range: load.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. M9404: Unconstrained Rigid Body Detection
  // ───────────────────────────────────────────────────────────────────────────
  const hasMeshOrSofaMechanics =
    doc.nodes.length > 0 || doc.elements.length > 0 || doc.sofaNodes.some((sn) => sn.forceFields.length > 0);
  const hasConstraint = doc.boundaryConditions.length > 0 || doc.sofaNodes.some((sn) => sn.hasFixedConstraint);
  if (hasMeshOrSofaMechanics && !hasConstraint) {
    diagnostics.push({
      code: FebioErrorCode.UNCONSTRAINED_RIGID_BODY.code,
      rule: FebioErrorCode.UNCONSTRAINED_RIGID_BODY.rule,
      severity: FebioErrorCode.UNCONSTRAINED_RIGID_BODY.severity,
      message: FebioErrorCode.UNCONSTRAINED_RIGID_BODY.message(doc.title || "FEBioModel"),
      range: doc.range,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. M9406: Control Time-Stepper Validation
  // ───────────────────────────────────────────────────────────────────────────
  if (doc.control) {
    if (doc.control.timeSteps <= 0 || doc.control.stepSize <= 0) {
      diagnostics.push({
        code: FebioErrorCode.INVALID_TIME_STEPPER.code,
        rule: FebioErrorCode.INVALID_TIME_STEPPER.rule,
        severity: FebioErrorCode.INVALID_TIME_STEPPER.severity,
        message: FebioErrorCode.INVALID_TIME_STEPPER.message(doc.control.timeSteps, doc.control.stepSize),
        range: doc.control.range,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. M9408: Contact Interface Penalty & Surface Validation
  // ───────────────────────────────────────────────────────────────────────────
  for (const contact of doc.contacts) {
    if (contact.penalty <= 0) {
      diagnostics.push({
        code: FebioErrorCode.CONTACT_PENALTY_INVALID.code,
        rule: FebioErrorCode.CONTACT_PENALTY_INVALID.rule,
        severity: FebioErrorCode.CONTACT_PENALTY_INVALID.severity,
        message: FebioErrorCode.CONTACT_PENALTY_INVALID.message(
          contact.name || contact.id,
          `penalty factor '${contact.penalty}' must be > 0`,
        ),
        range: contact.range,
      });
    }
    const primSurf = contact.primarySurface ? surfaceByName.get(contact.primarySurface) : undefined;
    const secSurf = contact.secondarySurface ? surfaceByName.get(contact.secondarySurface) : undefined;
    if (!contact.primarySurface || !contact.secondarySurface) {
      diagnostics.push({
        code: FebioErrorCode.CONTACT_PENALTY_INVALID.code,
        rule: FebioErrorCode.CONTACT_PENALTY_INVALID.rule,
        severity: FebioErrorCode.CONTACT_PENALTY_INVALID.severity,
        message: FebioErrorCode.CONTACT_PENALTY_INVALID.message(
          contact.name || contact.id,
          "primary or secondary contact surface is empty",
        ),
        range: contact.range,
      });
    } else {
      if (!primSurf) {
        diagnostics.push({
          code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
          rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
          severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
          message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message(
            "Surface",
            contact.primarySurface,
            `Contact '${contact.name || contact.id}'`,
          ),
          range: contact.range,
        });
      } else if (primSurf.facets.length === 0) {
        diagnostics.push({
          code: FebioErrorCode.CONTACT_PENALTY_INVALID.code,
          rule: FebioErrorCode.CONTACT_PENALTY_INVALID.rule,
          severity: FebioErrorCode.CONTACT_PENALTY_INVALID.severity,
          message: FebioErrorCode.CONTACT_PENALTY_INVALID.message(
            contact.name || contact.id,
            `primary surface '${contact.primarySurface}' has 0 facets`,
          ),
          range: contact.range,
        });
      }
      if (!secSurf) {
        diagnostics.push({
          code: FebioErrorCode.UNRESOLVED_NODE_OR_SET.code,
          rule: FebioErrorCode.UNRESOLVED_NODE_OR_SET.rule,
          severity: FebioErrorCode.UNRESOLVED_NODE_OR_SET.severity,
          message: FebioErrorCode.UNRESOLVED_NODE_OR_SET.message(
            "Surface",
            contact.secondarySurface,
            `Contact '${contact.name || contact.id}'`,
          ),
          range: contact.range,
        });
      } else if (secSurf.facets.length === 0) {
        diagnostics.push({
          code: FebioErrorCode.CONTACT_PENALTY_INVALID.code,
          rule: FebioErrorCode.CONTACT_PENALTY_INVALID.rule,
          severity: FebioErrorCode.CONTACT_PENALTY_INVALID.severity,
          message: FebioErrorCode.CONTACT_PENALTY_INVALID.message(
            contact.name || contact.id,
            `secondary surface '${contact.secondarySurface}' has 0 facets`,
          ),
          range: contact.range,
        });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. M9409: SOFA Scene Graph <MechanicalObject> State Container Check
  // ───────────────────────────────────────────────────────────────────────────
  for (const sNode of doc.sofaNodes) {
    if (sNode.forceFields.length > 0 && !sNode.hasMechanicalObject) {
      const firstFf = sNode.forceFields[0]!;
      diagnostics.push({
        code: FebioErrorCode.SOFA_MISSING_MECHANICAL_OBJECT.code,
        rule: FebioErrorCode.SOFA_MISSING_MECHANICAL_OBJECT.rule,
        severity: FebioErrorCode.SOFA_MISSING_MECHANICAL_OBJECT.severity,
        message: FebioErrorCode.SOFA_MISSING_MECHANICAL_OBJECT.message(sNode.name, firstFf.type),
        range: sNode.range,
      });
    }
  }

  return diagnostics;
}
