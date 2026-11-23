// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — NASA CDF Skeleton Table (`.skt`) Parser & Formatter.
 *
 * Parses standard NASA SPDF Skeleton Table sections:
 * - `#header` (`FILE NAME`, `FORMAT`, `DATA ENCODING`, `MAJORITY`, `NUM DIMS`, `DIM SIZES`, `COMPRESSION`, `CHECKSUM`)
 * - `#GLOBALattributes` (attribute names, numbered entries `0: CDF_CHAR { "..." }`)
 * - `#VARIABLEattributes` (declared variable-scope attribute names)
 * - `#variables` / `#zVariables` (variable headers, attribute bindings, and optional record values)
 * - `#end`
 * - `!` line comments
 */

import { NasaCdfErrorCode } from "../errors.js";
import type {
  CdfDocument,
  CdfFileFormat,
  CdfGlobalAttribute,
  CdfHeader,
  CdfMajority,
  CdfParseIssue,
  CdfRecordValue,
  CdfScalarValue,
  CdfVariable,
  CdfVariance,
} from "../types.js";

type SectionKind = "none" | "header" | "global" | "varattrs" | "variables" | "end";

function stripComment(rawLine: string): string {
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < rawLine.length) {
        i++;
        continue;
      }
      if (ch === quoteChar) {
        inQuote = false;
      }
    } else {
      if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === "!") {
        return rawLine.slice(0, i);
      }
    }
  }
  return rawLine;
}

function parseBraceValues(raw: string): CdfScalarValue[] {
  const inner = raw.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!inner) return [];

  const values: CdfScalarValue[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i]!)) i++;
    if (i >= inner.length) break;

    const ch = inner[i]!;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      let str = "";
      while (i < inner.length && inner[i] !== q) {
        if (inner[i] === "\\" && i + 1 < inner.length) {
          i++;
          str += inner[i]!;
        } else {
          str += inner[i]!;
        }
        i++;
      }
      i++; // skip closing quote
      values.push(str);
    } else {
      let tok = "";
      while (i < inner.length && !/[\s,]/.test(inner[i]!)) {
        tok += inner[i]!;
        i++;
      }
      if (tok.length > 0) {
        const num = Number(tok);
        values.push(Number.isFinite(num) && !/^\d{4}-\d{2}-\d{2}T/.test(tok) ? num : tok);
      }
    }
  }
  return values;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parses a NASA CDF Skeleton Table (`.skt`) string into a structured `CdfDocument`.
 */
