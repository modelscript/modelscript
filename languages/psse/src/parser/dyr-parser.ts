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

/**
 * Checks whether a document string looks like a PSS/E `.dyr` dynamic model file
 * rather than a `.raw` power-flow file, using a zero-allocation first-line scanner.
 */
export function isLikelyDyrContent(source: string): boolean {
  let pos = 0;
  const len = source.length;
  while (pos < len) {
    let nl = source.indexOf("\n", pos);
    if (nl === -1) nl = len;
    const rawLine = source.slice(pos, nl).trim();
    pos = nl + 1;
    if (!rawLine || rawLine.startsWith("//") || rawLine.startsWith("!")) continue;
    // Extract first up to 4 whitespace/comma-separated tokens (respecting single quotes)
    const toks: Array<{ value: string; quoted: boolean }> = [];
    let i = 0;
    while (i < rawLine.length && toks.length < 4) {
      while (i < rawLine.length && (rawLine[i] === " " || rawLine[i] === "\t" || rawLine[i] === ",")) i++;
      if (i >= rawLine.length || rawLine[i] === "/" || rawLine[i] === "!") break;
      if (rawLine[i] === "'") {
        const endQ = rawLine.indexOf("'", i + 1);
        if (endQ === -1) break;
        toks.push({ value: rawLine.slice(i + 1, endQ).trim(), quoted: true });
        i = endQ + 1;
      } else {
        const start = i;
        while (
          i < rawLine.length &&
          rawLine[i] !== " " &&
          rawLine[i] !== "\t" &&
          rawLine[i] !== "," &&
          rawLine[i] !== "/"
        ) {
          i++;
        }
        toks.push({ value: rawLine.slice(start, i), quoted: false });
      }
    }
    if (toks.length < 2) return false;
    const t0 = toks[0]!;
    const t1 = toks[1]!;
    let modelCand: string | null = null;
    if (t1.quoted) {
      // Standard: `IBUS 'MODEL' ...` or `'DEVNAME' 'MODEL' ...`
      if (t0.quoted || (/^\d+$/.test(t0.value) && Number(t0.value) > 0)) {
        modelCand = t1.value;
      }
    } else if (toks.length >= 4 && /^\d+$/.test(t0.value) && /^\d+$/.test(t1.value) && toks[3]!.quoted) {
      // Branch/xfmr DYR header: `IBUS JBUS 'CKT' 'MODEL' ...`
      modelCand = toks[3]!.value;
    }
    if (!modelCand) return false;
    const modelUpper = modelCand.toUpperCase();
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
