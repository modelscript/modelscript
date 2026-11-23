// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/netcdf — Structural, Binary & CF-1.x Convention Linter (`NC1001`–`NC5006`).
 */

import { NetcdfErrorCode } from "../errors.js";
import type { NetcdfDataset, NetcdfDataType, NetcdfDiagnostic, NetcdfDimension } from "../types.js";

function typesCompatibleForFill(attrType: NetcdfDataType, varType: NetcdfDataType): boolean {
  if (attrType === varType) return true;
  if ((attrType === "int" && varType === "long") || (attrType === "long" && varType === "int")) return true;
  // In CDL, un-suffixed floating-point literals default to double even for float vars; allow float/double match
  if (attrType === "double" && varType === "float") return true;
  // Un-suffixed integer literals in CDL default to int for byte/short/float/double
  if (
    attrType === "int" &&
    (varType === "byte" || varType === "short" || varType === "float" || varType === "double")
  ) {
    return true;
  }
  return false;
}

/**
 * Validates a parsed `NetcdfDataset` against NetCDF Classic structural rules and CF-1.x conventions.
 */
export function lintNetcdf(dataset: NetcdfDataset): NetcdfDiagnostic[] {
  const diagnostics: NetcdfDiagnostic[] = [];

  const push = (
    def: { code: string; rule: string; severity: "error" | "warning" | "info" },
    message: string,
    line?: number,
    column?: number,
    symbolName?: string,
  ): void => {
    diagnostics.push({
      id: def.code,
      code: def.code,
      rule: def.rule,
      severity: def.severity,
      message,
      line,
      column,
      symbolName,
    });
  };

  // 1. Propagate syntax / binary parse errors (NC1001, NC1002, NC1003)
  for (const err of dataset.parseErrors) {
    const def =
      err.code === "NC1002"
        ? NetcdfErrorCode.INVALID_MAGIC_HEADER
        : err.code === "NC1003"
          ? NetcdfErrorCode.TRUNCATED_BINARY_STREAM
          : NetcdfErrorCode.SYNTAX_ERROR;
    push(def, err.message, err.line, err.column);
  }

  // 2. Dimension checks (NC2001, NC3001, NC3002)
  const dimMap = new Map<string, NetcdfDimension>();
  let unlimitedCount = 0;

  for (const dim of dataset.dimensions) {
    if (dimMap.has(dim.name)) {
      push(
        NetcdfErrorCode.DUPLICATE_DIMENSION,
        NetcdfErrorCode.DUPLICATE_DIMENSION.message(dim.name),
        dim.line,
        dim.column,
        dim.name,
      );
    } else {
      dimMap.set(dim.name, dim);
    }

    if (dim.isUnlimited) {
      unlimitedCount++;
      if (unlimitedCount > 1) {
        push(
          NetcdfErrorCode.MULTIPLE_UNLIMITED_DIMENSIONS,
          NetcdfErrorCode.MULTIPLE_UNLIMITED_DIMENSIONS.message(dim.name),
          dim.line,
          dim.column,
          dim.name,
        );
      }
    } else if (!Number.isInteger(dim.size) || dim.size <= 0) {
      push(
        NetcdfErrorCode.NON_POSITIVE_DIMENSION,
        NetcdfErrorCode.NON_POSITIVE_DIMENSION.message(dim.name, String(dim.size)),
        dim.line,
        dim.column,
        dim.name,
      );
    }
  }

  // 3. Global attributes checks (NC2003, NC5003)
  const seenGlobalAttrs = new Set<string>();
  let hasConventions = false;
  for (const ga of dataset.globalAttributes) {
    if (ga.name === "Conventions") hasConventions = true;
    if (seenGlobalAttrs.has(ga.name)) {
      push(
        NetcdfErrorCode.DUPLICATE_ATTRIBUTE,
        NetcdfErrorCode.DUPLICATE_ATTRIBUTE.message("global", ga.name),
        ga.line,
        ga.column,
        `:${ga.name}`,
      );
    } else {
      seenGlobalAttrs.add(ga.name);
    }
  }

  if (dataset.variables.length > 0 && !hasConventions) {
    push(
      NetcdfErrorCode.MISSING_CONVENTIONS_ATTR,
      NetcdfErrorCode.MISSING_CONVENTIONS_ATTR.message(dataset.name),
      1,
      1,
      dataset.name,
    );
  }

  // 4. Variable checks (NC2002, NC2003, NC2004, NC3003, NC4001, NC5001, NC5002, NC5004, NC5005, NC5006)
  const seenVars = new Set<string>();

  for (const v of dataset.variables) {
    if (seenVars.has(v.name)) {
      push(
        NetcdfErrorCode.DUPLICATE_VARIABLE,
        NetcdfErrorCode.DUPLICATE_VARIABLE.message(v.name),
        v.line,
        v.column,
        v.name,
      );
    } else {
      seenVars.add(v.name);
    }

    // Check referenced dimensions & compute expected element count
    let allDimsValid = true;
    let expectedCount = 1;
    let hasUnlimitedDim = false;
    let unlimitedDimSize = 0;
    let fixedProduct = 1;

    for (let idx = 0; idx < v.dimensions.length; idx++) {
      const dName = v.dimensions[idx]!;
      const dim = dimMap.get(dName);
      if (!dim) {
        allDimsValid = false;
        push(
          NetcdfErrorCode.UNDEFINED_DIMENSION,
          NetcdfErrorCode.UNDEFINED_DIMENSION.message(v.name, dName),
          v.line,
          v.column,
          v.name,
        );
        continue;
      }
      if (dim.isUnlimited) {
        if (idx > 0) {
          push(
            NetcdfErrorCode.UNLIMITED_NOT_LEADING,
            NetcdfErrorCode.UNLIMITED_NOT_LEADING.message(v.name, dName),
            v.line,
            v.column,
            v.name,
          );
        }
        hasUnlimitedDim = true;
        unlimitedDimSize = dim.size;
      } else if (dim.size > 0) {
        fixedProduct *= dim.size;
      } else {
        allDimsValid = false;
      }
    }

    expectedCount = hasUnlimitedDim ? unlimitedDimSize * fixedProduct : fixedProduct;

    // Duplicate variable attributes
    const seenAttrs = new Set<string>();
    let hasUnits = false;
    let hasNameDesc = false;
    let fillValueAttr:
      { type: NetcdfDataType; value: unknown; line?: number | undefined; column?: number | undefined } | undefined;

    for (const a of v.attributes) {
      if (seenAttrs.has(a.name)) {
        push(
          NetcdfErrorCode.DUPLICATE_ATTRIBUTE,
          NetcdfErrorCode.DUPLICATE_ATTRIBUTE.message(v.name, a.name),
          a.line,
          a.column,
          `${v.name}:${a.name}`,
        );
      } else {
        seenAttrs.add(a.name);
      }

      if (a.name === "units") hasUnits = true;
      if (a.name === "long_name" || a.name === "standard_name") hasNameDesc = true;
      if (a.name === "_FillValue") {
        fillValueAttr = a;
        if (!typesCompatibleForFill(a.type, v.type)) {
          push(
            NetcdfErrorCode.FILL_VALUE_TYPE_MISMATCH,
            NetcdfErrorCode.FILL_VALUE_TYPE_MISMATCH.message(v.name, a.type, v.type),
            a.line ?? v.line,
            a.column ?? v.column,
            `${v.name}:_FillValue`,
          );
        }
      }
      if (a.name === "scale_factor") {
        const val = typeof a.value === "number" ? a.value : Number.NaN;
        if (!Number.isFinite(val) || val === 0) {
          push(
            NetcdfErrorCode.SCALE_OFFSET_INVALID,
            NetcdfErrorCode.SCALE_OFFSET_INVALID.message(v.name, "scale_factor", String(a.value)),
            a.line ?? v.line,
            a.column ?? v.column,
            `${v.name}:scale_factor`,
          );
        }
      }
      if (a.name === "add_offset") {
        const val = typeof a.value === "number" ? a.value : Number.NaN;
        if (!Number.isFinite(val)) {
          push(
            NetcdfErrorCode.SCALE_OFFSET_INVALID,
            NetcdfErrorCode.SCALE_OFFSET_INVALID.message(v.name, "add_offset", String(a.value)),
            a.line ?? v.line,
            a.column ?? v.column,
            `${v.name}:add_offset`,
          );
        }
      }
    }

    // CF-1.x metadata warnings (NC5001, NC5002)
    if (v.type !== "char") {
      if (!hasUnits) {
        push(
          NetcdfErrorCode.MISSING_UNITS_ATTRIBUTE,
          NetcdfErrorCode.MISSING_UNITS_ATTRIBUTE.message(v.name),
          v.line,
          v.column,
          v.name,
        );
      }
      if (!hasNameDesc) {
        push(
          NetcdfErrorCode.MISSING_LONG_NAME,
          NetcdfErrorCode.MISSING_LONG_NAME.message(v.name),
          v.line,
          v.column,
          v.name,
        );
      }
    }

    // Data count vs shape check (NC4001)
    if (allDimsValid && v.data && v.data.length > 0 && v.type !== "char") {
      if (hasUnlimitedDim) {
        if (fixedProduct > 0 && v.data.length % fixedProduct !== 0) {
          push(
            NetcdfErrorCode.DATA_COUNT_MISMATCH,
            NetcdfErrorCode.DATA_COUNT_MISMATCH.message(v.name, String(v.data.length), `a multiple of ${fixedProduct}`),
            v.line,
            v.column,
            v.name,
          );
        } else if (unlimitedDimSize > 0 && v.data.length !== expectedCount) {
          push(
            NetcdfErrorCode.DATA_COUNT_MISMATCH,
            NetcdfErrorCode.DATA_COUNT_MISMATCH.message(v.name, String(v.data.length), String(expectedCount)),
            v.line,
            v.column,
            v.name,
          );
        }
      } else if (v.data.length !== expectedCount) {
        push(
          NetcdfErrorCode.DATA_COUNT_MISMATCH,
          NetcdfErrorCode.DATA_COUNT_MISMATCH.message(v.name, String(v.data.length), String(expectedCount)),
          v.line,
          v.column,
          v.name,
        );
      }
    }

    // Non-finite NaN/Inf check vs _FillValue (NC5004)
    if (v.data && v.data.length > 0 && v.type !== "char") {
      let nonFiniteCount = 0;
      for (const val of v.data) {
        if (typeof val === "number" && !Number.isFinite(val)) {
          nonFiniteCount++;
        }
      }
      if (nonFiniteCount > 0) {
        const fillIsNonFinite =
          fillValueAttr !== undefined &&
          typeof fillValueAttr.value === "number" &&
          !Number.isFinite(fillValueAttr.value);
        if (!fillIsNonFinite) {
          push(
            NetcdfErrorCode.NAN_INF_FILL_VALUE_MISMATCH,
            NetcdfErrorCode.NAN_INF_FILL_VALUE_MISMATCH.message(v.name, String(nonFiniteCount)),
            v.line,
            v.column,
            v.name,
          );
        }
      }
    }
  }

  // 5. Undeclared data assignment targets (NC4002)
  if (dataset.undeclaredDataTargets) {
    for (const target of dataset.undeclaredDataTargets) {
      push(
        NetcdfErrorCode.UNDEFINED_DATA_VARIABLE,
        NetcdfErrorCode.UNDEFINED_DATA_VARIABLE.message(target.name),
        target.line,
        target.column,
        target.name,
      );
    }
  }

  return diagnostics;
}

export { NetcdfErrorCode };
