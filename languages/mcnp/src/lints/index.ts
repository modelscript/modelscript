// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Static Linter & Semantic Validator (MCNP1001–MCNP5006).
 */

import { McnpErrorCode, type McnpDiagnostic } from "../errors.js";
import { extractCsgCellRefs, extractCsgSurfaceRefs } from "../parser/csg-parser.js";
import type { McnpDeck, McnpSurfaceType } from "../types.js";

const EXPECTED_SURFACE_PARAMS: Record<McnpSurfaceType, { min: number; max: number; desc: string }> = {
  P: { min: 4, max: 9, desc: "4 (A B C D) or 9 (3 points)" },
  PX: { min: 1, max: 1, desc: "1 (D)" },
  PY: { min: 1, max: 1, desc: "1 (D)" },
  PZ: { min: 1, max: 1, desc: "1 (D)" },
  SO: { min: 1, max: 1, desc: "1 (R)" },
  S: { min: 4, max: 4, desc: "4 (x y z R)" },
  SX: { min: 2, max: 2, desc: "2 (x R)" },
  SY: { min: 2, max: 2, desc: "2 (y R)" },
  SZ: { min: 2, max: 2, desc: "2 (z R)" },
  "C/X": { min: 3, max: 3, desc: "3 (y z R)" },
  "C/Y": { min: 3, max: 3, desc: "3 (x z R)" },
  "C/Z": { min: 3, max: 3, desc: "3 (x y R)" },
  CX: { min: 1, max: 1, desc: "1 (R)" },
  CY: { min: 1, max: 1, desc: "1 (R)" },
  CZ: { min: 1, max: 1, desc: "1 (R)" },
  "K/X": { min: 4, max: 5, desc: "4-5 (x y z t^2 [sheet])" },
  "K/Y": { min: 4, max: 5, desc: "4-5 (x y z t^2 [sheet])" },
  "K/Z": { min: 4, max: 5, desc: "4-5 (x y z t^2 [sheet])" },
  KX: { min: 2, max: 3, desc: "2-3 (x t^2 [sheet])" },
  KY: { min: 2, max: 3, desc: "2-3 (y t^2 [sheet])" },
  KZ: { min: 2, max: 3, desc: "2-3 (z t^2 [sheet])" },
  GQ: { min: 10, max: 10, desc: "10 (A..K)" },
  RPP: { min: 6, max: 6, desc: "6 (xmin xmax ymin ymax zmin zmax)" },
  RCC: { min: 7, max: 7, desc: "7 (vx vy vz hx hy hz R)" },
  SPH: { min: 4, max: 4, desc: "4 (vx vy vz R)" },
};

const ZAID_REGEX = /^\d{4,6}(?:\.\d{2}[a-zA-Z])?$/;

function hasPositiveRadius(type: McnpSurfaceType, params: number[]): boolean {
  switch (type) {
    case "SO":
    case "CX":
    case "CY":
    case "CZ":
      return (params[0] ?? 0) > 0;
    case "SX":
    case "SY":
    case "SZ":
      return (params[1] ?? 0) > 0;
    case "C/X":
    case "C/Y":
    case "C/Z":
      return (params[2] ?? 0) > 0;
    case "S":
    case "SPH":
      return (params[3] ?? 0) > 0;
    case "RCC":
      return (params[6] ?? 0) > 0;
    default:
      return true;
  }
}

/**
 * Validates an MCNP deck and returns all semantic and structural diagnostics (`MCNP1001`–`MCNP5006`).
 */
