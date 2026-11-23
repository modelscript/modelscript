// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  STEFAN_BOLTZMANN,
  type SindaArray,
  type SindaBlock,
  type SindaConductor,
  type SindaExecutionCall,
  type SindaModel,
  type SindaNode,
  type SindaNodeKind,
  type SindaOptions,
  type SindaParseError,
  type SindaSource,
} from "../types.js";

/**
 * Parses a Fortran/SINDA numeric literal (supports `D`/`d` exponents as well as `E`/`e`).
 */
export function parseSindaNumber(token: string): number {
  const cleaned = token.trim().replace(/[Dd]([+-]?\d+)/g, "e$1");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cleaned)) {
    return Number.NaN;
  }
  return Number(cleaned);
}

/**
 * Strips `$` inline comments from a SINDA line and returns the code portion plus any inline comment.
 */
function stripInlineComment(line: string): { code: string; comment?: string | undefined } {
  const idx = line.indexOf("$");
  if (idx === -1) return { code: line };
  return {
    code: line.slice(0, idx),
    comment: line.slice(idx + 1).trim() || undefined,
  };
}

/**
 * Returns true if a line is a SINDA/Fortran column-1 `C` comment or `$` full-line comment.
 */
function isCommentLine(rawLine: string): boolean {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.startsWith("$") || trimmed.startsWith("*")) return true;
  // Fortran column-1 C comment: 'C' or 'c' at column 0 followed by whitespace, punctuation, or EOL
  if (/^[Cc](?:[\s*\-=!#$].*)?$/.test(rawLine)) {
    return true;
  }
  return false;
}

/**
 * Splits a SINDA data record by commas and/or whitespace.
 */
function tokenizeRecord(code: string): string[] {
  return code
    .trim()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Normalizes a SINDA HEADER directive and extracts the header type and optional submodel name.
 */
function parseHeaderDirective(code: string): { header: string; submodel: string } | null {
  const match = code.trim().match(/^HEADER\s+(.+)$/i);
  if (!match) return null;
  const rest = match[1]!.trim();
  const parts = rest.split(",").map((p) => p.trim());
  const rawHeader = parts[0]!.toUpperCase().replace(/\s+/g, " ");
  const submodel = (parts[1] || "MAIN").toUpperCase();
  return { header: rawHeader, submodel };
}

/**
 * Parses a NASA SINDA / SINDA-FLUINT input deck into a structured `SindaModel`.
 */
export function parseSindaDeck(source: string): SindaModel {
  const lines = source.split(/\r?\n/);

  const options: SindaOptions = {
    abszro: 0.0,
    sigma: STEFAN_BOLTZMANN,
    units: "SI",
    raw: {},
  };

  const nodes = new Map<number, SindaNode>();
  const duplicateNodes: Array<{ id: number; line: number }> = [];
  const conductors = new Map<number, SindaConductor>();
  const duplicateConductors: Array<{ id: number; line: number }> = [];
  const sources: SindaSource[] = [];
  const constants: Record<string, number> = {};
  const arrays = new Map<number, SindaArray>();
  const execution: SindaExecutionCall[] = [];
  const variables1: string[] = [];
  const variables2: string[] = [];
  const outputCalls: string[] = [];
  const parseErrors: SindaParseError[] = [];
  const rawBlocks: SindaBlock[] = [];

  let hasEndOfData = false;
  let currentBlock: SindaBlock | null = null;
  let currentArrayId: number | null = null;
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStartOffset = offset;
    const lineEndOffset = offset + rawLine.length;
    offset = lineEndOffset + 1; // +1 for newline

    if (isCommentLine(rawLine)) continue;

    const { code, comment } = stripInlineComment(rawLine);
    const trimmed = code.trim();
    if (trimmed.length === 0) continue;

    if (/^END\s+OF\s+DATA\b/i.test(trimmed)) {
      hasEndOfData = true;
      if (currentBlock) {
        currentBlock.endLine = lineNum - 1;
        currentBlock = null;
      }
      break;
    }

    const headerInfo = parseHeaderDirective(trimmed);
    if (headerInfo) {
      if (currentBlock) {
        currentBlock.endLine = lineNum - 1;
      }
      currentBlock = {
        header: headerInfo.header,
        submodel: headerInfo.submodel,
        lines: [],
        startLine: lineNum,
        endLine: lineNum,
      };
      rawBlocks.push(currentBlock);
      currentArrayId = null;
      continue;
    }

    if (!currentBlock) {
      parseErrors.push({
        message: `Unexpected statement outside HEADER block: '${trimmed}'`,
        line: lineNum,
        column: 1,
      });
      continue;
    }

    currentBlock.lines.push(trimmed);
    currentBlock.endLine = lineNum;
    const header = currentBlock.header;
    const submodel = currentBlock.submodel;

    if (header.startsWith("OPTIONS")) {
      const titleMatch = trimmed.match(/^TITLE\s*(?:=|\s)\s*(.+)$/i);
      if (titleMatch) {
        const titleVal = titleMatch[1]!.trim().replace(/^['"]|['"]$/g, "");
        options.title = titleVal;
        options.raw["TITLE"] = titleVal;
        continue;
      }

      // Parse key = value pairs (possibly comma-separated)
      const pairs = trimmed.split(",");
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx !== -1) {
          const k = pair.slice(0, eqIdx).trim().toUpperCase();
          const vRaw = pair.slice(eqIdx + 1).trim();
          const vNum = parseSindaNumber(vRaw);
          if (!Number.isNaN(vNum)) {
            options.raw[k] = vNum;
            if (k === "ABSZRO") options.abszro = vNum;
            if (k === "SIGMA") options.sigma = vNum;
          } else {
            const vStr = vRaw.replace(/^['"]|['"]$/g, "");
            options.raw[k] = vStr;
            if (k === "TITLE") options.title = vStr;
            if (k === "UNITS" && (vStr.toUpperCase() === "ENG" || vStr.toUpperCase() === "SI")) {
              options.units = vStr.toUpperCase() as "SI" | "ENG";
            }
          }
        } else if (pair.trim().length > 0) {
          const toks = tokenizeRecord(pair);
          if (toks.length >= 2) {
            const k = toks[0]!.toUpperCase();
            const vStr = toks.slice(1).join(" ");
            const vNum = parseSindaNumber(vStr);
            options.raw[k] = Number.isNaN(vNum) ? vStr : vNum;
            if (k === "ABSZRO" && !Number.isNaN(vNum)) options.abszro = vNum;
            if (k === "SIGMA" && !Number.isNaN(vNum)) options.sigma = vNum;
          }
        }
      }
      continue;
    }

    if (header.startsWith("NODE")) {
      const tokens = tokenizeRecord(trimmed);
      if (tokens.length < 2) {
        parseErrors.push({
          message: `Malformed NODE DATA record '${trimmed}' (expected at least nodeId, T0[, C])`,
          line: lineNum,
          column: 1,
        });
        continue;
      }

      const rawId = parseSindaNumber(tokens[0]!);
      const t0 = parseSindaNumber(tokens[1]!);
      const cap = tokens.length >= 3 ? parseSindaNumber(tokens[2]!) : 0.0;

      if (Number.isNaN(rawId) || !Number.isInteger(rawId) || Number.isNaN(t0) || Number.isNaN(cap)) {
        parseErrors.push({
          message: `Invalid numeric value in NODE DATA record '${trimmed}'`,
          line: lineNum,
          column: 1,
        });
        continue;
      }

      const canonicalId = Math.abs(rawId);
      let kind: SindaNodeKind;
      if (rawId < 0) {
        kind = "boundary";
      } else if (rawId === 0 || cap === 0) {
        kind = "arithmetic";
      } else {
        kind = "diffusion";
      }

      if (nodes.has(canonicalId)) {
        duplicateNodes.push({ id: canonicalId, line: lineNum });
      } else {
        nodes.set(canonicalId, {
          id: canonicalId,
          rawId,
          submodel,
          kind,
          initialTemp: t0,
          capacitance: kind === "boundary" ? 0.0 : cap,
          label: comment,
          line: lineNum,
          column: 1,
          startOffset: lineStartOffset,
          endOffset: lineEndOffset,
        });
      }
      continue;
    }

    if (header.startsWith("CONDUCTOR")) {
      const tokens = tokenizeRecord(trimmed);
      if (tokens.length < 4) {
        parseErrors.push({
          message: `Malformed CONDUCTOR DATA record '${trimmed}' (expected condId, nodeI, nodeJ, G)`,
          line: lineNum,
          column: 1,
        });
        continue;
      }

      const rawId = parseSindaNumber(tokens[0]!);
      const rawI = parseSindaNumber(tokens[1]!);
      const rawJ = parseSindaNumber(tokens[2]!);
      const g = parseSindaNumber(tokens[3]!);

      if (
        Number.isNaN(rawId) ||
        !Number.isInteger(rawId) ||
        rawId === 0 ||
        Number.isNaN(rawI) ||
        !Number.isInteger(rawI) ||
        Number.isNaN(rawJ) ||
        !Number.isInteger(rawJ) ||
        Number.isNaN(g)
      ) {
        parseErrors.push({
          message: `Invalid numeric value in CONDUCTOR DATA record '${trimmed}'`,
          line: lineNum,
          column: 1,
        });
        continue;
      }

      const canonicalId = Math.abs(rawId);
      const kind = rawId < 0 ? "radiation" : "linear";
      const nodeI = Math.abs(rawI);
      const nodeJ = Math.abs(rawJ);

      if (conductors.has(canonicalId)) {
        duplicateConductors.push({ id: canonicalId, line: lineNum });
      } else {
        conductors.set(canonicalId, {
          id: canonicalId,
          rawId,
          submodel,
          kind,
          nodeI,
          nodeJ,
          conductance: g,
          line: lineNum,
          column: 1,
          startOffset: lineStartOffset,
          endOffset: lineEndOffset,
        });
      }
      continue;
    }

    if (header.startsWith("SOURCE")) {
      // Supports "nodeId, Q" or "Q<nodeId> = Q"
      const qAssignMatch = trimmed.match(/^Q(\d+)\s*=\s*(.+)$/i);
      if (qAssignMatch) {
        const nodeId = Number.parseInt(qAssignMatch[1]!, 10);
        const heatLoad = parseSindaNumber(qAssignMatch[2]!);
        if (Number.isNaN(heatLoad)) {
          parseErrors.push({
            message: `Invalid heat load in SOURCE DATA record '${trimmed}'`,
            line: lineNum,
            column: 1,
          });
          continue;
        }
        sources.push({
          nodeId,
          heatLoad,
          submodel,
          line: lineNum,
          startOffset: lineStartOffset,
          endOffset: lineEndOffset,
        });
        continue;
      }

      const tokens = tokenizeRecord(trimmed);
      if (tokens.length < 2) {
        parseErrors.push({
          message: `Malformed SOURCE DATA record '${trimmed}' (expected nodeId, Q)`,
          line: lineNum,
          column: 1,
        });
        continue;
      }
      const rawNodeId = parseSindaNumber(tokens[0]!);
      const heatLoad = parseSindaNumber(tokens[1]!);
      if (Number.isNaN(rawNodeId) || !Number.isInteger(rawNodeId) || Number.isNaN(heatLoad)) {
        parseErrors.push({
          message: `Invalid numeric value in SOURCE DATA record '${trimmed}'`,
          line: lineNum,
          column: 1,
        });
        continue;
      }
      sources.push({
        nodeId: Math.abs(rawNodeId),
        heatLoad,
        submodel,
        line: lineNum,
        startOffset: lineStartOffset,
        endOffset: lineEndOffset,
      });
      continue;
    }

    if (header.startsWith("CONSTANTS") || header.startsWith("CONTROL")) {
      const pairs = trimmed.split(",");
      for (const pair of pairs) {
        const p = pair.trim();
        if (!p) continue;
        const eqIdx = p.indexOf("=");
        if (eqIdx === -1) {
          parseErrors.push({
            message: `Malformed CONSTANTS DATA assignment '${p}' (expected NAME = VALUE)`,
            line: lineNum,
            column: 1,
          });
          continue;
        }
        const key = p.slice(0, eqIdx).trim().toUpperCase();
        const val = parseSindaNumber(p.slice(eqIdx + 1).trim());
        if (Number.isNaN(val)) {
          parseErrors.push({
            message: `Invalid numeric constant '${p}' in CONSTANTS DATA`,
            line: lineNum,
            column: 1,
          });
          continue;
        }
        constants[key] = val;
        if (key === "ABSZRO") options.abszro = val;
        if (key === "SIGMA") options.sigma = val;
      }
      continue;
    }

    if (header.startsWith("ARRAY")) {
      const tokens = tokenizeRecord(trimmed);
      if (tokens.length === 0) continue;
      // Check if line starts a new array (e.g. "101, 0.0, 10.0, 20.0" or "A101 = ...")
      const firstMatch = tokens[0]!.match(/^A?(\d+)$/i);
      if (firstMatch && tokens.length >= 2) {
        const arrId = Number.parseInt(firstMatch[1]!, 10);
        const vals: number[] = [];
        for (let k = 1; k < tokens.length; k++) {
          const v = parseSindaNumber(tokens[k]!);
          if (!Number.isNaN(v)) vals.push(v);
        }
        const existing = arrays.get(arrId);
        if (existing) {
          existing.values.push(...vals);
        } else {
          arrays.set(arrId, { id: arrId, values: vals, line: lineNum });
        }
        currentArrayId = arrId;
      } else if (currentArrayId !== null) {
        const existing = arrays.get(currentArrayId);
        if (existing) {
          for (const tok of tokens) {
            const v = parseSindaNumber(tok);
            if (!Number.isNaN(v)) existing.values.push(v);
          }
        }
      } else {
        parseErrors.push({
          message: `Malformed ARRAY DATA record '${trimmed}'`,
          line: lineNum,
          column: 1,
        });
      }
      continue;
    }

    if (header.startsWith("EXECUTION") || header.startsWith("OPERATIONS")) {
      const callMatch = trimmed.match(/^(?:CALL\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?/i);
      if (callMatch) {
        const routine = callMatch[1]!.toUpperCase();
        const args = callMatch[2]
          ? callMatch[2]
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean)
          : [];
        execution.push({ routine, args, line: lineNum });
      }
      continue;
    }

    if (header.startsWith("VARIABLES 1")) {
      variables1.push(trimmed);
      continue;
    }

    if (header.startsWith("VARIABLES 2")) {
      variables2.push(trimmed);
      continue;
    }

    if (header.startsWith("OUTPUT")) {
      outputCalls.push(trimmed);
      continue;
    }
  }

  return {
    title: options.title ?? "SindaThermalModel",
    options,
    nodes,
    duplicateNodes,
    conductors,
    duplicateConductors,
    sources,
    constants,
    arrays,
    execution,
    variables1,
    variables2,
    outputCalls,
    hasEndOfData,
    parseErrors,
    rawBlocks,
  };
}
