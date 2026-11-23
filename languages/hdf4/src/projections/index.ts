// SPDX-License-Identifier: AGPL-3.0-or-later

import { Hdf4DataType, type Hdf4Document } from "../types.js";

function dfntToNetcdfType(code: number): string {
  switch (code) {
    case Hdf4DataType.DFNT_CHAR8:
    case Hdf4DataType.DFNT_UCHAR8:
      return "char";
    case Hdf4DataType.DFNT_INT8:
    case Hdf4DataType.DFNT_UINT8:
      return "byte";
    case Hdf4DataType.DFNT_INT16:
    case Hdf4DataType.DFNT_UINT16:
      return "short";
    case Hdf4DataType.DFNT_INT32:
    case Hdf4DataType.DFNT_UINT32:
      return "int";
    case Hdf4DataType.DFNT_INT64:
    case Hdf4DataType.DFNT_UINT64:
      return "int64";
    case Hdf4DataType.DFNT_FLOAT64:
      return "double";
    case Hdf4DataType.DFNT_FLOAT32:
    default:
      return "float";
  }
}

function formatCdlAttr(val: string | number | number[]): string {
  if (typeof val === "string") return `"${val.replace(/"/g, '\\"')}"`;
  if (Array.isArray(val)) return val.join(", ");
  return String(val);
}

/**
 * Projects an `Hdf4Document` into standard NetCDF Common Data Language (CDL).
 */
export function hdf4ToNetcdfCdl(doc: Hdf4Document): string {
  const lines: string[] = [];
  const safeName = doc.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "hdf4_dataset";
  lines.push(`netcdf ${safeName} {`);

  // Collect unique dimensions
  const dimMap = new Map<string, number>();
  for (const sds of doc.sdsList) {
    for (const d of sds.dims) {
      if (!dimMap.has(d.name)) {
        dimMap.set(d.name, d.size);
      }
    }
  }

  lines.push("dimensions:");
  for (const [dName, dSize] of dimMap) {
    lines.push(`  ${dName} = ${dSize} ;`);
  }

  lines.push("variables:");
  for (const sds of doc.sdsList) {
    const ncType = dfntToNetcdfType(sds.dataType);
    const dimSig = sds.dims.length > 0 ? `(${sds.dims.map((d) => d.name).join(", ")})` : "";
    lines.push(`  ${ncType} ${sds.name}${dimSig} ;`);
    if (sds.unit && !sds.attributes.some((a) => a.name.toLowerCase() === "units")) {
      lines.push(`    ${sds.name}:units = "${sds.unit}" ;`);
    }
    for (const attr of sds.attributes) {
      lines.push(`    ${sds.name}:${attr.name} = ${formatCdlAttr(attr.value)} ;`);
    }
  }

  if (doc.attributes.length > 0) {
    lines.push("");
    lines.push("// global attributes:");
    for (const attr of doc.attributes) {
      lines.push(`  :${attr.name} = ${formatCdlAttr(attr.value)} ;`);
    }
  }

  lines.push("data:");
  for (const sds of doc.sdsList) {
    if (sds.data.length > 0) {
      lines.push(`  ${sds.name} = ${sds.data.join(", ")} ;`);
    }
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}

function escapeCsvCell(val: string | number): string {
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Projects a selected SDS (or first SDS / Vdata) in an `Hdf4Document` to RFC-4180 CSV.
 */
export function hdf4ToCsv(doc: Hdf4Document, targetName?: string): string {
  const sds = targetName ? doc.sdsList.find((s) => s.name === targetName) : doc.sdsList[0];

  if (sds) {
    const lines: string[] = [];
    if (sds.dims.length === 2) {
      const rows = sds.dims[0]?.size ?? 0;
      const cols = sds.dims[1]?.size ?? 0;
      const colName = sds.dims[1]?.name ?? "col";
      const header = [sds.dims[0]?.name ?? "row"];
      for (let c = 0; c < cols; c++) header.push(`${colName}_${c}`);
      lines.push(header.map(escapeCsvCell).join(","));
      for (let r = 0; r < rows; r++) {
        const rowCells: Array<string | number> = [r];
        for (let c = 0; c < cols; c++) {
          rowCells.push(sds.data[r * cols + c] ?? "");
        }
        lines.push(rowCells.map(escapeCsvCell).join(","));
      }
      return lines.join("\n") + "\n";
    }

    // 1D or N-D flattened export
    lines.push(["index", sds.name].map(escapeCsvCell).join(","));
    for (let i = 0; i < sds.data.length; i++) {
      lines.push([i, sds.data[i] ?? ""].map(escapeCsvCell).join(","));
    }
    return lines.join("\n") + "\n";
  }

  const vd = targetName ? doc.vdatas.find((v) => v.name === targetName) : doc.vdatas[0];
  if (vd) {
    const lines: string[] = [];
    lines.push(vd.fields.map((f) => escapeCsvCell(f.name)).join(","));
    for (const rec of vd.records) {
      lines.push(rec.map(escapeCsvCell).join(","));
    }
    return lines.join("\n") + "\n";
  }

  return "";
}
