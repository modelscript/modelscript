// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hdf4ErrorCode, type Hdf4Diagnostic } from "../errors.js";
import { decodeHdf4Binary } from "../parser/binary-codec.js";
import { VALID_HDF4_DATA_TYPE_CODES, type Hdf4Document } from "../types.js";

/**
 * Validates a parsed `Hdf4Document` against NCSA HDF4 semantic & structural rules (`HDF1001`–`HDF5006`).
 */
export function lintHdf4(doc: Hdf4Document): Hdf4Diagnostic[] {
  const diags: Hdf4Diagnostic[] = [];

  // 1. Propagate syntax / binary parse errors (HDF1001, HDF1002, HDF1003)
  for (const err of doc.parseErrors) {
    if (err.code === Hdf4ErrorCode.INVALID_MAGIC.code) {
      diags.push({
        code: Hdf4ErrorCode.INVALID_MAGIC.code,
        rule: Hdf4ErrorCode.INVALID_MAGIC.rule,
        severity: Hdf4ErrorCode.INVALID_MAGIC.severity,
        message: err.message,
        line: err.line,
        column: err.column,
      });
    } else if (err.code === Hdf4ErrorCode.TRUNCATED_DDH.code) {
      diags.push({
        code: Hdf4ErrorCode.TRUNCATED_DDH.code,
        rule: Hdf4ErrorCode.TRUNCATED_DDH.rule,
        severity: Hdf4ErrorCode.TRUNCATED_DDH.severity,
        message: err.message,
        line: err.line,
        column: err.column,
      });
    } else {
      diags.push({
        code: Hdf4ErrorCode.SYNTAX_ERROR.code,
        rule: Hdf4ErrorCode.SYNTAX_ERROR.rule,
        severity: Hdf4ErrorCode.SYNTAX_ERROR.severity,
        message: Hdf4ErrorCode.SYNTAX_ERROR.message(err.message),
        line: err.line,
        column: err.column,
      });
    }
  }

  // 2. Duplicate (tag, ref) in descriptors (HDF2001)
  const seenTagRef = new Set<string>();
  for (const dd of doc.descriptors) {
    const key = `${dd.tag}:${dd.ref}`;
    if (seenTagRef.has(key)) {
      diags.push({
        code: Hdf4ErrorCode.DUPLICATE_TAG_REF.code,
        rule: Hdf4ErrorCode.DUPLICATE_TAG_REF.rule,
        severity: Hdf4ErrorCode.DUPLICATE_TAG_REF.severity,
        message: Hdf4ErrorCode.DUPLICATE_TAG_REF.message(String(dd.tag), String(dd.ref)),
      });
    } else {
      seenTagRef.add(key);
    }
  }

  // 3. Duplicate SDS names, data type, dimensions, data count, non-finite, missing units
  const sdsNames = new Set<string>();
  for (const sds of doc.sdsList) {
    if (sdsNames.has(sds.name)) {
      diags.push({
        code: Hdf4ErrorCode.DUPLICATE_SDS_NAME.code,
        rule: Hdf4ErrorCode.DUPLICATE_SDS_NAME.rule,
        severity: Hdf4ErrorCode.DUPLICATE_SDS_NAME.severity,
        message: Hdf4ErrorCode.DUPLICATE_SDS_NAME.message(sds.name),
        objectName: sds.name,
        line: sds.location?.line,
        column: sds.location?.column,
      });
    } else {
      sdsNames.add(sds.name);
    }

    if (!VALID_HDF4_DATA_TYPE_CODES.has(sds.dataType)) {
      diags.push({
        code: Hdf4ErrorCode.INVALID_DATA_TYPE.code,
        rule: Hdf4ErrorCode.INVALID_DATA_TYPE.rule,
        severity: Hdf4ErrorCode.INVALID_DATA_TYPE.severity,
        message: Hdf4ErrorCode.INVALID_DATA_TYPE.message(sds.name, String(sds.dataType)),
        objectName: sds.name,
        line: sds.location?.line,
        column: sds.location?.column,
      });
    }

    let expectedCount = sds.dims.length > 0 ? 1 : 0;
    let dimsValid = true;
    for (const dim of sds.dims) {
      if (!Number.isInteger(dim.size) || dim.size <= 0) {
        dimsValid = false;
        diags.push({
          code: Hdf4ErrorCode.NON_POSITIVE_DIM.code,
          rule: Hdf4ErrorCode.NON_POSITIVE_DIM.rule,
          severity: Hdf4ErrorCode.NON_POSITIVE_DIM.severity,
          message: Hdf4ErrorCode.NON_POSITIVE_DIM.message(sds.name, dim.name, String(dim.size)),
          objectName: sds.name,
          line: dim.location?.line ?? sds.location?.line,
          column: dim.location?.column ?? sds.location?.column,
        });
      } else {
        expectedCount *= dim.size;
      }
    }

    if (dimsValid && sds.dims.length > 0 && sds.data.length > 0 && sds.data.length !== expectedCount) {
      diags.push({
        code: Hdf4ErrorCode.SDS_DATA_COUNT_MISMATCH.code,
        rule: Hdf4ErrorCode.SDS_DATA_COUNT_MISMATCH.rule,
        severity: Hdf4ErrorCode.SDS_DATA_COUNT_MISMATCH.severity,
        message: Hdf4ErrorCode.SDS_DATA_COUNT_MISMATCH.message(
          sds.name,
          String(sds.data.length),
          String(expectedCount),
        ),
        objectName: sds.name,
        line: sds.location?.line,
        column: sds.location?.column,
      });
    }

    let nonFiniteCount = 0;
    for (const v of sds.data) {
      if (!Number.isFinite(v)) nonFiniteCount++;
    }
    if (nonFiniteCount > 0) {
      diags.push({
        code: Hdf4ErrorCode.NON_FINITE_DATA.code,
        rule: Hdf4ErrorCode.NON_FINITE_DATA.rule,
        severity: Hdf4ErrorCode.NON_FINITE_DATA.severity,
        message: Hdf4ErrorCode.NON_FINITE_DATA.message(sds.name, String(nonFiniteCount)),
        objectName: sds.name,
        line: sds.location?.line,
        column: sds.location?.column,
      });
    }

    const hasUnits = Boolean(sds.unit) || sds.attributes.some((a) => a.name.toLowerCase() === "units");
    if (!hasUnits) {
      diags.push({
        code: Hdf4ErrorCode.MISSING_UNITS_ATTR.code,
        rule: Hdf4ErrorCode.MISSING_UNITS_ATTR.rule,
        severity: Hdf4ErrorCode.MISSING_UNITS_ATTR.severity,
        message: Hdf4ErrorCode.MISSING_UNITS_ATTR.message(sds.name),
        objectName: sds.name,
        line: sds.location?.line,
        column: sds.location?.column,
      });
    }
  }

  // 4. Vgroup checks: duplicate names, undefined members, empty vgroup, cyclic hierarchy
  const vgNames = new Set<string>();
  const vdNames = new Set(doc.vdatas.map((v) => v.name));
  const r8Names = new Set(doc.rasters.map((r) => r.name));
  const palNames = new Set(doc.palettes.map((p) => p.name));

  for (const vg of doc.vgroups) {
    if (vgNames.has(vg.name)) {
      diags.push({
        code: Hdf4ErrorCode.DUPLICATE_VGROUP_NAME.code,
        rule: Hdf4ErrorCode.DUPLICATE_VGROUP_NAME.rule,
        severity: Hdf4ErrorCode.DUPLICATE_VGROUP_NAME.severity,
        message: Hdf4ErrorCode.DUPLICATE_VGROUP_NAME.message(vg.name),
        objectName: vg.name,
        line: vg.location?.line,
        column: vg.location?.column,
      });
    } else {
      vgNames.add(vg.name);
    }
  }

  for (const vg of doc.vgroups) {
    if (vg.members.length === 0) {
      diags.push({
        code: Hdf4ErrorCode.EMPTY_VGROUP.code,
        rule: Hdf4ErrorCode.EMPTY_VGROUP.rule,
        severity: Hdf4ErrorCode.EMPTY_VGROUP.severity,
        message: Hdf4ErrorCode.EMPTY_VGROUP.message(vg.name),
        objectName: vg.name,
        line: vg.location?.line,
        column: vg.location?.column,
      });
    }

    for (const m of vg.members) {
      let exists = false;
      if (m.kind === "SDS") exists = sdsNames.has(m.name);
      else if (m.kind === "VGROUP") exists = vgNames.has(m.name);
      else if (m.kind === "VDATA") exists = vdNames.has(m.name);
      else if (m.kind === "RASTER8") exists = r8Names.has(m.name);
      else if (m.kind === "PALETTE") exists = palNames.has(m.name);
      else if (m.kind === "TAGREF") exists = true;

      if (!exists) {
        diags.push({
          code: Hdf4ErrorCode.UNDEFINED_VGROUP_MEMBER.code,
          rule: Hdf4ErrorCode.UNDEFINED_VGROUP_MEMBER.rule,
          severity: Hdf4ErrorCode.UNDEFINED_VGROUP_MEMBER.severity,
          message: Hdf4ErrorCode.UNDEFINED_VGROUP_MEMBER.message(vg.name, m.name),
          objectName: vg.name,
          line: m.location?.line ?? vg.location?.line,
          column: m.location?.column ?? vg.location?.column,
        });
      }
    }
  }

  // Cycle detection in Vgroup graph (DFS 3-color)
  const vgByName = new Map(doc.vgroups.map((v) => [v.name, v]));
  const color = new Map<string, 0 | 1 | 2>();
  const pathStack: string[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (name: string): void => {
    color.set(name, 1);
    pathStack.push(name);
    const vg = vgByName.get(name);
    if (vg) {
      for (const m of vg.members) {
        if (m.kind !== "VGROUP" || !vgByName.has(m.name)) continue;
        const c = color.get(m.name) ?? 0;
        if (c === 1) {
          const cycleStart = pathStack.indexOf(m.name);
          const cycle = [...pathStack.slice(cycleStart), m.name].join(" -> ");
          if (!reportedCycles.has(cycle)) {
            reportedCycles.add(cycle);
            diags.push({
              code: Hdf4ErrorCode.CYCLIC_VGROUP.code,
              rule: Hdf4ErrorCode.CYCLIC_VGROUP.rule,
              severity: Hdf4ErrorCode.CYCLIC_VGROUP.severity,
              message: Hdf4ErrorCode.CYCLIC_VGROUP.message(cycle),
              objectName: vg.name,
              line: vg.location?.line,
              column: vg.location?.column,
            });
          }
        } else if (c === 0) {
          dfs(m.name);
        }
      }
    }
    pathStack.pop();
    color.set(name, 2);
  };

  for (const vg of doc.vgroups) {
    if ((color.get(vg.name) ?? 0) === 0) {
      dfs(vg.name);
    }
  }

  // 5. Vdata field type & record width checks
  for (const vd of doc.vdatas) {
    let expectedWidth = 0;
    for (const f of vd.fields) {
      if (!VALID_HDF4_DATA_TYPE_CODES.has(f.dataType)) {
        diags.push({
          code: Hdf4ErrorCode.INVALID_DATA_TYPE.code,
          rule: Hdf4ErrorCode.INVALID_DATA_TYPE.rule,
          severity: Hdf4ErrorCode.INVALID_DATA_TYPE.severity,
          message: Hdf4ErrorCode.INVALID_DATA_TYPE.message(`${vd.name}.${f.name}`, String(f.dataType)),
          objectName: vd.name,
          line: vd.location?.line,
          column: vd.location?.column,
        });
      }
      expectedWidth += Math.max(1, f.order);
    }
    if (expectedWidth > 0) {
      for (let r = 0; r < vd.records.length; r++) {
        const rec = vd.records[r];
        if (rec && rec.length !== expectedWidth) {
          diags.push({
            code: Hdf4ErrorCode.VDATA_FIELD_MISMATCH.code,
            rule: Hdf4ErrorCode.VDATA_FIELD_MISMATCH.rule,
            severity: Hdf4ErrorCode.VDATA_FIELD_MISMATCH.severity,
            message: Hdf4ErrorCode.VDATA_FIELD_MISMATCH.message(
              vd.name,
              String(r + 1),
              String(rec.length),
              String(expectedWidth),
            ),
            objectName: vd.name,
            line: vd.location?.line,
            column: vd.location?.column,
          });
        }
      }
    }
  }

  // 6. Raster8 checks
  for (const r of doc.rasters) {
    if (r.width <= 0) {
      diags.push({
        code: Hdf4ErrorCode.NON_POSITIVE_DIM.code,
        rule: Hdf4ErrorCode.NON_POSITIVE_DIM.rule,
        severity: Hdf4ErrorCode.NON_POSITIVE_DIM.severity,
        message: Hdf4ErrorCode.NON_POSITIVE_DIM.message(r.name, "width", String(r.width)),
        objectName: r.name,
        line: r.location?.line,
        column: r.location?.column,
      });
    }
    if (r.height <= 0) {
      diags.push({
        code: Hdf4ErrorCode.NON_POSITIVE_DIM.code,
        rule: Hdf4ErrorCode.NON_POSITIVE_DIM.rule,
        severity: Hdf4ErrorCode.NON_POSITIVE_DIM.severity,
        message: Hdf4ErrorCode.NON_POSITIVE_DIM.message(r.name, "height", String(r.height)),
        objectName: r.name,
        line: r.location?.line,
        column: r.location?.column,
      });
    }
    if (r.width > 0 && r.height > 0 && r.pixels.length > 0 && r.pixels.length !== r.width * r.height) {
      diags.push({
        code: Hdf4ErrorCode.RASTER8_DATA_MISMATCH.code,
        rule: Hdf4ErrorCode.RASTER8_DATA_MISMATCH.rule,
        severity: Hdf4ErrorCode.RASTER8_DATA_MISMATCH.severity,
        message: Hdf4ErrorCode.RASTER8_DATA_MISMATCH.message(
          r.name,
          String(r.pixels.length),
          String(r.width * r.height),
        ),
        objectName: r.name,
        line: r.location?.line,
        column: r.location?.column,
      });
    }
  }

  // 7. Palette checks
  for (const p of doc.palettes) {
    if (p.entries.length > 0 && p.entries.length !== 768) {
      diags.push({
        code: Hdf4ErrorCode.PALETTE_SIZE_MISMATCH.code,
        rule: Hdf4ErrorCode.PALETTE_SIZE_MISMATCH.rule,
        severity: Hdf4ErrorCode.PALETTE_SIZE_MISMATCH.severity,
        message: Hdf4ErrorCode.PALETTE_SIZE_MISMATCH.message(p.name, String(p.entries.length)),
        objectName: p.name,
        line: p.location?.line,
        column: p.location?.column,
      });
    }
  }

  return diags;
}

/**
 * Decodes and lints a raw binary HDF4 byte buffer.
 */
export function lintHdf4Binary(bytes: Uint8Array): Hdf4Diagnostic[] {
  const doc = decodeHdf4Binary(bytes);
  return lintHdf4(doc);
}

export { Hdf4ErrorCode, type Hdf4Diagnostic };
