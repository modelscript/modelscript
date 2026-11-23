// SPDX-License-Identifier: AGPL-3.0-or-later

import { LsDynaErrorCode } from "../errors.js";
import { computeCflAnalysis } from "../solver/explicit-solver.js";
import type { LsDynaDeck } from "../types.js";

export interface LsDynaDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
}

/**
 * Runs static semantic, structural, material, and CFL timestep validation
 * (`LSD1001`–`LSD5006`) on a parsed LS-DYNA keyword deck.
 */
export function lintLsDynaDeck(deck: LsDynaDeck): LsDynaDiagnostic[] {
  const diags: LsDynaDiagnostic[] = [];

  // 1. Parse / syntax errors (LSD1001)
  for (const err of deck.parseErrors) {
    diags.push({
      id: LsDynaErrorCode.SYNTAX_ERROR.stdCode,
      code: LsDynaErrorCode.SYNTAX_ERROR.code,
      rule: LsDynaErrorCode.SYNTAX_ERROR.rule,
      severity: LsDynaErrorCode.SYNTAX_ERROR.severity,
      message: LsDynaErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // 2. Missing *KEYWORD / *END (LSD1002, LSD1003)
  if (!deck.hasKeywordHeader) {
    diags.push({
      id: LsDynaErrorCode.MISSING_KEYWORD_HEADER.stdCode,
      code: LsDynaErrorCode.MISSING_KEYWORD_HEADER.code,
      rule: LsDynaErrorCode.MISSING_KEYWORD_HEADER.rule,
      severity: LsDynaErrorCode.MISSING_KEYWORD_HEADER.severity,
      message: LsDynaErrorCode.MISSING_KEYWORD_HEADER.message(),
      line: 1,
      column: 1,
    });
  }
  if (!deck.hasEndCard) {
    diags.push({
      id: LsDynaErrorCode.MISSING_END_CARD.stdCode,
      code: LsDynaErrorCode.MISSING_END_CARD.code,
      rule: LsDynaErrorCode.MISSING_END_CARD.rule,
      severity: LsDynaErrorCode.MISSING_END_CARD.severity,
      message: LsDynaErrorCode.MISSING_END_CARD.message(),
      line: 1,
      column: 1,
    });
  }

  // 3. Duplicate IDs (LSD2001–LSD2005)
  for (const dup of deck.duplicates) {
    if (dup.kind === "node") {
      diags.push({
        id: LsDynaErrorCode.DUPLICATE_NODE_ID.stdCode,
        code: LsDynaErrorCode.DUPLICATE_NODE_ID.code,
        rule: LsDynaErrorCode.DUPLICATE_NODE_ID.rule,
        severity: LsDynaErrorCode.DUPLICATE_NODE_ID.severity,
        message: LsDynaErrorCode.DUPLICATE_NODE_ID.message(dup.id),
        line: dup.line,
        column: 1,
      });
    } else if (dup.kind === "element") {
      diags.push({
        id: LsDynaErrorCode.DUPLICATE_ELEMENT_ID.stdCode,
        code: LsDynaErrorCode.DUPLICATE_ELEMENT_ID.code,
        rule: LsDynaErrorCode.DUPLICATE_ELEMENT_ID.rule,
        severity: LsDynaErrorCode.DUPLICATE_ELEMENT_ID.severity,
        message: LsDynaErrorCode.DUPLICATE_ELEMENT_ID.message(dup.id),
        line: dup.line,
        column: 1,
      });
    } else if (dup.kind === "part") {
      diags.push({
        id: LsDynaErrorCode.DUPLICATE_PART_ID.stdCode,
        code: LsDynaErrorCode.DUPLICATE_PART_ID.code,
        rule: LsDynaErrorCode.DUPLICATE_PART_ID.rule,
        severity: LsDynaErrorCode.DUPLICATE_PART_ID.severity,
        message: LsDynaErrorCode.DUPLICATE_PART_ID.message(dup.id),
        line: dup.line,
        column: 1,
      });
    } else if (dup.kind === "material") {
      diags.push({
        id: LsDynaErrorCode.DUPLICATE_MATERIAL_ID.stdCode,
        code: LsDynaErrorCode.DUPLICATE_MATERIAL_ID.code,
        rule: LsDynaErrorCode.DUPLICATE_MATERIAL_ID.rule,
        severity: LsDynaErrorCode.DUPLICATE_MATERIAL_ID.severity,
        message: LsDynaErrorCode.DUPLICATE_MATERIAL_ID.message(dup.id),
        line: dup.line,
        column: 1,
      });
    } else if (dup.kind === "section") {
      diags.push({
        id: LsDynaErrorCode.DUPLICATE_SECTION_ID.stdCode,
        code: LsDynaErrorCode.DUPLICATE_SECTION_ID.code,
        rule: LsDynaErrorCode.DUPLICATE_SECTION_ID.rule,
        severity: LsDynaErrorCode.DUPLICATE_SECTION_ID.severity,
        message: LsDynaErrorCode.DUPLICATE_SECTION_ID.message(dup.id),
        line: dup.line,
        column: 1,
      });
    }
  }

  // 4. Empty mesh check (LSD5004)
  if (deck.nodes.size === 0 || deck.elements.size === 0) {
    diags.push({
      id: LsDynaErrorCode.EMPTY_MESH.stdCode,
      code: LsDynaErrorCode.EMPTY_MESH.code,
      rule: LsDynaErrorCode.EMPTY_MESH.rule,
      severity: LsDynaErrorCode.EMPTY_MESH.severity,
      message: LsDynaErrorCode.EMPTY_MESH.message(),
      line: 1,
      column: 1,
    });
  }

  // 5. Referential integrity: elements -> nodes & parts (LSD3001, LSD3002)
  for (const el of deck.elements.values()) {
    const line = el.loc?.line ?? 1;
    if (!deck.parts.has(el.pid)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_ELEMENT_PART.stdCode,
        code: LsDynaErrorCode.UNDEFINED_ELEMENT_PART.code,
        rule: LsDynaErrorCode.UNDEFINED_ELEMENT_PART.rule,
        severity: LsDynaErrorCode.UNDEFINED_ELEMENT_PART.severity,
        message: LsDynaErrorCode.UNDEFINED_ELEMENT_PART.message(el.eid, el.pid),
        line,
        column: 1,
      });
    }
    for (const nid of el.nodes) {
      if (!deck.nodes.has(nid)) {
        diags.push({
          id: LsDynaErrorCode.UNDEFINED_ELEMENT_NODE.stdCode,
          code: LsDynaErrorCode.UNDEFINED_ELEMENT_NODE.code,
          rule: LsDynaErrorCode.UNDEFINED_ELEMENT_NODE.rule,
          severity: LsDynaErrorCode.UNDEFINED_ELEMENT_NODE.severity,
          message: LsDynaErrorCode.UNDEFINED_ELEMENT_NODE.message(el.eid, nid),
          line,
          column: 1,
        });
      }
    }
  }

  // 6. Referential integrity: parts -> sections & materials (LSD3003, LSD3004)
  for (const part of deck.parts.values()) {
    const line = part.loc?.line ?? 1;
    if (!deck.sections.has(part.secid)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_PART_SECTION.stdCode,
        code: LsDynaErrorCode.UNDEFINED_PART_SECTION.code,
        rule: LsDynaErrorCode.UNDEFINED_PART_SECTION.rule,
        severity: LsDynaErrorCode.UNDEFINED_PART_SECTION.severity,
        message: LsDynaErrorCode.UNDEFINED_PART_SECTION.message(part.pid, part.secid),
        line,
        column: 1,
      });
    }
    if (!deck.materials.has(part.mid)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_PART_MATERIAL.stdCode,
        code: LsDynaErrorCode.UNDEFINED_PART_MATERIAL.code,
        rule: LsDynaErrorCode.UNDEFINED_PART_MATERIAL.rule,
        severity: LsDynaErrorCode.UNDEFINED_PART_MATERIAL.severity,
        message: LsDynaErrorCode.UNDEFINED_PART_MATERIAL.message(part.pid, part.mid),
        line,
        column: 1,
      });
    }
  }

  // 7. Boundary / load target references (LSD3005)
  for (const spc of deck.boundaries) {
    const line = spc.loc?.line ?? 1;
    if (spc.targetType === "NODE" && !deck.nodes.has(spc.targetId)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.stdCode,
        code: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.code,
        rule: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.rule,
        severity: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.severity,
        message: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.message("*BOUNDARY_SPC_NODE", "node", spc.targetId),
        line,
        column: 1,
      });
    } else if (spc.targetType === "SET" && !deck.nodeSets.has(spc.targetId)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.stdCode,
        code: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.code,
        rule: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.rule,
        severity: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.severity,
        message: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.message("*BOUNDARY_SPC_SET", "node set", spc.targetId),
        line,
        column: 1,
      });
    }
  }
  for (const load of deck.loads) {
    const line = load.loc?.line ?? 1;
    if (!deck.nodes.has(load.nid)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.stdCode,
        code: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.code,
        rule: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.rule,
        severity: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.severity,
        message: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.message("*LOAD_NODE_POINT", "node", load.nid),
        line,
        column: 1,
      });
    }
    if (load.lcid > 0 && !deck.curves.has(load.lcid)) {
      diags.push({
        id: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.stdCode,
        code: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.code,
        rule: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.rule,
        severity: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.severity,
        message: LsDynaErrorCode.UNDEFINED_BC_OR_LOAD_TARGET.message("*LOAD_NODE_POINT", "curve", load.lcid),
        line,
        column: 1,
      });
    }
  }

  // 8. Material physical bounds (LSD4001–LSD4003, LSD5006)
  for (const mat of deck.materials.values()) {
    const line = mat.loc?.line ?? 1;
    if (!(mat.e > 0)) {
      diags.push({
        id: LsDynaErrorCode.NON_POSITIVE_YOUNGS_MODULUS.stdCode,
        code: LsDynaErrorCode.NON_POSITIVE_YOUNGS_MODULUS.code,
        rule: LsDynaErrorCode.NON_POSITIVE_YOUNGS_MODULUS.rule,
        severity: LsDynaErrorCode.NON_POSITIVE_YOUNGS_MODULUS.severity,
        message: LsDynaErrorCode.NON_POSITIVE_YOUNGS_MODULUS.message(mat.mid, mat.e),
        line,
        column: 1,
      });
    }
    if (!(mat.ro > 0)) {
      diags.push({
        id: LsDynaErrorCode.NON_POSITIVE_DENSITY.stdCode,
        code: LsDynaErrorCode.NON_POSITIVE_DENSITY.code,
        rule: LsDynaErrorCode.NON_POSITIVE_DENSITY.rule,
        severity: LsDynaErrorCode.NON_POSITIVE_DENSITY.severity,
        message: LsDynaErrorCode.NON_POSITIVE_DENSITY.message(mat.mid, mat.ro),
        line,
        column: 1,
      });
    }
    if (!(mat.pr > -1.0 && mat.pr < 0.5)) {
      diags.push({
        id: LsDynaErrorCode.INVALID_POISSON_RATIO.stdCode,
        code: LsDynaErrorCode.INVALID_POISSON_RATIO.code,
        rule: LsDynaErrorCode.INVALID_POISSON_RATIO.rule,
        severity: LsDynaErrorCode.INVALID_POISSON_RATIO.severity,
        message: LsDynaErrorCode.INVALID_POISSON_RATIO.message(mat.mid, mat.pr),
        line,
        column: 1,
      });
    }
    if (mat.type === "MAT_PLASTIC_KINEMATIC" || mat.type === "MAT_PIECEWISE_LINEAR_PLASTICITY") {
      if (mat.sigy !== undefined && mat.sigy < 0) {
        diags.push({
          id: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.stdCode,
          code: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.code,
          rule: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.rule,
          severity: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.severity,
          message: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.message(
            mat.mid,
            `negative yield stress '${mat.sigy}'`,
          ),
          line,
          column: 1,
        });
      }
      if (mat.etan !== undefined && mat.e > 0 && mat.etan > mat.e) {
        diags.push({
          id: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.stdCode,
          code: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.code,
          rule: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.rule,
          severity: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.severity,
          message: LsDynaErrorCode.INVALID_PLASTICITY_PARAMETERS.message(
            mat.mid,
            `tangent modulus '${mat.etan}' exceeds Young's modulus '${mat.e}'`,
          ),
          line,
          column: 1,
        });
      }
    }
  }

  // 9. Section geometry checks (LSD4004)
  for (const sec of deck.sections.values()) {
    const line = sec.loc?.line ?? 1;
    if (sec.kind === "SHELL" && sec.thickness !== undefined && sec.thickness <= 0) {
      diags.push({
        id: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.stdCode,
        code: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.code,
        rule: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.rule,
        severity: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.severity,
        message: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.message(sec.secid, "thickness", sec.thickness),
        line,
        column: 1,
      });
    }
    if (sec.kind === "BEAM" && sec.area !== undefined && sec.area <= 0) {
      diags.push({
        id: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.stdCode,
        code: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.code,
        rule: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.rule,
        severity: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.severity,
        message: LsDynaErrorCode.NON_POSITIVE_SECTION_GEOMETRY.message(sec.secid, "area", sec.area),
        line,
        column: 1,
      });
    }
  }

  // 10. Control termination checks (LSD5001, LSD5002)
  if (!deck.controlTermination) {
    diags.push({
      id: LsDynaErrorCode.MISSING_CONTROL_TERMINATION.stdCode,
      code: LsDynaErrorCode.MISSING_CONTROL_TERMINATION.code,
      rule: LsDynaErrorCode.MISSING_CONTROL_TERMINATION.rule,
      severity: LsDynaErrorCode.MISSING_CONTROL_TERMINATION.severity,
      message: LsDynaErrorCode.MISSING_CONTROL_TERMINATION.message(),
      line: 1,
      column: 1,
    });
  } else if (deck.controlTermination.endtim <= 0) {
    diags.push({
      id: LsDynaErrorCode.NON_POSITIVE_TERMINATION_TIME.stdCode,
      code: LsDynaErrorCode.NON_POSITIVE_TERMINATION_TIME.code,
      rule: LsDynaErrorCode.NON_POSITIVE_TERMINATION_TIME.rule,
      severity: LsDynaErrorCode.NON_POSITIVE_TERMINATION_TIME.severity,
      message: LsDynaErrorCode.NON_POSITIVE_TERMINATION_TIME.message(deck.controlTermination.endtim),
      line: deck.controlTermination.loc?.line ?? 1,
      column: 1,
    });
  }

  // 11. Unconstrained rigid body warning (LSD5005)
  let hasNodeTc = false;
  for (const n of deck.nodes.values()) {
    if (n.tc > 0) {
      hasNodeTc = true;
      break;
    }
  }
  if (deck.nodes.size > 0 && deck.elements.size > 0 && deck.boundaries.length === 0 && !hasNodeTc) {
    diags.push({
      id: LsDynaErrorCode.UNCONSTRAINED_RIGID_BODY.stdCode,
      code: LsDynaErrorCode.UNCONSTRAINED_RIGID_BODY.code,
      rule: LsDynaErrorCode.UNCONSTRAINED_RIGID_BODY.rule,
      severity: LsDynaErrorCode.UNCONSTRAINED_RIGID_BODY.severity,
      message: LsDynaErrorCode.UNCONSTRAINED_RIGID_BODY.message(),
      line: 1,
      column: 1,
    });
  }

  // 12. CFL critical timestep check (LSD5003)
  if (deck.elements.size > 0 && deck.nodes.size > 0) {
    const cfl = computeCflAnalysis(deck);
    const ts = deck.controlTimestep;
    if (ts && ts.tssfac > 1.0) {
      diags.push({
        id: LsDynaErrorCode.CFL_TIMESTEP_WARNING.stdCode,
        code: LsDynaErrorCode.CFL_TIMESTEP_WARNING.code,
        rule: LsDynaErrorCode.CFL_TIMESTEP_WARNING.rule,
        severity: LsDynaErrorCode.CFL_TIMESTEP_WARNING.severity,
        message: LsDynaErrorCode.CFL_TIMESTEP_WARNING.message(
          `timestep scale factor tssfac='${ts.tssfac}' exceeds 1.0 (conditionally unstable explicit integration)`,
        ),
        line: ts.loc?.line ?? 1,
        column: 1,
      });
    }
    if (ts && ts.dtinit > 0 && cfl.minDtCritical > 0 && ts.dtinit > cfl.minDtCritical) {
      diags.push({
        id: LsDynaErrorCode.CFL_TIMESTEP_WARNING.stdCode,
        code: LsDynaErrorCode.CFL_TIMESTEP_WARNING.code,
        rule: LsDynaErrorCode.CFL_TIMESTEP_WARNING.rule,
        severity: LsDynaErrorCode.CFL_TIMESTEP_WARNING.severity,
        message: LsDynaErrorCode.CFL_TIMESTEP_WARNING.message(
          `initial timestep dtinit='${ts.dtinit.toExponential(3)}' exceeds CFL limit dt_cr='${cfl.minDtCritical.toExponential(3)}' (element '${cfl.controllingElementId}')`,
        ),
        line: ts.loc?.line ?? 1,
        column: 1,
      });
    }
  }

  return diags;
}

export { LsDynaErrorCode };