export function parseCdfSkeleton(source: string, uri?: string): CdfDocument {
  const lines = source.split(/\r?\n/);

  const header: CdfHeader = {
    fileName: "untitled.cdf",
    format: "SINGLE",
    encoding: "NETWORK",
    majority: "ROW_MAJOR",
    numDims: 0,
    dimSizes: [],
    version: 3,
    release: 8,
    increment: 0,
    line: 1,
  };

  let hasHeaderSection = false;
  let hasEndSection = false;
  const globalAttributes: CdfGlobalAttribute[] = [];
  const variableAttributeNames: string[] = [];
  const variables: CdfVariable[] = [];
  const parseIssues: CdfParseIssue[] = [];

  let section: SectionKind = "none";
  let currentGlobalAttr: CdfGlobalAttribute | null = null;
  let currentVar: CdfVariable | null = null;
  let inZVariables = true;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const cleaned = stripComment(lines[idx]!).trim();
    if (!cleaned) continue;

    // Section headers
    if (/^#header\b/i.test(cleaned)) {
      section = "header";
      hasHeaderSection = true;
      header.line = lineNum;
      continue;
    }
    if (/^#GLOBALattributes\b/i.test(cleaned)) {
      section = "global";
      currentGlobalAttr = null;
      continue;
    }
    if (/^#VARIABLEattributes\b/i.test(cleaned)) {
      section = "varattrs";
      continue;
    }
    if (/^#(z?variables)\b/i.test(cleaned)) {
      section = "variables";
      inZVariables = /^#zvariables\b/i.test(cleaned);
      currentVar = null;
      continue;
    }
    if (/^#end\b/i.test(cleaned)) {
      section = "end";
      hasEndSection = true;
      continue;
    }

    if (section === "header") {
      // Skip table divider lines
      if (/^[-=]+$/.test(cleaned)) continue;

      const fileMatch = cleaned.match(/^CDF\s+NAME\s*:\s*(.+)$/i) ?? cleaned.match(/^FILE\s+NAME\s*:\s*(.+)$/i);
      if (fileMatch) {
        header.fileName = unquote(fileMatch[1]!);
        continue;
      }
      const fmtMatch = cleaned.match(/^FORMAT\s*:\s*(\S+)/i);
      if (fmtMatch) {
        const val = fmtMatch[1]!.toUpperCase();
        header.format = val === "MULTI" ? "MULTI" : ("SINGLE" as CdfFileFormat);
        continue;
      }
      const encMatch = cleaned.match(/^DATA\s+ENCODING\s*:\s*(\S+)/i) ?? cleaned.match(/^ENCODING\s*:\s*(\S+)/i);
      if (encMatch) {
        header.encoding = encMatch[1]!.toUpperCase();
        continue;
      }
      const majMatch = cleaned.match(/^MAJORITY\s*:\s*(\S+)/i);
      if (majMatch) {
        const val = majMatch[1]!.toUpperCase();
        header.majority = val === "COLUMN_MAJOR" ? "COLUMN_MAJOR" : ("ROW_MAJOR" as CdfMajority);
        continue;
      }
      const verMatch = cleaned.match(/^VERSION\s*:\s*(\d+)\.(\d+)(?:\.(\d+))?/i);
      if (verMatch) {
        header.version = Number(verMatch[1]);
        header.release = Number(verMatch[2]);
        header.increment = verMatch[3] ? Number(verMatch[3]) : 0;
        continue;
      }
      const compMatch = cleaned.match(/^COMPRESSION\s*:\s*(.+)$/i);
      if (compMatch) {
        header.compression = compMatch[1]!.trim();
        continue;
      }
      const csumMatch = cleaned.match(/^CHECKSUM\s*:\s*(.+)$/i);
      if (csumMatch) {
        header.checksum = csumMatch[1]!.trim();
        continue;
      }
      const dimsMatch = cleaned.match(/^NUM\s+DIMS\s*:\s*(\d+)/i);
      if (dimsMatch) {
        header.numDims = Number(dimsMatch[1]);
        continue;
      }
      const dimSizesMatch = cleaned.match(/^DIM\s+SIZES\s*:\s*(.*)$/i);
      if (dimSizesMatch) {
        const toks = dimSizesMatch[1]!
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean);
        header.dimSizes = toks.map(Number).filter(Number.isFinite);
        continue;
      }
      continue;
    }

    if (section === "global") {
      // Skip column banner lines like "Attribute  Entry  Data"
      if (/^Attribute\b/i.test(cleaned) || /^Name\b/i.test(cleaned) || /^[-=]+$/.test(cleaned)) continue;

      // Global attribute with inline first entry: "Project" 0: CDF_CHAR { "THEMIS" }
      const inlineMatch = cleaned.match(/^"([^"]+)"\s+(\d+)\s*:\s*([A-Za-z0-9_]+)\s*(\{.*\})\s*\.?$/);
      if (inlineMatch) {
        const attrName = inlineMatch[1]!;
        const entryNumber = Number(inlineMatch[2]);
        const dataType = inlineMatch[3]!;
        const values = parseBraceValues(inlineMatch[4]!);
        currentGlobalAttr = {
          name: attrName,
          entries: [{ entryNumber, dataType, values, line: lineNum }],
          line: lineNum,
        };
        globalAttributes.push(currentGlobalAttr);
        continue;
      }

      // Attribute name header line: "Project"
      const attrNameOnly = cleaned.match(/^"([^"]+)"\s*$/);
      if (attrNameOnly) {
        currentGlobalAttr = {
          name: attrNameOnly[1]!,
          entries: [],
          line: lineNum,
        };
        globalAttributes.push(currentGlobalAttr);
        continue;
      }

      // Entry continuation line: 0: CDF_CHAR { "THEMIS" }
      const entryMatch = cleaned.match(/^(\d+)\s*:\s*([A-Za-z0-9_]+)\s*(\{.*\})\s*\.?$/);
      if (entryMatch && currentGlobalAttr) {
        currentGlobalAttr.entries.push({
          entryNumber: Number(entryMatch[1]),
          dataType: entryMatch[2]!,
          values: parseBraceValues(entryMatch[3]!),
          line: lineNum,
        });
        continue;
      }

      if (cleaned === ".") {
        currentGlobalAttr = null;
        continue;
      }

      parseIssues.push({
        code: NasaCdfErrorCode.SYNTAX_ERROR.code,
        message: NasaCdfErrorCode.SYNTAX_ERROR.message(`Unrecognized #GLOBALattributes statement '${cleaned}'`),
        line: lineNum,
        column: 1,
      });
      continue;
    }

    if (section === "varattrs") {
      if (/^[-=]+$/.test(cleaned)) continue;
      const quoted = cleaned.match(/^"([^"]+)"$/);
      if (quoted) {
        variableAttributeNames.push(quoted[1]!);
      } else {
        variableAttributeNames.push(cleaned);
      }
      continue;
    }

    if (section === "variables") {
      if (/^[-=]+$/.test(cleaned)) continue;
      if (cleaned === ".") {
        currentVar = null;
        continue;
      }

      // Record value line: [0] = 12.34  OR  [0] = { 1.0, 2.0, 3.0 }
      const recMatch = cleaned.match(/^\[(\d+)\]\s*=\s*(.+)$/);
      if (recMatch && currentVar) {
        const rhs = recMatch[2]!.trim().replace(/\.$/, "").trim();
        let recVal: CdfRecordValue;
        if (rhs.startsWith("{")) {
          recVal = parseBraceValues(rhs);
        } else if ((rhs.startsWith('"') && rhs.endsWith('"')) || (rhs.startsWith("'") && rhs.endsWith("'"))) {
          recVal = rhs.slice(1, -1);
        } else {
          const num = Number(rhs);
          recVal = Number.isFinite(num) && !/^\d{4}-\d{2}-\d{2}T/.test(rhs) ? num : rhs;
        }
        currentVar.values.push(recVal);
        continue;
      }

      // Variable attribute line: "UNITS" CDF_CHAR { "nT" }
      const varAttrMatch = cleaned.match(/^"([^"]+)"\s+([A-Za-z0-9_]+)\s*(\{.*\})\s*\.?$/);
      if (varAttrMatch && currentVar) {
        const attrName = varAttrMatch[1]!;
        const dataType = varAttrMatch[2]!;
        const values = parseBraceValues(varAttrMatch[3]!);
        currentVar.attributes[attrName] = {
          attributeName: attrName,
          dataType,
          values,
          line: lineNum,
        };
        continue;
      }

      // Variable declaration line:
      // "B_GSE"  CDF_REAL4  1  1:[3]  T  T
      // "EPOCH"  CDF_EPOCH  1  0:[]   T
      const varDeclMatch = cleaned.match(
        /^"([^"]+)"\s+([A-Za-z0-9_]+)\s+(\d+)\s+(\d+)\s*:\s*\[([^\]]*)\]\s+([TF])(?:\s+([TF\s]+))?(?:\s+PAD\s*=\s*(\S+))?$/i,
      );
      if (varDeclMatch) {
        const name = varDeclMatch[1]!;
        const dataType = varDeclMatch[2]!;
        const numElements = Number(varDeclMatch[3]);
        const numDims = Number(varDeclMatch[4]);
        const dimRaw = varDeclMatch[5]!.trim();
        const dimSizes = dimRaw
          ? dimRaw
              .split(/[\s,]+/)
              .map(Number)
              .filter(Number.isFinite)
          : [];
        const recVariance = varDeclMatch[6]!.toUpperCase() as CdfVariance;
        const dimVariances: CdfVariance[] = varDeclMatch[7]
          ? (varDeclMatch[7]!
              .trim()
              .split(/\s+/)
              .map((s) => s.toUpperCase()) as CdfVariance[])
          : dimSizes.map(() => "T");
        let padValue: CdfScalarValue | undefined;
        if (varDeclMatch[8]) {
          const rawPad = unquote(varDeclMatch[8]!);
          const padNum = Number(rawPad);
          padValue = Number.isFinite(padNum) ? padNum : rawPad;
        }

        currentVar = {
          name,
          dataType,
          numElements,
          numDims,
          dimSizes,
          recVariance,
          dimVariances,
          padValue,
          isZVariable: inZVariables,
          attributes: {},
          values: [],
          line: lineNum,
        };
        variables.push(currentVar);
        continue;
      }

      parseIssues.push({
        code: NasaCdfErrorCode.SYNTAX_ERROR.code,
        message: NasaCdfErrorCode.SYNTAX_ERROR.message(`Unrecognized #variables statement '${cleaned}'`),
        line: lineNum,
        column: 1,
      });
    }
  }

  return {
    uri,
    isBinary: false,
    formatVersion: header.version <= 2 ? "v2" : "v3",
    header,
    hasHeaderSection,
    hasEndSection,
    globalAttributes,
    variableAttributeNames,
    variables,
    parseIssues,
  };
}

