// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CANONICAL_DYR_MODEL_SCHEMAS,
  DYR_MODEL_CANONICAL_MAP,
  DYR_MODEL_SCHEMAS,
  DYR_SCHEMA_LIST,
  getDyrSchemaById,
  getDyrSchemaId,
  resolveCanonicalDyrModelName,
  resolveDyrModelSchema,
  type DaeArchetypeId,
  type DyrIconSchema,
  type DyrModelParamMeta,
  type DyrModelSchema,
  type DyrSubCategory,
} from "../schema/index.js";
import type { PsseDyrCase } from "../types.js";
import { extractFieldsFromCstTokens, parsePsseCstDocument } from "./cst-tokens.js";
import { materializeDyrCaseFromSoa, parseDyrSoa, type PsseDyrSoaTables } from "./dyr-soa.js";

export {
  CANONICAL_DYR_MODEL_SCHEMAS,
  DYR_MODEL_CANONICAL_MAP,
  DYR_MODEL_SCHEMAS,
  DYR_SCHEMA_LIST,
  getDyrSchemaById,
  getDyrSchemaId,
  materializeDyrCaseFromSoa,
  parseDyrSoa,
  resolveCanonicalDyrModelName,
  resolveDyrModelSchema,
  type DaeArchetypeId,
  type DyrIconSchema,
  type DyrModelParamMeta,
  type DyrModelSchema,
  type DyrSubCategory,
  type PsseDyrSoaTables,
};

const DYR_KNOWN_PREFIXES = [
  "GEN",
  "EX",
  "TG",
  "HY",
  "IEEE",
  "SEXS",
  "SCRX",
  "PSS",
  "STAB",
  "USR",
  "REG",
  "REE",
  "REP",
  "WT",
  "GGOV",
  "GAST",
  "WPID",
  "PIDG",
  "CCGO",
  "DEGO",
  "WSIE",
  "ES",
  "CMPL",
  "CMLD",
  "CLOD",
  "CIM",
  "SVS",
  "CST",
  "CDC",
  "VSC",
  "DER",
  "LDSH",
  "LVSH",
  "UFLS",
  "UVLS",
  "DIST",
  "FRQTP",
  "VTGTP",
  "OEL",
  "UEL",
  "MAXEX",
  "BUSFRQ",
];

function isDyrRecordStart(fields: ReturnType<typeof extractFieldsFromCstTokens>): boolean {
  if (fields.length < 2) return false;
  const f0 = fields[0]!;
  const f1 = fields[1]!;
  if (f0.tokenType === "Number" && f1.tokenType === "QuotedString") {
    const bus = Number(f0.value);
    return Number.isInteger(bus) && bus > 0;
  }
  if (f0.tokenType === "QuotedString" && f1.tokenType === "QuotedString") {
    return true;
  }
  if (
    fields.length >= 4 &&
    f0.tokenType === "Number" &&
    f1.tokenType === "Number" &&
    fields[3]?.tokenType === "QuotedString"
  ) {
    const b0 = Number(f0.value);
    const b1 = Number(f1.value);
    return Number.isInteger(b0) && b0 > 0 && Number.isInteger(b1) && b1 > 0;
  }
  return false;
}

/**
 * Checks whether a document string looks like a PSS/E `.dyr` dynamic model file
 * rather than a `.raw` power-flow file, using WASM CST tokens.
 */
export function isLikelyDyrContent(source: string): boolean {
  const doc = parsePsseCstDocument(source);
  for (const line of doc.lines) {
    if (line.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(line.tokens, source, "whitespace");
    if (!isDyrRecordStart(fields)) return false;
    const modelField =
      fields.length >= 4 && fields[0]?.tokenType === "Number" && fields[1]?.tokenType === "Number"
        ? fields[3]!
        : fields[1]!;
    const modelUpper = modelField.value.toUpperCase();
    return Boolean(DYR_MODEL_SCHEMAS[modelUpper] || DYR_KNOWN_PREFIXES.some((p) => modelUpper.startsWith(p)));
  }
  return false;
}

/**
 * Parses a PSS/E `.dyr` Dynamic Data file into structured dynamic equipment records via
 * the native AssemblyScript WASM linear-memory scanner (`dyr-kernel.wasm`).
 * Supports multi-line records terminated by `/`, `ICON` + `CON` parameters, `USRMDL`,
 * Fortran `D` exponents, and branch/DC/subsystem record headers.
 */
export function parseDyr(source: string): PsseDyrCase {
  const soa = parseDyrSoa(source);
  const dyrCase = materializeDyrCaseFromSoa(soa);

  // Convert UTF-8 byte spans to UTF-16 code-unit spans if non-ASCII characters appeared in comments/strings
  if (soa.utf8Bytes.byteLength !== source.length && dyrCase.records.length > 0) {
    const byteToChar = new Int32Array(soa.utf8Bytes.byteLength + 1);
    let b = 0;
    for (let c = 0; c < source.length; c++) {
      const code = source.charCodeAt(c);
      if (code < 0x80) {
        byteToChar[b++] = c;
      } else if (code < 0x800) {
        byteToChar[b++] = c;
        byteToChar[b++] = c;
      } else if (code >= 0xd800 && code <= 0xdbff && c + 1 < source.length) {
        for (let k = 0; k < 4; k++) byteToChar[b++] = c;
        c++;
      } else {
        for (let k = 0; k < 3; k++) byteToChar[b++] = c;
      }
    }
    byteToChar[b] = source.length;
    for (const rec of dyrCase.records) {
      if (rec.span) {
        rec.span.startOffset = byteToChar[Math.min(rec.span.startOffset, b)] ?? rec.span.startOffset;
        rec.span.endOffset = byteToChar[Math.min(rec.span.endOffset, b)] ?? rec.span.endOffset;
      }
    }
  }

  return dyrCase;
}

/**
 * Serializes a `PsseDyrCase` back to canonical PSS/E `.dyr` text format,
 * preserving `ICON`s, `USRMDL` headers, and branch/DC/bus record formats.
 */
export function writeDyr(dyr: PsseDyrCase): string {
  const lines: string[] = [];
  for (const rec of dyr.records) {
    const paddedModel = `'${rec.model.padEnd(6, " ")}'`;
    const iconPart =
      rec.icons && rec.icons.length > 0
        ? rec.icons.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(" ") + " "
        : "";
    const conStr = rec.con.map((v) => Number(v.toPrecision(6)).toString()).join(" ");
    const trailing = `${iconPart}${conStr}`.trim();

    if (rec.headerKind === "usrmdl" && rec.usrMeta) {
      const u = rec.usrMeta;
      lines.push(
        `${rec.ibus} 'USRMDL' '${rec.id}' ${paddedModel} ${u.ic} ${u.it} ${u.ni} ${u.nc} ${u.ns} ${u.nv} ${trailing} /`,
      );
    } else if (rec.headerKind === "branch" && rec.jbus && rec.jbus > 0) {
      lines.push(`${rec.ibus} ${rec.jbus} '${rec.ckt ?? rec.id}' ${paddedModel} ${trailing} /`);
    } else if (rec.deviceName) {
      lines.push(`'${rec.deviceName}' ${paddedModel} ${trailing} /`);
    } else if (rec.headerKind === "bus") {
      lines.push(`${rec.ibus} ${paddedModel} ${trailing} /`);
    } else {
      lines.push(`${rec.ibus} ${paddedModel} ${rec.id} ${trailing} /`);
    }
  }
  return lines.join("\n") + "\n";
}