export function lintMcnpDeck(deck: McnpDeck): McnpDiagnostic[] {
  const diags: McnpDiagnostic[] = [];

  // MCNP1001: Syntax / parse errors
  for (const err of deck.parseErrors) {
    diags.push({
      id: McnpErrorCode.SYNTAX_ERROR.id,
      code: McnpErrorCode.SYNTAX_ERROR.code,
      rule: McnpErrorCode.SYNTAX_ERROR.rule,
      severity: McnpErrorCode.SYNTAX_ERROR.severity,
      message: McnpErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // MCNP2001: Duplicate cell IDs
  for (const dup of deck.duplicateCellIds) {
    diags.push({
      id: McnpErrorCode.DUPLICATE_CELL_ID.id,
      code: McnpErrorCode.DUPLICATE_CELL_ID.code,
      rule: McnpErrorCode.DUPLICATE_CELL_ID.rule,
      severity: McnpErrorCode.DUPLICATE_CELL_ID.severity,
      message: McnpErrorCode.DUPLICATE_CELL_ID.message(String(dup.id)),
      line: dup.line,
      entityId: `cell:${dup.id}`,
    });
  }

  // MCNP2002: Duplicate surface IDs
  for (const dup of deck.duplicateSurfaceIds) {
    diags.push({
      id: McnpErrorCode.DUPLICATE_SURFACE_ID.id,
      code: McnpErrorCode.DUPLICATE_SURFACE_ID.code,
      rule: McnpErrorCode.DUPLICATE_SURFACE_ID.rule,
      severity: McnpErrorCode.DUPLICATE_SURFACE_ID.severity,
      message: McnpErrorCode.DUPLICATE_SURFACE_ID.message(String(dup.id)),
      line: dup.line,
      entityId: `surf:${dup.id}`,
    });
  }

  // MCNP2003: Duplicate material IDs
  for (const dup of deck.duplicateMaterialIds) {
    diags.push({
      id: McnpErrorCode.DUPLICATE_MATERIAL_ID.id,
      code: McnpErrorCode.DUPLICATE_MATERIAL_ID.code,
      rule: McnpErrorCode.DUPLICATE_MATERIAL_ID.rule,
      severity: McnpErrorCode.DUPLICATE_MATERIAL_ID.severity,
      message: McnpErrorCode.DUPLICATE_MATERIAL_ID.message(String(dup.id)),
      line: dup.line,
      entityId: `M${dup.id}`,
    });
  }

  // Surface validations (MCNP5001, MCNP5002)
  for (const surf of deck.surfaces.values()) {
    const spec = EXPECTED_SURFACE_PARAMS[surf.type];
    if (surf.params.length < spec.min || surf.params.length > spec.max) {
      diags.push({
        id: McnpErrorCode.INVALID_SURFACE_PARAM_COUNT.id,
        code: McnpErrorCode.INVALID_SURFACE_PARAM_COUNT.code,
        rule: McnpErrorCode.INVALID_SURFACE_PARAM_COUNT.rule,
        severity: McnpErrorCode.INVALID_SURFACE_PARAM_COUNT.severity,
        message: McnpErrorCode.INVALID_SURFACE_PARAM_COUNT.message(
          String(surf.id),
          surf.type,
          String(surf.params.length),
          spec.desc,
        ),
        line: surf.line,
        entityId: `surf:${surf.id}`,
      });
    } else if (!hasPositiveRadius(surf.type, surf.params)) {
      diags.push({
        id: McnpErrorCode.NON_POSITIVE_RADIUS.id,
        code: McnpErrorCode.NON_POSITIVE_RADIUS.code,
        rule: McnpErrorCode.NON_POSITIVE_RADIUS.rule,
        severity: McnpErrorCode.NON_POSITIVE_RADIUS.severity,
        message: McnpErrorCode.NON_POSITIVE_RADIUS.message(String(surf.id), surf.type),
        line: surf.line,
        entityId: `surf:${surf.id}`,
      });
    }
  }

  // Cell validations (MCNP2004, MCNP2005, MCNP3003, MCNP5003, MCNP5006)
  let hasGraveyardCell = false;
  const complementGraph = new Map<number, number[]>();

  for (const cell of deck.cells.values()) {
    // Check graveyard importance
    for (const impVal of Object.values(cell.imp)) {
      if (impVal === 0) {
        hasGraveyardCell = true;
      }
    }

    // MCNP2004: Undefined surfaces in CSG
    const surfRefs = extractCsgSurfaceRefs(cell.csg);
    for (const sid of surfRefs) {
      if (!deck.surfaces.has(sid)) {
        diags.push({
          id: McnpErrorCode.UNDEFINED_SURFACE_IN_CELL.id,
          code: McnpErrorCode.UNDEFINED_SURFACE_IN_CELL.code,
          rule: McnpErrorCode.UNDEFINED_SURFACE_IN_CELL.rule,
          severity: McnpErrorCode.UNDEFINED_SURFACE_IN_CELL.severity,
          message: McnpErrorCode.UNDEFINED_SURFACE_IN_CELL.message(String(sid), String(cell.id)),
          line: cell.line,
          entityId: `cell:${cell.id}`,
        });
      }
    }

    // Track cell complement references for MCNP5006
    const cellRefs = extractCsgCellRefs(cell.csg);
    if (cellRefs.length > 0) {
      complementGraph.set(cell.id, cellRefs);
    }

    // MCNP2005: Undefined material
    if (cell.materialId > 0 && !deck.materials.has(cell.materialId)) {
      diags.push({
        id: McnpErrorCode.UNDEFINED_MATERIAL_IN_CELL.id,
        code: McnpErrorCode.UNDEFINED_MATERIAL_IN_CELL.code,
        rule: McnpErrorCode.UNDEFINED_MATERIAL_IN_CELL.rule,
        severity: McnpErrorCode.UNDEFINED_MATERIAL_IN_CELL.severity,
        message: McnpErrorCode.UNDEFINED_MATERIAL_IN_CELL.message(String(cell.materialId), String(cell.id)),
        line: cell.line,
        entityId: `cell:${cell.id}`,
      });
    }

    // MCNP3003: Non-void cell density check
    if (cell.materialId > 0 && (cell.density === undefined || cell.density === 0)) {
      diags.push({
        id: McnpErrorCode.INVALID_CELL_DENSITY.id,
        code: McnpErrorCode.INVALID_CELL_DENSITY.code,
        rule: McnpErrorCode.INVALID_CELL_DENSITY.rule,
        severity: McnpErrorCode.INVALID_CELL_DENSITY.severity,
        message: McnpErrorCode.INVALID_CELL_DENSITY.message(String(cell.id)),
        line: cell.line,
        entityId: `cell:${cell.id}`,
      });
    }

    // MCNP5003: Cell volume check
    if (cell.vol !== undefined && cell.vol <= 0) {
      diags.push({
        id: McnpErrorCode.INVALID_CELL_VOLUME.id,
        code: McnpErrorCode.INVALID_CELL_VOLUME.code,
        rule: McnpErrorCode.INVALID_CELL_VOLUME.rule,
        severity: McnpErrorCode.INVALID_CELL_VOLUME.severity,
        message: McnpErrorCode.INVALID_CELL_VOLUME.message(String(cell.id)),
        line: cell.line,
        entityId: `cell:${cell.id}`,
      });
    }
  }

  // MCNP5006: Circular cell complement detection
  const reportedCycles = new Set<number>();
  for (const startId of complementGraph.keys()) {
    const visited = new Set<number>();
    const stack = [startId];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      const nexts = complementGraph.get(curr) ?? [];
      for (const nxt of nexts) {
        if (nxt === startId && !reportedCycles.has(startId)) {
          reportedCycles.add(startId);
          const c = deck.cells.get(startId);
          diags.push({
            id: McnpErrorCode.CIRCULAR_CELL_COMPLEMENT.id,
            code: McnpErrorCode.CIRCULAR_CELL_COMPLEMENT.code,
            rule: McnpErrorCode.CIRCULAR_CELL_COMPLEMENT.rule,
            severity: McnpErrorCode.CIRCULAR_CELL_COMPLEMENT.severity,
            message: McnpErrorCode.CIRCULAR_CELL_COMPLEMENT.message(String(startId)),
            line: c?.line,
            entityId: `cell:${startId}`,
          });
        } else if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      }
    }
  }

  // Material validations (MCNP3001, MCNP3002)
  for (const mat of deck.materials.values()) {
    let hasPos = false;
    let hasNeg = false;
    for (const iso of mat.isotopes) {
      if (!ZAID_REGEX.test(iso.zaid)) {
        diags.push({
          id: McnpErrorCode.INVALID_ZAID_FORMAT.id,
          code: McnpErrorCode.INVALID_ZAID_FORMAT.code,
          rule: McnpErrorCode.INVALID_ZAID_FORMAT.rule,
          severity: McnpErrorCode.INVALID_ZAID_FORMAT.severity,
          message: McnpErrorCode.INVALID_ZAID_FORMAT.message(iso.zaid, String(mat.id)),
          line: mat.line,
          entityId: `M${mat.id}`,
        });
      }
      if (iso.fraction > 0) hasPos = true;
      if (iso.fraction < 0) hasNeg = true;
    }
    if (hasPos && hasNeg) {
      diags.push({
        id: McnpErrorCode.MIXED_MATERIAL_FRACTION_SIGNS.id,
        code: McnpErrorCode.MIXED_MATERIAL_FRACTION_SIGNS.code,
        rule: McnpErrorCode.MIXED_MATERIAL_FRACTION_SIGNS.rule,
        severity: McnpErrorCode.MIXED_MATERIAL_FRACTION_SIGNS.severity,
        message: McnpErrorCode.MIXED_MATERIAL_FRACTION_SIGNS.message(String(mat.id)),
        line: mat.line,
        entityId: `M${mat.id}`,
      });
    }
  }

  // MCNP4001: Missing graveyard cell
  if (deck.cells.size > 0 && !hasGraveyardCell) {
    diags.push({
      id: McnpErrorCode.MISSING_GRAVEYARD_CELL.id,
      code: McnpErrorCode.MISSING_GRAVEYARD_CELL.code,
      rule: McnpErrorCode.MISSING_GRAVEYARD_CELL.rule,
      severity: McnpErrorCode.MISSING_GRAVEYARD_CELL.severity,
      message: McnpErrorCode.MISSING_GRAVEYARD_CELL.message(),
      line: 1,
    });
  }

  // MCNP4002: Missing source card
  if (!deck.source.sdef && !deck.source.kcode) {
    diags.push({
      id: McnpErrorCode.MISSING_SOURCE_CARD.id,
      code: McnpErrorCode.MISSING_SOURCE_CARD.code,
      rule: McnpErrorCode.MISSING_SOURCE_CARD.rule,
      severity: McnpErrorCode.MISSING_SOURCE_CARD.severity,
      message: McnpErrorCode.MISSING_SOURCE_CARD.message(),
      line: 1,
    });
  }

  // MCNP4003 & MCNP5005: KCODE validations
  if (deck.source.kcode) {
    const kc = deck.source.kcode;
    if (deck.source.ksrc.length === 0) {
      diags.push({
        id: McnpErrorCode.KCODE_MISSING_KSRC.id,
        code: McnpErrorCode.KCODE_MISSING_KSRC.code,
        rule: McnpErrorCode.KCODE_MISSING_KSRC.rule,
        severity: McnpErrorCode.KCODE_MISSING_KSRC.severity,
        message: McnpErrorCode.KCODE_MISSING_KSRC.message(),
        line: kc.line,
      });
    }
    if (kc.nsrck <= 0 || kc.kct <= kc.ikz || kc.ikz < 0) {
      diags.push({
        id: McnpErrorCode.INVALID_KCODE_PARAMS.id,
        code: McnpErrorCode.INVALID_KCODE_PARAMS.code,
        rule: McnpErrorCode.INVALID_KCODE_PARAMS.rule,
        severity: McnpErrorCode.INVALID_KCODE_PARAMS.severity,
        message: McnpErrorCode.INVALID_KCODE_PARAMS.message(`nsrck=${kc.nsrck}, ikz=${kc.ikz}, kct=${kc.kct}`),
        line: kc.line,
      });
    }
  }

  // MCNP5004: NPS validation
  if (deck.nps !== undefined && (!Number.isInteger(deck.nps) || deck.nps <= 0)) {
    diags.push({
      id: McnpErrorCode.INVALID_NPS.id,
      code: McnpErrorCode.INVALID_NPS.code,
      rule: McnpErrorCode.INVALID_NPS.rule,
      severity: McnpErrorCode.INVALID_NPS.severity,
      message: McnpErrorCode.INVALID_NPS.message(String(deck.nps)),
      line: deck.npsLine,
    });
  }

  // MCNP2006: Tally target validation
  for (const tally of deck.tallies.values()) {
    const isSurfaceTally = tally.type === 1 || tally.type === 2;
    const isCellTally = tally.type === 4 || tally.type === 6 || tally.type === 8;
    for (const targetId of tally.targets) {
      if (isSurfaceTally && !deck.surfaces.has(targetId)) {
        diags.push({
          id: McnpErrorCode.TALLY_UNDEFINED_TARGET.id,
          code: McnpErrorCode.TALLY_UNDEFINED_TARGET.code,
          rule: McnpErrorCode.TALLY_UNDEFINED_TARGET.rule,
          severity: McnpErrorCode.TALLY_UNDEFINED_TARGET.severity,
          message: McnpErrorCode.TALLY_UNDEFINED_TARGET.message(String(tally.id), "surface", String(targetId)),
          line: tally.line,
          entityId: `F${tally.id}`,
        });
      } else if (isCellTally && !deck.cells.has(targetId)) {
        diags.push({
          id: McnpErrorCode.TALLY_UNDEFINED_TARGET.id,
          code: McnpErrorCode.TALLY_UNDEFINED_TARGET.code,
          rule: McnpErrorCode.TALLY_UNDEFINED_TARGET.rule,
          severity: McnpErrorCode.TALLY_UNDEFINED_TARGET.severity,
          message: McnpErrorCode.TALLY_UNDEFINED_TARGET.message(String(tally.id), "cell", String(targetId)),
          line: tally.line,
          entityId: `F${tally.id}`,
        });
      }
    }
  }

  return diags;
}

export { McnpErrorCode, type McnpDiagnostic };