function formatScalar(val: CdfScalarValue): string {
  if (typeof val === "number") return String(val);
  return `"${val.replace(/"/g, '\\"')}"`;
}

/**
 * Formats a `CdfDocument` back into a canonical NASA CDF Skeleton Table (`.skt`).
 */
export function formatCdfSkeleton(doc: CdfDocument): string {
  const out: string[] = [];
  out.push("! NASA CDF Skeleton Table generated by @modelscript/nasa-cdf");
  out.push("#header");
  out.push(`  CDF NAME: ${doc.header.fileName}`);
  out.push(`  DATA ENCODING: ${doc.header.encoding}`);
  out.push(`  MAJORITY: ${doc.header.majority}`);
  out.push(`  FORMAT: ${doc.header.format}`);
  out.push(`  VERSION: ${doc.header.version}.${doc.header.release}.${doc.header.increment}`);
  if (doc.header.compression) {
    out.push(`  COMPRESSION: ${doc.header.compression}`);
  }
  if (doc.header.checksum) {
    out.push(`  CHECKSUM: ${doc.header.checksum}`);
  }
  out.push("");

  out.push("#GLOBALattributes");
  for (const attr of doc.globalAttributes) {
    if (attr.entries.length === 0) {
      out.push(`  "${attr.name}"`);
    } else {
      for (let i = 0; i < attr.entries.length; i++) {
        const e = attr.entries[i]!;
        const prefix = i === 0 ? `  "${attr.name}"` : "    ";
        const vals = e.values.map(formatScalar).join(", ");
        out.push(`${prefix} ${e.entryNumber}: ${e.dataType} { ${vals} }`);
      }
    }
  }
  out.push("");

  out.push("#VARIABLEattributes");
  const attrNames = new Set(doc.variableAttributeNames);
  for (const v of doc.variables) {
    for (const k of Object.keys(v.attributes)) attrNames.add(k);
  }
  for (const name of attrNames) {
    out.push(`  "${name}"`);
  }
  out.push("");

  out.push("#variables");
  for (const v of doc.variables) {
    const dims = `${v.numDims}:[${v.dimSizes.join(",")}]`;
    const dimVars = v.dimVariances.length > 0 ? ` ${v.dimVariances.join(" ")}` : "";
    out.push(`  "${v.name}"  ${v.dataType}  ${v.numElements}  ${dims}  ${v.recVariance}${dimVars}`);
    for (const attr of Object.values(v.attributes)) {
      const vals = attr.values.map(formatScalar).join(", ");
      out.push(`    "${attr.attributeName}" ${attr.dataType} { ${vals} }`);
    }
    for (let i = 0; i < v.values.length; i++) {
      const rec = v.values[i]!;
      if (Array.isArray(rec)) {
        out.push(`    [${i}] = { ${rec.map(formatScalar).join(", ")} }`);
      } else {
        out.push(`    [${i}] = ${formatScalar(rec)}`);
      }
    }
    out.push("  .");
  }
  out.push("");
  out.push("#end");
  return out.join("\n") + "\n";
}
