// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Crystallographic Linter (`ICIF1001`–`ICIF5006`) for `@modelscript/iucr-cif`.
 */

import { IucrCifErrorCode, type IucrCifDiagnostic } from "../errors.js";
import { extractCrystalStructure, normalizeElementSymbol, parseCifNumber, parseIucrCif } from "../parser/cif-parser.js";
import {
  computeMetricTensor,
  expandSymmetrySites,
  isKnownElement,
  parseSymmetryOp,
  periodicDistance,
} from "../solver/index.js";
import type { CifDocument } from "../types.js";

export { IucrCifErrorCode, type IucrCifDiagnostic };

/**
 * Validates a STAR/CIF 1.1 document or source string against all crystallographic lint rules (`ICIF1001`–`ICIF5006`).
 */
export function lintIucrCif(docOrSource: CifDocument | string): IucrCifDiagnostic[] {
  const doc = typeof docOrSource === "string" ? parseIucrCif(docOrSource) : docOrSource;
  const diags: IucrCifDiagnostic[] = [];

  // ICIF1001: Syntax errors
  for (const err of doc.errors) {
    diags.push({
      code: IucrCifErrorCode.SYNTAX_ERROR.code,
      rule: IucrCifErrorCode.SYNTAX_ERROR.rule,
      severity: IucrCifErrorCode.SYNTAX_ERROR.severity,
      message: IucrCifErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // ICIF2001: Duplicate data_ block names (case-insensitive per CIF 1.1)
  const seenBlocks = new Set<string>();
  for (const block of doc.blocks) {
    const key = block.name.toLowerCase();
    if (seenBlocks.has(key)) {
      diags.push({
        code: IucrCifErrorCode.DUPLICATE_DATA_BLOCK.code,
        rule: IucrCifErrorCode.DUPLICATE_DATA_BLOCK.rule,
        severity: IucrCifErrorCode.DUPLICATE_DATA_BLOCK.severity,
        message: IucrCifErrorCode.DUPLICATE_DATA_BLOCK.message(block.name),
        line: block.line,
        column: block.column,
        blockName: block.name,
      });
    } else {
      seenBlocks.add(key);
    }

    // ICIF2002: Duplicate tags in same block (scalar + loop)
    const seenTags = new Set<string>();
    for (const entry of block.tagEntries) {
      if (seenTags.has(entry.canonicalTag)) {
        diags.push({
          code: IucrCifErrorCode.DUPLICATE_TAG.code,
          rule: IucrCifErrorCode.DUPLICATE_TAG.rule,
          severity: IucrCifErrorCode.DUPLICATE_TAG.severity,
          message: IucrCifErrorCode.DUPLICATE_TAG.message(entry.tag, block.name),
          line: entry.line,
          column: entry.column,
          blockName: block.name,
          tag: entry.tag,
        });
      } else {
        seenTags.add(entry.canonicalTag);
      }
    }

    // Loop checks: ICIF2002, ICIF3001, ICIF3002, ICIF5001, ICIF5002, ICIF5005, ICIF5006
    for (const loop of block.loops) {
      if (loop.tags.length === 0) {
        diags.push({
          code: IucrCifErrorCode.EMPTY_LOOP.code,
          rule: IucrCifErrorCode.EMPTY_LOOP.rule,
          severity: IucrCifErrorCode.EMPTY_LOOP.severity,
          message: IucrCifErrorCode.EMPTY_LOOP.message("loop_ has no column tags"),
          line: loop.line,
          column: loop.column,
          blockName: block.name,
        });
        continue;
      }

      for (let tIdx = 0; tIdx < loop.tags.length; tIdx++) {
        const cTag = loop.canonicalTags[tIdx]!;
        const rawTag = loop.tags[tIdx]!;
        if (seenTags.has(cTag)) {
          diags.push({
            code: IucrCifErrorCode.DUPLICATE_TAG.code,
            rule: IucrCifErrorCode.DUPLICATE_TAG.rule,
            severity: IucrCifErrorCode.DUPLICATE_TAG.severity,
            message: IucrCifErrorCode.DUPLICATE_TAG.message(rawTag, block.name),
            line: loop.line,
            column: loop.column,
            blockName: block.name,
            tag: rawTag,
          });
        } else {
          seenTags.add(cTag);
        }
      }

      if (loop.rawValueCount === 0) {
        diags.push({
          code: IucrCifErrorCode.EMPTY_LOOP.code,
          rule: IucrCifErrorCode.EMPTY_LOOP.rule,
          severity: IucrCifErrorCode.EMPTY_LOOP.severity,
          message: IucrCifErrorCode.EMPTY_LOOP.message("loop_ has no data rows"),
          line: loop.line,
          column: loop.column,
          blockName: block.name,
        });
      } else if (loop.rawValueCount % loop.tags.length !== 0) {
        diags.push({
          code: IucrCifErrorCode.LOOP_COLUMN_MISMATCH.code,
          rule: IucrCifErrorCode.LOOP_COLUMN_MISMATCH.rule,
          severity: IucrCifErrorCode.LOOP_COLUMN_MISMATCH.severity,
          message: IucrCifErrorCode.LOOP_COLUMN_MISMATCH.message(String(loop.rawValueCount), String(loop.tags.length)),
          line: loop.line,
          column: loop.column,
          blockName: block.name,
        });
      }

      // ICIF5005: Validate symmetry operations
      const symIdx = loop.canonicalTags.findIndex(
        (t) => t === "_symmetry_equiv_pos_as_xyz" || t === "_space_group_symop_operation_xyz",
      );
      if (symIdx >= 0) {
        for (const row of loop.rows) {
          const cell = row[symIdx];
          if (!cell || cell.kind === "unknown" || cell.kind === "inapplicable") continue;
          if (!parseSymmetryOp(cell.value)) {
            diags.push({
              code: IucrCifErrorCode.INVALID_SYMMETRY_OP.code,
              rule: IucrCifErrorCode.INVALID_SYMMETRY_OP.rule,
              severity: IucrCifErrorCode.INVALID_SYMMETRY_OP.severity,
              message: IucrCifErrorCode.INVALID_SYMMETRY_OP.message(cell.value),
              line: cell.line,
              column: cell.column,
              blockName: block.name,
              tag: loop.tags[symIdx],
            });
          }
        }
      }

      // ICIF5001: Atom site loop missing fract_x/y/z
      const isAtomSiteLoop = loop.canonicalTags.some((t) => t.startsWith("_atom_site_"));
      if (isAtomSiteLoop) {
        const missingCoords: string[] = [];
        if (!loop.canonicalTags.includes("_atom_site_fract_x")) missingCoords.push("_atom_site_fract_x");
        if (!loop.canonicalTags.includes("_atom_site_fract_y")) missingCoords.push("_atom_site_fract_y");
        if (!loop.canonicalTags.includes("_atom_site_fract_z")) missingCoords.push("_atom_site_fract_z");
        if (missingCoords.length > 0) {
          diags.push({
            code: IucrCifErrorCode.MISSING_ATOM_FRACT_COORDS.code,
            rule: IucrCifErrorCode.MISSING_ATOM_FRACT_COORDS.rule,
            severity: IucrCifErrorCode.MISSING_ATOM_FRACT_COORDS.severity,
            message: IucrCifErrorCode.MISSING_ATOM_FRACT_COORDS.message(missingCoords.join(", ")),
            line: loop.line,
            column: loop.column,
            blockName: block.name,
          });
        }

        // ICIF5002: Fractional occupancy in (0, 1]
        const occIdx = loop.canonicalTags.indexOf("_atom_site_occupancy");
        const labelIdx = loop.canonicalTags.indexOf("_atom_site_label");
        const symColIdx = loop.canonicalTags.indexOf("_atom_site_type_symbol");

        for (let r = 0; r < loop.rows.length; r++) {
          const row = loop.rows[r]!;
          const label = labelIdx >= 0 && row[labelIdx] ? row[labelIdx].value : `Atom${r + 1}`;

          if (occIdx >= 0 && row[occIdx]) {
            const occCell = row[occIdx];
            if (occCell.kind !== "unknown" && occCell.kind !== "inapplicable") {
              const occNum = occCell.numeric ?? parseCifNumber(occCell.value);
              if (!occNum || occNum.value <= 0 || occNum.value > 1.0 + 1e-6) {
                diags.push({
                  code: IucrCifErrorCode.INVALID_OCCUPANCY.code,
                  rule: IucrCifErrorCode.INVALID_OCCUPANCY.rule,
                  severity: IucrCifErrorCode.INVALID_OCCUPANCY.severity,
                  message: IucrCifErrorCode.INVALID_OCCUPANCY.message(label, occCell.raw),
                  line: occCell.line,
                  column: occCell.column,
                  blockName: block.name,
                  tag: "_atom_site_occupancy",
                });
              }
            }
          }

          // ICIF5006: Unknown chemical element symbol
          const rawSymCell = symColIdx >= 0 ? row[symColIdx] : labelIdx >= 0 ? row[labelIdx] : undefined;
          if (rawSymCell && rawSymCell.kind !== "unknown" && rawSymCell.kind !== "inapplicable") {
            const elem = normalizeElementSymbol(rawSymCell.value);
            if (!elem || !isKnownElement(elem)) {
              diags.push({
                code: IucrCifErrorCode.UNKNOWN_ELEMENT_SYMBOL.code,
                rule: IucrCifErrorCode.UNKNOWN_ELEMENT_SYMBOL.rule,
                severity: IucrCifErrorCode.UNKNOWN_ELEMENT_SYMBOL.severity,
                message: IucrCifErrorCode.UNKNOWN_ELEMENT_SYMBOL.message(rawSymCell.value, label),
                line: rawSymCell.line,
                column: rawSymCell.column,
                blockName: block.name,
                tag: symColIdx >= 0 ? "_atom_site_type_symbol" : "_atom_site_label",
              });
            }
          }
        }
      }
    }

    // Unit cell parameter checks: ICIF4001, ICIF4002, ICIF4003, ICIF5004
    const lengthTags = ["_cell_length_a", "_cell_length_b", "_cell_length_c"] as const;
    const angleTags = ["_cell_angle_alpha", "_cell_angle_beta", "_cell_angle_gamma"] as const;
    const presentCellTags = [...lengthTags, ...angleTags].filter((t) => block.tags.has(t));

    let cellValid = true;
    if (presentCellTags.length > 0 && presentCellTags.length < 6) {
      const missing = [...lengthTags, ...angleTags].filter((t) => !block.tags.has(t));
      diags.push({
        code: IucrCifErrorCode.MISSING_CELL_PARAMETERS.code,
        rule: IucrCifErrorCode.MISSING_CELL_PARAMETERS.rule,
        severity: IucrCifErrorCode.MISSING_CELL_PARAMETERS.severity,
        message: IucrCifErrorCode.MISSING_CELL_PARAMETERS.message(missing.join(", ")),
        line: block.line,
        column: block.column,
        blockName: block.name,
      });
    }

    for (const tag of lengthTags) {
      const entry = block.tags.get(tag);
      if (!entry) continue;
      const num = entry.value.numeric ?? parseCifNumber(entry.value.value);
      if (!num || num.value <= 0) {
        cellValid = false;
        diags.push({
          code: IucrCifErrorCode.NON_POSITIVE_CELL_LENGTH.code,
          rule: IucrCifErrorCode.NON_POSITIVE_CELL_LENGTH.rule,
          severity: IucrCifErrorCode.NON_POSITIVE_CELL_LENGTH.severity,
          message: IucrCifErrorCode.NON_POSITIVE_CELL_LENGTH.message(tag, entry.value.raw),
          line: entry.line,
          column: entry.column,
          blockName: block.name,
          tag,
        });
      }
    }

    for (const tag of angleTags) {
      const entry = block.tags.get(tag);
      if (!entry) continue;
      const num = entry.value.numeric ?? parseCifNumber(entry.value.value);
      if (!num || num.value <= 0 || num.value >= 180) {
        cellValid = false;
        diags.push({
          code: IucrCifErrorCode.INVALID_CELL_ANGLE.code,
          rule: IucrCifErrorCode.INVALID_CELL_ANGLE.rule,
          severity: IucrCifErrorCode.INVALID_CELL_ANGLE.severity,
          message: IucrCifErrorCode.INVALID_CELL_ANGLE.message(tag, entry.value.raw),
          line: entry.line,
          column: entry.column,
          blockName: block.name,
          tag,
        });
      }
    }

    if (cellValid && presentCellTags.length > 0) {
      const structure = extractCrystalStructure(block);
      if (structure) {
        const metric = computeMetricTensor(structure.cell);
        if (metric.detG <= 1e-12) {
          diags.push({
            code: IucrCifErrorCode.DEGENERATE_METRIC_TENSOR.code,
            rule: IucrCifErrorCode.DEGENERATE_METRIC_TENSOR.rule,
            severity: IucrCifErrorCode.DEGENERATE_METRIC_TENSOR.severity,
            message: IucrCifErrorCode.DEGENERATE_METRIC_TENSOR.message(metric.detG.toFixed(6)),
            line: block.line,
            column: block.column,
            blockName: block.name,
          });
        } else if (structure.asymmetricAtoms.length > 0) {
          // ICIF5003: Overlapping atoms < 0.5 Å after symmetry expansion
          const expanded = expandSymmetrySites(structure, metric);
          let overlapCount = 0;
          for (let i = 0; i < expanded.length && overlapCount < 20; i++) {
            const a = expanded[i]!;
            for (let j = i + 1; j < expanded.length && overlapCount < 20; j++) {
              const b = expanded[j]!;
              const { distance } = periodicDistance(metric.G, a.fract, b.fract);
              if (distance < 0.5) {
                overlapCount++;
                const atomLine = structure.asymmetricAtoms[a.asymmetricIndex]?.line ?? block.line;
                diags.push({
                  code: IucrCifErrorCode.OVERLAPPING_ATOMS.code,
                  rule: IucrCifErrorCode.OVERLAPPING_ATOMS.rule,
                  severity: IucrCifErrorCode.OVERLAPPING_ATOMS.severity,
                  message: IucrCifErrorCode.OVERLAPPING_ATOMS.message(a.label, b.label, distance.toFixed(4)),
                  line: atomLine,
                  column: 1,
                  blockName: block.name,
                });
              }
            }
          }
        }
      }
    }
  }

  return diags;
}
