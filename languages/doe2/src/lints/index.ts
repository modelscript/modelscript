// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Pre-Flight BDL Linter & Semantic Validator (DOE1001–DOE5006).
 */

import { Doe2ErrorCode } from "../errors.js";
import type { Doe2Diagnostic, Doe2Document, Doe2Range } from "../types.js";

function zeroRange(): Doe2Range {
  return { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startOffset: 0, endOffset: 0 };
}

export function lintDoe2(doc: Doe2Document): Doe2Diagnostic[] {
  const diags: Doe2Diagnostic[] = [];

  // 1. Parse / syntax & missing '..' terminator errors (DOE1001, DOE1002)
  for (const err of doc.parseErrors) {
    const spec = err.code === "DOE1002" ? Doe2ErrorCode.MISSING_TERMINATOR : Doe2ErrorCode.SYNTAX_ERROR;
    diags.push({
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: err.message,
      range: err.range,
    });
  }

  // 2. Duplicate object names per BDL command kind (DOE2001)
  const checkDuplicates = <T extends { name: string; range: Doe2Range }>(kind: string, items: T[]): Set<string> => {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) {
        const spec = Doe2ErrorCode.DUPLICATE_OBJECT_NAME;
        diags.push({
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(kind, item.name),
          range: item.range,
        });
      } else {
        seen.add(key);
      }
    }
    return seen;
  };

  const materialNames = checkDuplicates("MATERIAL", doc.materials);
  const layersNames = checkDuplicates("LAYERS", doc.layers);
  const constructionNames = checkDuplicates("CONSTRUCTION", doc.constructions);
  const glassTypeNames = checkDuplicates("GLASS-TYPE", doc.glassTypes);
  checkDuplicates("DAY-SCHEDULE", doc.daySchedules);
  checkDuplicates("WEEK-SCHEDULE", doc.weekSchedules);
  checkDuplicates("SCHEDULE", doc.schedules);
  const spaceNames = checkDuplicates("SPACE", doc.spaces);
  checkDuplicates("SURFACE", doc.surfaces);
  checkDuplicates("WINDOW", doc.windows);
  checkDuplicates("DOOR", doc.doors);
  checkDuplicates("ZONE", doc.zones);
  checkDuplicates("SYSTEM", doc.systems);
  checkDuplicates("PLANT-EQUIPMENT", doc.plantEquipment);

  // 3. LAYERS -> MATERIAL reference check (DOE2006)
  for (const lay of doc.layers) {
    for (const matRef of lay.materials) {
      if (!materialNames.has(matRef.toLowerCase())) {
        const spec = Doe2ErrorCode.UNDEFINED_LAYERS_MATERIAL;
        diags.push({
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(lay.name, matRef),
          range: lay.range,
        });
      }
    }
  }

  // 4. CONSTRUCTION -> LAYERS / MATERIAL reference check (DOE2002)
  for (const con of doc.constructions) {
    if (con.layersName && !layersNames.has(con.layersName.toLowerCase())) {
      const spec = Doe2ErrorCode.UNDEFINED_CONSTRUCTION_REF;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(con.name, "LAYERS", con.layersName),
        range: con.range,
      });
    }
    if (con.materialName && !materialNames.has(con.materialName.toLowerCase())) {
      const spec = Doe2ErrorCode.UNDEFINED_CONSTRUCTION_REF;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(con.name, "MATERIAL", con.materialName),
        range: con.range,
      });
    }
  }

  // 5. Surfaces -> CONSTRUCTION reference check (DOE2003) & non-positive area/dims (DOE3003)
  for (const surf of doc.surfaces) {
    if (surf.constructionName && !constructionNames.has(surf.constructionName.toLowerCase())) {
      const spec = Doe2ErrorCode.UNDEFINED_SURFACE_CONSTRUCTION;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.kind, surf.name, surf.constructionName),
        range: surf.range,
      });
    }
    if (surf.area !== undefined && surf.area <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.kind, surf.name, "AREA", surf.area),
        range: surf.range,
      });
    }
    if (surf.width !== undefined && surf.width <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.kind, surf.name, "WIDTH", surf.width),
        range: surf.range,
      });
    }
    if (surf.height !== undefined && surf.height <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(surf.kind, surf.name, "HEIGHT", surf.height),
        range: surf.range,
      });
    }
  }

  // 6. WINDOW -> GLASS-TYPE (DOE2004), parent surface (DOE4001), area/dims (DOE3003)
  for (const win of doc.windows) {
    if (win.glassTypeName && !glassTypeNames.has(win.glassTypeName.toLowerCase())) {
      const spec = Doe2ErrorCode.UNDEFINED_GLASS_TYPE;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(win.name, win.glassTypeName),
        range: win.range,
      });
    }
    if (!win.parentSurfaceName) {
      const spec = Doe2ErrorCode.ORPHAN_OPENING;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("WINDOW", win.name),
        range: win.range,
      });
    }
    if (win.area !== undefined && win.area <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("WINDOW", win.name, "AREA", win.area),
        range: win.range,
      });
    }
  }

  // 7. DOOR -> CONSTRUCTION (DOE2003), parent surface (DOE4001), area (DOE3003)
  for (const door of doc.doors) {
    if (door.constructionName && !constructionNames.has(door.constructionName.toLowerCase())) {
      const spec = Doe2ErrorCode.UNDEFINED_SURFACE_CONSTRUCTION;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("DOOR", door.name, door.constructionName),
        range: door.range,
      });
    }
    if (!door.parentSurfaceName) {
      const spec = Doe2ErrorCode.ORPHAN_OPENING;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("DOOR", door.name),
        range: door.range,
      });
    }
    if (door.area !== undefined && door.area <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("DOOR", door.name, "AREA", door.area),
        range: door.range,
      });
    }
  }

  // 8. ZONE -> SPACE reference check (DOE2005)
  const linkedSpaces = new Set<string>();
  for (const zone of doc.zones) {
    if (zone.spaceName) {
      if (!spaceNames.has(zone.spaceName.toLowerCase())) {
        const spec = Doe2ErrorCode.UNDEFINED_ZONE_SPACE;
        diags.push({
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(zone.name, zone.spaceName),
          range: zone.range,
        });
      } else {
        linkedSpaces.add(zone.spaceName.toLowerCase());
      }
    }
  }

  // 9. MATERIAL physical properties check (DOE3001, DOE3002)
  for (const mat of doc.materials) {
    if (mat.thickness !== undefined && mat.thickness <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_THICKNESS;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(mat.name, mat.thickness),
        range: mat.range,
      });
    }
    if (mat.conductivity !== undefined && mat.conductivity <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_CONDUCTIVITY;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(mat.name, "CONDUCTIVITY", mat.conductivity),
        range: mat.range,
      });
    }
    if (mat.resistance !== undefined && mat.resistance <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_CONDUCTIVITY;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(mat.name, "RESISTANCE", mat.resistance),
        range: mat.range,
      });
    }
  }

  // 10. SPACE physical properties check (DOE3003) & unlinked space info (DOE5006)
  for (const sp of doc.spaces) {
    if (sp.area !== undefined && sp.area <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("SPACE", sp.name, "AREA", sp.area),
        range: sp.range,
      });
    }
    if (sp.volume !== undefined && sp.volume <= 0) {
      const spec = Doe2ErrorCode.NON_POSITIVE_AREA;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message("SPACE", sp.name, "VOLUME", sp.volume),
        range: sp.range,
      });
    }
    if (doc.zones.length > 0 && !linkedSpaces.has(sp.name.toLowerCase())) {
      const spec = Doe2ErrorCode.UNLINKED_SPACE;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(sp.name),
        range: sp.range,
      });
    }
  }

  // 11. DAY-SCHEDULE value bounds check (DOE3004)
  for (const ds of doc.daySchedules) {
    if (ds.values.length === 0) {
      const spec = Doe2ErrorCode.INVALID_SCHEDULE_VALUE;
      diags.push({
        code: spec.code,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message(ds.name, "no hourly values provided"),
        range: ds.range,
      });
      continue;
    }
    const schedType = ds.type ?? "FRACTION";
    for (let h = 0; h < ds.values.length; h++) {
      const v = ds.values[h]!;
      if (!Number.isFinite(v)) {
        const spec = Doe2ErrorCode.INVALID_SCHEDULE_VALUE;
        diags.push({
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ds.name, `non-finite value at hour ${h + 1}`),
          range: ds.range,
        });
        break;
      }
      if ((schedType === "FRACTION" || schedType === "ON/OFF") && (v < 0 || v > 1)) {
        const spec = Doe2ErrorCode.INVALID_SCHEDULE_VALUE;
        diags.push({
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ds.name, `${schedType} value '${v}' at hour ${h + 1} must be within [0, 1]`),
          range: ds.range,
        });
        break;
      }
      if (schedType === "MULTIPLIER" && v < 0) {
        const spec = Doe2ErrorCode.INVALID_SCHEDULE_VALUE;
        diags.push({
          code: spec.code,
          rule: spec.rule,
          severity: spec.severity,
          message: spec.message(ds.name, `MULTIPLIER value '${v}' at hour ${h + 1} must be >= 0`),
          range: ds.range,
        });
        break;
      }
    }
  }

  // 12. Missing STOP terminator (DOE5001)
  if (doc.commands.length > 0 && !doc.hasStop) {
    const lastCmd = doc.commands[doc.commands.length - 1];
    const spec = Doe2ErrorCode.MISSING_STOP;
    diags.push({
      code: spec.code,
      rule: spec.rule,
      severity: spec.severity,
      message: spec.message(),
      range: lastCmd ? lastCmd.range : zeroRange(),
    });
  }

  return diags;
}
