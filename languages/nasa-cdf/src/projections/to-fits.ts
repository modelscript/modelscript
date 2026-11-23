// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Projection to FITS 4.0 80-Character Header Cards (`BINTABLE`).
 */

import type { CdfDocument, CdfVariable } from "../types.js";

function padCard(keyword: string, value: string, comment?: string): string {
  const key = keyword.toUpperCase().slice(0, 8).padEnd(8, " ");
  const body = `${key}= ${value.padStart(20, " ")}${comment ? ` / ${comment}` : ""}`;
  return body.slice(0, 80).padEnd(80, " ");
}

function padStringCard(keyword: string, value: string, comment?: string): string {
  const key = keyword.toUpperCase().slice(0, 8).padEnd(8, " ");
  const escaped = `'${value.replace(/'/g, "''").padEnd(8, " ")}'`;
  const body = `${key}= ${escaped}${comment ? ` / ${comment}` : ""}`;
  return body.slice(0, 80).padEnd(80, " ");
}

function cdfTypeToFitsTform(v: CdfVariable): string {
  const repeat = v.dimSizes.reduce((a, b) => a * Math.max(1, b), 1);
  const prefix = repeat > 1 ? String(repeat) : "1";
  switch (v.dataType) {
    case "CDF_INT1":
    case "CDF_UINT1":
    case "CDF_BYTE":
      return `${prefix}B`;
    case "CDF_INT2":
    case "CDF_UINT2":
      return `${prefix}I`;
    case "CDF_INT4":
    case "CDF_UINT4":
      return `${prefix}J`;
    case "CDF_INT8":
    case "CDF_TIME_TT2000":
      return `${prefix}K`;
    case "CDF_REAL4":
    case "CDF_FLOAT":
      return `${prefix}E`;
    case "CDF_CHAR":
    case "CDF_UCHAR":
      return `${Math.max(1, v.numElements)}A`;
    default:
      return `${prefix}D`;
  }
}

/**
 * Projects a `CdfDocument` into FITS 4.0 Primary + `BINTABLE` extension header cards.
 */
export function nasaCdfToFits(doc: CdfDocument): string {
  const cards: string[] = [];
  const rowCount = Math.max(0, ...doc.variables.map((v) => v.values.length));

  // Primary HDU
  cards.push(padCard("SIMPLE", "T", "Conforms to FITS 4.0 standard"));
  cards.push(padCard("BITPIX", "8", "Character information"));
  cards.push(padCard("NAXIS", "0", "No primary image data"));
  cards.push(padCard("EXTEND", "T", "BINTABLE extension follows"));
  cards.push(padStringCard("ORIGIN", "MODELSCRIPT-CDF", "Projected from @modelscript/nasa-cdf"));
  cards.push(padStringCard("OBJECT", doc.header.fileName.slice(0, 24), "Source CDF dataset"));
  cards.push("END".padEnd(80, " "));

  // BINTABLE Extension HDU
  cards.push(padStringCard("XTENSION", "BINTABLE", "NASA CDF telemetry binary table"));
  cards.push(padCard("BITPIX", "8", "8-bit bytes"));
  cards.push(padCard("NAXIS", "2", "2-dimensional binary table"));
  cards.push(padCard("NAXIS1", String(Math.max(8, doc.variables.length * 8)), "Row width in bytes"));
  cards.push(padCard("NAXIS2", String(rowCount), "Number of telemetry records"));
  cards.push(padCard("PCOUNT", "0", "No heap parameters"));
  cards.push(padCard("GCOUNT", "1", "Single data group"));
  cards.push(padCard("TFIELDS", String(doc.variables.length), "Number of CDF variables"));

  for (let i = 0; i < doc.variables.length; i++) {
    const v = doc.variables[i]!;
    const col = i + 1;
    cards.push(padStringCard(`TTYPE${col}`, v.name.slice(0, 16), `CDF ${v.dataType}`));
    cards.push(padStringCard(`TFORM${col}`, cdfTypeToFitsTform(v), "FITS binary column format"));
    const units = v.attributes["UNITS"]?.values[0];
    if (units !== undefined) {
      cards.push(padStringCard(`TUNIT${col}`, String(units).slice(0, 16), "Physical units"));
    }
  }
  cards.push("END".padEnd(80, " "));

  return cards.join("\n") + "\n";
}
