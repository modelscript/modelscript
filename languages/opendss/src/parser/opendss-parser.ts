// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  DssCapacitor,
  DssCapControl,
  DssCircuit,
  DssCNData,
  DssDeck,
  DssFuse,
  DssGenerator,
  DssInvControl,
  DssLine,
  DssLineCode,
  DssLineGeometry,
  DssLineSpacing,
  DssLoad,
  DssLoadShape,
  DssPVSystem,
  DssRange,
  DssRecloser,
  DssRegControl,
  DssRelay,
  DssStorage,
  DssSwtControl,
  DssTccCurve,
  DssTransformer,
  DssTSData,
  DssWireData,
} from "../types.js";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

/**
 * Extract clean bus identifier, removing node/phase suffixes (e.g. "SubBus.1.2.3" -> "SubBus").
 */
export function extractBaseBusName(rawBus: string): string {
  const dot = rawBus.indexOf(".");
  if (dot !== -1) {
    return rawBus.slice(0, dot).trim();
  }
  return rawBus.trim();
}

/**
 * Extract explicit phase/node numbers (1=A, 2=B, 3=C, 0=neutral/ground) from bus specification (e.g. "Bus2.1" -> [1], "Bus2.1.2.3.0" -> [1, 2, 3, 0]).
 * Falls back to 1..phases when no explicit suffix is present.
 */
export function extractPhaseNodes(rawBus: string, defaultPhases: number): number[] {
  const dot = rawBus.indexOf(".");
  if (dot !== -1) {
    const suffix = rawBus.slice(dot + 1).trim();
    const parts = suffix.split(".");
    const nodes: number[] = [];
    for (const p of parts) {
      const n = parseInt(p.trim(), 10);
      if (!isNaN(n) && n >= 0) {
        nodes.push(n);
      }
    }
    if (nodes.length > 0) return nodes;
  }
  const count = Math.max(1, Math.min(3, defaultPhases));
  const def: number[] = [];
  for (let p = 1; p <= count; p++) def.push(p);
  return def;
}

function cleanValue(val: string): string {
  let v = val.trim();
  if (
    (v.startsWith("[") && v.endsWith("]")) ||
    (v.startsWith("(") && v.endsWith(")")) ||
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  // Check if v is an RPN expression e.g. "(8 1000 /)" or "8 1000 /"
  const parts = v.split(/\s+/);
  if (parts.length >= 3 && ["+", "-", "*", "/"].includes(parts[parts.length - 1]!)) {
    const stack: number[] = [];
    let isRpn = true;
    for (const p of parts) {
      if (p === "+" || p === "-" || p === "*" || p === "/") {
        if (stack.length < 2) {
          isRpn = false;
          break;
        }
        const b = stack.pop()!;
        const a = stack.pop()!;
        if (p === "+") stack.push(a + b);
        else if (p === "-") stack.push(a - b);
        else if (p === "*") stack.push(a * b);
        else if (p === "/") stack.push(b !== 0 ? a / b : 0);
      } else {
        const num = parseFloat(p);
        if (isNaN(num)) {
          isRpn = false;
          break;
        }
        stack.push(num);
      }
    }
    if (isRpn && stack.length === 1) {
      return String(stack[0]);
    }
  }
  return v;
}

/**
 * Split line into key-value pairs without regex:
 * e.g. "New Line.L1 Bus1=B1 Bus2=B2 Length=500 Units=m" or "rmatrix = (...)"
 */
function parseKeyValuePairs(tokens: string[]): Map<string, string> {
  const pairs = new Map<string, string>();
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    const eqIdx = tok.indexOf("=");
    if (eqIdx !== -1) {
      const key = tok.slice(0, eqIdx).trim().toLowerCase();
      let val = tok.slice(eqIdx + 1).trim();
      if (val.length === 0 && i + 1 < tokens.length) {
        i++;
        val = tokens[i]!.trim();
      }
      if (key.length > 0) {
        pairs.set(key, cleanValue(val));
      }
    } else if (i + 1 < tokens.length) {
      const nextTok = tokens[i + 1]!;
      if (nextTok === "=") {
        const key = tok.trim().toLowerCase();
        i += 2;
        const val = i < tokens.length ? tokens[i]!.trim() : "";
        if (key.length > 0) {
          pairs.set(key, cleanValue(val));
        }
      } else if (nextTok.startsWith("=")) {
        const key = tok.trim().toLowerCase();
        i++;
        const val = nextTok.slice(1).trim();
        if (key.length > 0) {
          pairs.set(key, cleanValue(val));
        }
      }
    }
    i++;
  }

  return pairs;
}

/**
 * Parse an array of values from a string: e.g. "115, 12.47" or "[b1, b2]"
 */
export function parseArrayValues(raw: string): string[] {
  let s = raw.trim();
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("(") && s.endsWith(")"))) {
    s = s.slice(1, -1).trim();
  }

  const result: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    if (ch === "," || ch === " " || ch === "\t") {
      if (cur.trim().length > 0) {
        result.push(cur.trim());
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) {
    result.push(cur.trim());
  }

  return result;
}

/**
 * Parse a matrix from an OpenDSS string: e.g. "0.1 | 0.05 0.1"
 * Automatically symmetrizes lower-triangular matrices.
 */
export function parseMatrixValues(raw: string): number[][] {
  let s = raw.trim();
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("(") && s.endsWith(")"))) {
    s = s.slice(1, -1).trim();
  }
  const rows: number[][] = [];
  let rowStart = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || s[i] === "|") {
      const rowStr = s.slice(rowStart, i).trim();
      if (rowStr.length > 0) {
        const nums = parseArrayValues(rowStr)
          .map((v) => parseFloat(v))
          .filter((v) => !Number.isNaN(v));
        if (nums.length > 0) rows.push(nums);
      }
      rowStart = i + 1;
    }
  }

  // If lower-triangular symmetric matrix, expand to full N x N
  const n = rows.length;
  if (n > 1) {
    const isLowerTriangular = rows.every((r, idx) => r.length === idx + 1);
    if (isLowerTriangular) {
      const full: number[][] = [];
      for (let r = 0; r < n; r++) {
        full[r] = [];
        for (let c = 0; c < n; c++) {
          full[r]![c] = c <= r ? rows[r]![c]! : rows[c]![r]!;
        }
      }
      return full;
    }
  }

  return rows;
}

/**
 * Conversion factor from length unit to meters.
 */
export function getUnitToMeters(unit?: string): number {
  if (!unit) return 1.0;
  const u = unit.toLowerCase().trim();
  switch (u) {
    case "mi":
    case "mile":
    case "miles":
      return 1609.344;
    case "kft":
      return 304.8;
    case "km":
      return 1000.0;
    case "m":
    case "meter":
    case "meters":
      return 1.0;
    case "ft":
    case "feet":
    case "foot":
      return 0.3048;
    case "in":
    case "inch":
    case "inches":
      return 0.0254;
    case "cm":
      return 0.01;
    case "mm":
      return 0.001;
    default:
      return 1.0;
  }
}

/**
 * Compute the scale factor to multiply a line's length by to convert to the impedance unit (e.g. ft -> mi).
 */
export function getLengthScale(lineUnits?: string, baseUnits?: string): number {
  if (!lineUnits || !baseUnits) return 1.0;
  const lineToM = getUnitToMeters(lineUnits);
  const baseToM = getUnitToMeters(baseUnits);
  return lineToM / baseToM;
}

/**
 * Zero-regex parser for EPRI OpenDSS distribution circuit files (.dss).
 */
export function parseOpenDss(content: string, filename?: string): DssDeck {
  const comments: string[] = [];
  const linesMap = new Map<string, DssLine>();
  const transformers = new Map<string, DssTransformer>();
  const loads = new Map<string, DssLoad>();
  const pvSystems = new Map<string, DssPVSystem>();
  const storages = new Map<string, DssStorage>();
  const capacitors = new Map<string, DssCapacitor>();
  const generators = new Map<string, DssGenerator>();
  const regControls = new Map<string, DssRegControl>();
  const capControls = new Map<string, DssCapControl>();
  const tccCurves = new Map<string, DssTccCurve>();
  const relays = new Map<string, DssRelay>();
  const fuses = new Map<string, DssFuse>();
  const reclosers = new Map<string, DssRecloser>();
  const invControls = new Map<string, DssInvControl>();
  const swtControls = new Map<string, DssSwtControl>();
  const wireData = new Map<string, DssWireData>();
  const cnData = new Map<string, DssCNData>();
  const tsData = new Map<string, DssTSData>();
  const lineSpacings = new Map<string, DssLineSpacing>();
  const lineGeometries = new Map<string, DssLineGeometry>();
  const lineCodes = new Map<string, DssLineCode>();
  const loadShapes = new Map<string, DssLoadShape>();
  const voltageBases: number[] = [];
  let circuit: DssCircuit | undefined;

  // Split lines manually
  const rawLines: string[] = [];
  let lineStart = 0;
  const len = content.length;
  for (let i = 0; i < len; i++) {
    if (content[i] === "\n") {
      rawLines.push(content.slice(lineStart, i));
      lineStart = i + 1;
    } else if (content[i] === "\r") {
      rawLines.push(content.slice(lineStart, i));
      if (i + 1 < len && content[i + 1] === "\n") i++;
      lineStart = i + 1;
    }
  }
  if (lineStart < len) {
    rawLines.push(content.slice(lineStart));
  }

  // Pre-process raw lines:
  // 1. Handle C-style multi-line comments: /* ... */
  // 2. Strip single-line comments: ! and //
  // 3. Handle continuation lines starting with ~
  interface LogicalLine {
    text: string;
    startLine: number;
    endLine: number;
  }
  const logicalLines: LogicalLine[] = [];
  let inBlockComment = false;

  for (let idx = 0; idx < rawLines.length; idx++) {
    let lineText = rawLines[idx] ?? "";
    const lineNum = idx + 1;

    // Handle block comments across lines
    if (inBlockComment) {
      const closeIdx = lineText.indexOf("*/");
      if (closeIdx !== -1) {
        lineText = lineText.slice(closeIdx + 2);
        inBlockComment = false;
      } else {
        continue;
      }
    }

    // Check for inline block comments /* ... */ on current line
    while (true) {
      const openIdx = lineText.indexOf("/*");
      if (openIdx === -1) break;
      const closeIdx = lineText.indexOf("*/", openIdx + 2);
      if (closeIdx !== -1) {
        lineText = lineText.slice(0, openIdx) + " " + lineText.slice(closeIdx + 2);
      } else {
        lineText = lineText.slice(0, openIdx);
        inBlockComment = true;
        break;
      }
    }

    // Strip single-line comments: !, //
    const exclamIdx = lineText.indexOf("!");
    if (exclamIdx !== -1) {
      comments.push(lineText.slice(exclamIdx + 1).trim());
      lineText = lineText.slice(0, exclamIdx);
    }
    const slashSlashIdx = lineText.indexOf("//");
    if (slashSlashIdx !== -1) {
      comments.push(lineText.slice(slashSlashIdx + 2).trim());
      lineText = lineText.slice(0, slashSlashIdx);
    }

    lineText = lineText.trim();
    if (lineText.length === 0) continue;

    // OpenDSS continuation line starts with ~
    if (lineText.startsWith("~")) {
      const cont = lineText.slice(1).trim();
      if (logicalLines.length > 0) {
        const prev = logicalLines[logicalLines.length - 1]!;
        prev.text += " " + cont;
        prev.endLine = lineNum;
        continue;
      }
    }

    logicalLines.push({
      text: lineText,
      startLine: lineNum,
      endLine: lineNum,
    });
  }

  for (const logLine of logicalLines) {
    const lineText = logLine.text;

    // Tokenize words, preserving brackets and quoted strings
    const tokens: string[] = [];
    let i = 0;
    const lLen = lineText.length;
    while (i < lLen) {
      while (i < lLen && isWhitespace(lineText[i] ?? "")) i++;
      if (i >= lLen) break;

      let tok = "";
      let inBrackets = false;
      let inQuotes = false;
      let quoteChar = "";

      while (i < lLen) {
        const ch = lineText[i] ?? "";
        if (!inBrackets && !inQuotes && isWhitespace(ch)) {
          break;
        }

        if (ch === "[" || ch === "(") {
          inBrackets = true;
        } else if (ch === "]" || ch === ")") {
          inBrackets = false;
        } else if (ch === '"' || ch === "'") {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = ch;
          } else if (quoteChar === ch) {
            inQuotes = false;
          }
        }

        tok += ch;
        i++;
      }

      if (tok.length > 0) tokens.push(tok);
    }

    if (tokens.length === 0) continue;

    const firstWord = (tokens[0] ?? "").toLowerCase();
    const range: DssRange = {
      startLine: logLine.startLine,
      startCol: 1,
      endLine: logLine.endLine,
      endCol: lineText.length + 1,
    };

    if (firstWord === "redirect" || firstWord === "compile") {
      const includeFile = tokens
        .slice(1)
        .join(" ")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (includeFile) {
        let resolvedPath = includeFile;
        if (filename) {
          resolvedPath = path.isAbsolute(includeFile) ? includeFile : path.resolve(path.dirname(filename), includeFile);
        }
        try {
          if (fs.existsSync(resolvedPath)) {
            const fileContent = fs.readFileSync(resolvedPath, "utf-8");
            const subDeck = parseOpenDss(fileContent, resolvedPath);
            for (const [k, v] of subDeck.lines) linesMap.set(k, v);
            for (const [k, v] of subDeck.transformers) transformers.set(k, v);
            for (const [k, v] of subDeck.loads) loads.set(k, v);
            for (const [k, v] of subDeck.pvSystems) pvSystems.set(k, v);
            for (const [k, v] of subDeck.storages) storages.set(k, v);
            for (const [k, v] of subDeck.capacitors) capacitors.set(k, v);
            for (const [k, v] of subDeck.generators) generators.set(k, v);
            for (const [k, v] of subDeck.regControls) regControls.set(k, v);
            for (const [k, v] of subDeck.capControls) capControls.set(k, v);
            for (const [k, v] of subDeck.tccCurves) tccCurves.set(k, v);
            for (const [k, v] of subDeck.relays) relays.set(k, v);
            for (const [k, v] of subDeck.fuses) fuses.set(k, v);
            for (const [k, v] of subDeck.reclosers) reclosers.set(k, v);
            for (const [k, v] of subDeck.invControls) invControls.set(k, v);
            for (const [k, v] of subDeck.swtControls) swtControls.set(k, v);
            for (const [k, v] of subDeck.wireData) wireData.set(k, v);
            for (const [k, v] of subDeck.cnData) cnData.set(k, v);
            for (const [k, v] of subDeck.tsData) tsData.set(k, v);
            for (const [k, v] of subDeck.lineSpacings) lineSpacings.set(k, v);
            for (const [k, v] of subDeck.lineGeometries) lineGeometries.set(k, v);
            for (const [k, v] of subDeck.lineCodes) lineCodes.set(k, v);
            if (subDeck.loadShapes) {
              for (const [k, v] of subDeck.loadShapes) loadShapes.set(k, v);
            }
            for (const vb of subDeck.voltageBases) {
              if (!voltageBases.includes(vb)) voltageBases.push(vb);
            }
            if (subDeck.circuit && !circuit) circuit = subDeck.circuit;
          }
        } catch {
          // Gracefully continue in environments where filesystem read is disallowed
        }
      }
      continue;
    }

    if (firstWord === "new" || firstWord === "edit") {
      const target = tokens[1];
      if (!target) continue;
      const dotIdx = target.indexOf(".");
      const elemClass = (dotIdx !== -1 ? target.slice(0, dotIdx) : target).toLowerCase();
      const elemName = dotIdx !== -1 ? target.slice(dotIdx + 1) : "Default";
      const props = parseKeyValuePairs(tokens.slice(2));

      if (elemClass === "circuit") {
        const angleRaw = props.get("angle");
        const freqRaw = props.get("frequency");
        circuit = {
          name: elemName,
          baseKv: parseFloat(props.get("basekv") ?? "115.0") || 115.0,
          pu: parseFloat(props.get("pu") ?? "1.0") || 1.0,
          phases: parseInt(props.get("phases") ?? "3", 10) || 3,
          bus1: extractBaseBusName(props.get("bus1") ?? "SourceBus"),
          angle: angleRaw !== undefined ? parseFloat(angleRaw) : 0,
          frequency: freqRaw !== undefined ? parseFloat(freqRaw) : 60,
          range,
        };
      } else if (elemClass === "line") {
        const rawBus1 = props.get("bus1") ?? "Bus1";
        const rawBus2 = props.get("bus2") ?? "Bus2";
        const bus1 = extractBaseBusName(rawBus1);
        const bus2 = extractBaseBusName(rawBus2);
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const phaseNodes1 = extractPhaseNodes(rawBus1, phases);
        const phaseNodes2 = extractPhaseNodes(rawBus2, phases);
        const length = parseFloat(props.get("length") ?? "1.0") || 1.0;
        const lineCode = props.get("linecode");
        const r1Raw = props.get("r1");
        const x1Raw = props.get("x1");
        const c1Raw = props.get("c1");
        const r0Raw = props.get("r0");
        const x0Raw = props.get("x0");
        const c0Raw = props.get("c0");
        const r1 = r1Raw !== undefined ? parseFloat(r1Raw) : undefined;
        const x1 = x1Raw !== undefined ? parseFloat(x1Raw) : undefined;
        const c1 = c1Raw !== undefined ? parseFloat(c1Raw) : undefined;
        const r0 = r0Raw !== undefined ? parseFloat(r0Raw) : undefined;
        const x0 = x0Raw !== undefined ? parseFloat(x0Raw) : undefined;
        const c0 = c0Raw !== undefined ? parseFloat(c0Raw) : undefined;
        const rmatrixRaw = props.get("rmatrix");
        const xmatrixRaw = props.get("xmatrix");
        const rmatrix = rmatrixRaw !== undefined ? parseMatrixValues(rmatrixRaw) : undefined;
        const xmatrix = xmatrixRaw !== undefined ? parseMatrixValues(xmatrixRaw) : undefined;
        const geometry = props.get("geometry");

        linesMap.set(elemName, {
          name: elemName,
          bus1,
          bus2,
          phases,
          phaseNodes1,
          phaseNodes2,
          length,
          units: props.get("units"),
          lineCode,
          r1,
          x1,
          c1,
          r0,
          x0,
          c0,
          rmatrix,
          xmatrix,
          geometry,
          range,
        });
      } else if (elemClass === "transformer") {
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const windings = parseInt(props.get("windings") ?? "2", 10) || 2;
        const rawBuses = props.get("buses") ?? "";
        const buses = parseArrayValues(rawBuses).map(extractBaseBusName);
        const phaseNodes: number[][] = parseArrayValues(rawBuses).map((b) => extractPhaseNodes(b, phases));
        const rawKvs = props.get("kvs") ?? "";
        const kvs = parseArrayValues(rawKvs).map((v) => parseFloat(v) || 12.47);
        const rawKvas = props.get("kvas") ?? "";
        const kvas = parseArrayValues(rawKvas).map((v) => parseFloat(v) || 1000);
        const pctLoadLossRaw = props.get("%loadloss") ?? props.get("%r");
        const xhlRaw = props.get("xhl");
        const tapsRaw = props.get("taps");
        const taps = tapsRaw ? parseArrayValues(tapsRaw).map((v) => parseFloat(v) || 1.0) : undefined;
        const numTapsRaw = props.get("numtaps");
        const minTapRaw = props.get("mintap");
        const maxTapRaw = props.get("maxtap");
        const connsRaw = props.get("conns") ?? props.get("conn");
        let conn = connsRaw ? parseArrayValues(connsRaw) : undefined;
        const leadLagRaw = props.get("leadlag");
        const leadLag =
          leadLagRaw?.toLowerCase() === "lead"
            ? ("lead" as const)
            : leadLagRaw?.toLowerCase() === "lag"
              ? ("lag" as const)
              : undefined;

        // Parse winding-by-winding properties if wdg=1 ... wdg=2 syntax is present
        let curWdg = 0;
        for (let tIdx = 2; tIdx < tokens.length; tIdx++) {
          const tok = tokens[tIdx]!;
          const eq = tok.indexOf("=");
          if (eq !== -1) {
            const k = tok.slice(0, eq).trim().toLowerCase();
            let v = tok.slice(eq + 1).trim();
            if (v.length === 0 && tIdx + 1 < tokens.length) {
              tIdx++;
              v = tokens[tIdx]!.trim();
            }
            v = cleanValue(v);
            if (k === "wdg" || k === "winding") {
              const wNum = parseInt(v, 10);
              if (!isNaN(wNum) && wNum >= 1) curWdg = wNum - 1;
            } else if (k === "bus") {
              buses[curWdg] = extractBaseBusName(v);
              phaseNodes[curWdg] = extractPhaseNodes(v, phases);
            } else if (k === "kv") {
              const val = parseFloat(v);
              if (!isNaN(val)) kvs[curWdg] = val;
            } else if (k === "kva") {
              const val = parseFloat(v);
              if (!isNaN(val)) kvas[curWdg] = val;
            } else if (k === "conn") {
              if (!conn) conn = [];
              conn[curWdg] = v;
            }
          }
        }

        transformers.set(elemName, {
          name: elemName,
          phases,
          windings,
          buses: buses.length > 0 ? buses : ["Bus1", "Bus2"],
          phaseNodes: phaseNodes.length > 0 ? phaseNodes : undefined,
          kvs: kvs.length > 0 ? kvs : [115.0, 12.47],
          kvas: kvas.length > 0 ? kvas : [10000.0, 10000.0],
          pctLoadLoss: pctLoadLossRaw !== undefined ? parseFloat(pctLoadLossRaw) : undefined,
          xhl: xhlRaw !== undefined ? parseFloat(xhlRaw) : undefined,
          taps,
          numTaps: numTapsRaw !== undefined ? parseInt(numTapsRaw, 10) : undefined,
          minTap: minTapRaw !== undefined ? parseFloat(minTapRaw) : undefined,
          maxTap: maxTapRaw !== undefined ? parseFloat(maxTapRaw) : undefined,
          conn,
          leadLag,
          range,
        });
      } else if (elemClass === "load") {
        const rawBus1 = props.get("bus1") ?? "Bus1";
        const bus1 = extractBaseBusName(rawBus1);
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const phaseNodes = extractPhaseNodes(rawBus1, phases);
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kw = parseFloat(props.get("kw") ?? "100.0");
        const kvar = parseFloat(props.get("kvar") ?? "30.0") || 0.0;
        const pfRaw = props.get("pf");
        const pf = pfRaw !== undefined ? parseFloat(pfRaw) : undefined;
        const modelRaw = props.get("model");
        const daily = props.get("daily");
        const yearly = props.get("yearly");
        const duty = props.get("duty");

        loads.set(elemName, {
          name: elemName,
          bus1,
          phases,
          phaseNodes,
          kv,
          kw: isNaN(kw) ? 100.0 : kw,
          kvar,
          pf: pf !== undefined && !isNaN(pf) ? pf : undefined,
          model: modelRaw !== undefined ? parseInt(modelRaw, 10) : 1,
          daily,
          yearly,
          duty,
          range,
        });
      } else if (elemClass === "pvsystem") {
        const rawBus1 = props.get("bus1") ?? "Bus1";
        const bus1 = extractBaseBusName(rawBus1);
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const phaseNodes = extractPhaseNodes(rawBus1, phases);
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kva = parseFloat(props.get("kva") ?? "500.0") || 500.0;
        const pmpp = parseFloat(props.get("pmpp") ?? "450.0") || 450.0;
        const daily = props.get("daily");
        const yearly = props.get("yearly");
        const duty = props.get("duty");

        pvSystems.set(elemName, {
          name: elemName,
          bus1,
          phases,
          phaseNodes,
          kv,
          kva,
          pmpp,
          daily,
          yearly,
          duty,
          range,
        });
      } else if (elemClass === "storage") {
        const rawBus1 = props.get("bus1") ?? "Bus1";
        const bus1 = extractBaseBusName(rawBus1);
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const phaseNodes = extractPhaseNodes(rawBus1, phases);
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kwRated = parseFloat(props.get("kwrated") ?? "250.0") || 250.0;
        const kwhRated = parseFloat(props.get("kwhrated") ?? "1000.0") || 1000.0;

        storages.set(elemName, {
          name: elemName,
          bus1,
          phases,
          phaseNodes,
          kv,
          kwRated,
          kwhRated,
          range,
        });
      } else if (elemClass === "capacitor") {
        const rawBus1 = props.get("bus1") ?? "Bus1";
        const bus1 = extractBaseBusName(rawBus1);
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const phaseNodes = extractPhaseNodes(rawBus1, phases);
        const kvar = parseFloat(props.get("kvar") ?? "600.0") || 600.0;
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;

        capacitors.set(elemName, {
          name: elemName,
          bus1,
          phases,
          phaseNodes,
          kvar,
          kv,
          range,
        });
      } else if (elemClass === "linecode") {
        const nphases = parseInt(props.get("nphases") ?? "3", 10) || 3;
        const r1Raw = props.get("r1");
        const x1Raw = props.get("x1");
        const c1Raw = props.get("c1");
        const r0Raw = props.get("r0");
        const x0Raw = props.get("x0");
        const c0Raw = props.get("c0");
        const rmatrixRaw = props.get("rmatrix");
        const xmatrixRaw = props.get("xmatrix");
        const cmatrixRaw = props.get("cmatrix");
        const units = props.get("units");
        const baseFreqRaw = props.get("basefreq");

        const rmatrix = rmatrixRaw !== undefined ? parseMatrixValues(rmatrixRaw) : undefined;
        const xmatrix = xmatrixRaw !== undefined ? parseMatrixValues(xmatrixRaw) : undefined;
        const cmatrix = cmatrixRaw !== undefined ? parseMatrixValues(cmatrixRaw) : undefined;
        const r1 = r1Raw !== undefined ? parseFloat(r1Raw) : (rmatrix ? rmatrix[0]?.[0] ?? 0.1 : 0.1);
        const x1 = x1Raw !== undefined ? parseFloat(x1Raw) : (xmatrix ? xmatrix[0]?.[0] ?? 0.4 : 0.4);
        const c1 = c1Raw !== undefined ? parseFloat(c1Raw) : undefined;
        const r0 = r0Raw !== undefined ? parseFloat(r0Raw) : undefined;
        const x0 = x0Raw !== undefined ? parseFloat(x0Raw) : undefined;
        const c0 = c0Raw !== undefined ? parseFloat(c0Raw) : undefined;
        const baseFreq = baseFreqRaw !== undefined ? parseFloat(baseFreqRaw) : undefined;

        lineCodes.set(elemName, {
          name: elemName,
          nphases,
          r1,
          x1,
          c1,
          r0,
          x0,
          c0,
          rmatrix,
          xmatrix,
          cmatrix,
          units,
          baseFreq,
          range,
        });
      } else if (elemClass === "loadshape") {
        const multRaw = props.get("mult") ?? props.get("pmult") ?? "";
        const mult = parseArrayValues(multRaw)
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));
        const qmultRaw = props.get("qmult");
        const qmult = qmultRaw
          ? parseArrayValues(qmultRaw)
              .map((v) => parseFloat(v))
              .filter((v) => !isNaN(v))
          : undefined;
        const npts = parseInt(props.get("npts") ?? String(mult.length), 10) || mult.length || 1;
        const interval = parseFloat(props.get("interval") ?? props.get("hr") ?? "1.0") || 1.0;

        loadShapes.set(elemName, {
          name: elemName,
          npts,
          interval,
          mult,
          qmult,
          range,
        });
      } else if (elemClass === "generator") {
        const rawBus1 = props.get("bus1") ?? "Bus1";
        const bus1 = extractBaseBusName(rawBus1);
        const phases = parseInt(props.get("phases") ?? "3", 10) || 3;
        const phaseNodes = extractPhaseNodes(rawBus1, phases);
        const kv = parseFloat(props.get("kv") ?? "12.47") || 12.47;
        const kw = parseFloat(props.get("kw") ?? "500.0") || 500.0;
        const kvarRaw = props.get("kvar");
        const kvar = kvarRaw !== undefined ? parseFloat(kvarRaw) : 0.0;
        const pfRaw = props.get("pf");
        const pf = pfRaw !== undefined ? parseFloat(pfRaw) : undefined;
        const modelRaw = props.get("model");
        const model = modelRaw !== undefined ? parseInt(modelRaw, 10) : 1;
        const vpuRaw = props.get("vpu");
        const vpu = vpuRaw !== undefined ? parseFloat(vpuRaw) : 1.0;
        const maxKvarRaw = props.get("maxkvar");
        const minKvarRaw = props.get("minkvar");
        const daily = props.get("daily");
        const yearly = props.get("yearly");
        const duty = props.get("duty");

        generators.set(elemName, {
          name: elemName,
          bus1,
          phases,
          phaseNodes,
          kv,
          kw,
          kvar,
          pf,
          model,
          vpu,
          maxKvar: maxKvarRaw !== undefined ? parseFloat(maxKvarRaw) : undefined,
          minKvar: minKvarRaw !== undefined ? parseFloat(minKvarRaw) : undefined,
          daily,
          yearly,
          duty,
          range,
        });
      } else if (elemClass === "regcontrol") {
        const xfmr = props.get("transformer") ?? elemName;
        const winding = parseInt(props.get("winding") ?? "2", 10) || 2;
        const vreg = parseFloat(props.get("vreg") ?? "120.0") || 120.0;
        const band = parseFloat(props.get("band") ?? "2.0") || 2.0;
        const ptRatio = parseFloat(props.get("ptratio") ?? "60.0") || 60.0;
        const ctPrimRaw = props.get("ctprim");
        const ctPrim = ctPrimRaw !== undefined ? parseFloat(ctPrimRaw) : undefined;
        const rRaw = props.get("r");
        const r = rRaw !== undefined ? parseFloat(rRaw) : 0.0;
        const xRaw = props.get("x");
        const x = xRaw !== undefined ? parseFloat(xRaw) : 0.0;
        const rawBus = props.get("bus");
        const bus = rawBus ? extractBaseBusName(rawBus) : undefined;
        const tapNumRaw = props.get("tapnum");
        const tapNum = tapNumRaw !== undefined ? parseInt(tapNumRaw, 10) : 0;
        const maxTapChangeRaw = props.get("maxtapchange");
        const maxTapChange = maxTapChangeRaw !== undefined ? parseInt(maxTapChangeRaw, 10) : 16;

        regControls.set(elemName, {
          name: elemName,
          transformer: xfmr,
          winding,
          vreg,
          band,
          ptRatio,
          ctPrim,
          r,
          x,
          bus,
          tapNum,
          maxTapChange,
          range,
        });
      } else if (elemClass === "capcontrol") {
        const capacitor = props.get("capacitor") ?? elemName;
        const element = props.get("element");
        const termRaw = props.get("terminal");
        const terminal = termRaw !== undefined ? parseInt(termRaw, 10) : 1;
        const typeStr = (props.get("type") ?? "voltage").toLowerCase();
        const type: "voltage" | "kvar" | "current" | "time" =
          typeStr === "kvar" || typeStr === "current" || typeStr === "time" ? typeStr : "voltage";
        const onSetting = parseFloat(props.get("onset") ?? props.get("onsetting") ?? "118.0") || 118.0;
        const offSetting = parseFloat(props.get("offset") ?? props.get("offsetting") ?? "124.0") || 124.0;
        const delayRaw = props.get("delay");
        const delay = delayRaw !== undefined ? parseFloat(delayRaw) : 15.0;
        const ptRatioRaw = props.get("ptratio");
        const ptRatio = ptRatioRaw !== undefined ? parseFloat(ptRatioRaw) : 60.0;
        const ctRatioRaw = props.get("ctratio");
        const ctRatio = ctRatioRaw !== undefined ? parseFloat(ctRatioRaw) : undefined;

        capControls.set(elemName, {
          name: elemName,
          capacitor,
          element,
          terminal,
          type,
          onSetting,
          offSetting,
          delay,
          ptRatio,
          ctRatio,
          range,
        });
      } else if (elemClass === "tcc_curve") {
        const npts = parseInt(props.get("npts") ?? "0", 10);
        const cRaw = props.get("c_array") ?? "";
        const tRaw = props.get("t_array") ?? "";
        const c_array = parseArrayValues(cRaw)
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));
        const t_array = parseArrayValues(tRaw)
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));

        tccCurves.set(elemName, {
          name: elemName,
          npts: npts > 0 ? npts : c_array.length,
          c_array,
          t_array,
          range,
        });
      } else if (elemClass === "relay") {
        const monitoredElement = props.get("monitoredobj") ?? props.get("element") ?? "";
        const termRaw = props.get("monitoredterm") ?? props.get("terminal");
        const monitoredTerminal = termRaw !== undefined ? parseInt(termRaw, 10) : 1;
        const typeStr = (props.get("type") ?? "current").toLowerCase();
        const type = typeStr === "voltage" ? "voltage" : "current";
        const phaseCurve = props.get("phasecurve");
        const groundCurve = props.get("groundcurve");
        const ptRaw = props.get("phasetrip");
        const gtRaw = props.get("groundtrip");
        const phaseTrip = ptRaw !== undefined ? parseFloat(ptRaw) : undefined;
        const groundTrip = gtRaw !== undefined ? parseFloat(gtRaw) : undefined;
        const tdPhaseRaw = props.get("tdphase");
        const tdGroundRaw = props.get("tdground");
        const tdPhase = tdPhaseRaw !== undefined ? parseFloat(tdPhaseRaw) : 1.0;
        const tdGround = tdGroundRaw !== undefined ? parseFloat(tdGroundRaw) : 1.0;

        relays.set(elemName, {
          name: elemName,
          monitoredElement,
          monitoredTerminal,
          type,
          phaseCurve,
          groundCurve,
          phaseTrip,
          groundTrip,
          tdPhase,
          tdGround,
          range,
        });
      } else if (elemClass === "fuse") {
        const monitoredElement = props.get("monitoredobj") ?? props.get("element") ?? "";
        const termRaw = props.get("monitoredterm") ?? props.get("terminal");
        const monitoredTerminal = termRaw !== undefined ? parseInt(termRaw, 10) : 1;
        const fuseCurve = props.get("fusecurve") ?? "";
        const ratedCurrent = parseFloat(props.get("ratedcurrent") ?? props.get("amps") ?? "100.0") || 100.0;

        fuses.set(elemName, {
          name: elemName,
          monitoredElement,
          monitoredTerminal,
          fuseCurve,
          ratedCurrent,
          range,
        });
      } else if (elemClass === "wiredata") {
        const diam = parseFloat(props.get("diam") ?? props.get("dia") ?? "0.5") || 0.5;
        const rdac = parseFloat(props.get("rdac") ?? props.get("rac") ?? props.get("r") ?? "0.1") || 0.1;
        const gmrac = parseFloat(props.get("gmrac") ?? props.get("gmr") ?? "0.01") || 0.01;
        const normAmpsRaw = props.get("normamps");
        const emergAmpsRaw = props.get("emergamps");
        const normAmps = normAmpsRaw !== undefined ? parseFloat(normAmpsRaw) : undefined;
        const emergAmps = emergAmpsRaw !== undefined ? parseFloat(emergAmpsRaw) : undefined;
        const units = props.get("units");

        wireData.set(elemName, {
          name: elemName,
          diam,
          rdac,
          gmrac,
          normAmps,
          emergAmps,
          units,
          range,
        });
      } else if (elemClass === "cndata") {
        const diam = parseFloat(props.get("diam") ?? props.get("dia") ?? "0.5") || 0.5;
        const rdac = parseFloat(props.get("rdac") ?? props.get("rac") ?? props.get("r") ?? "0.1") || 0.1;
        const gmrac = parseFloat(props.get("gmrac") ?? props.get("gmr") ?? "0.01") || 0.01;
        const k = parseInt(props.get("k") ?? "6", 10) || 6;
        const diaStrand = parseFloat(props.get("diastrand") ?? "0.05") || 0.05;
        const gmrStrand = parseFloat(props.get("gmrstrand") ?? "0.01") || 0.01;
        const rStrand = parseFloat(props.get("rstrand") ?? "0.5") || 0.5;
        const epsRRaw = props.get("epsr");
        const insLayerRaw = props.get("inslayer");
        const diaInsRaw = props.get("diains");
        const diaCableRaw = props.get("diacable");

        cnData.set(elemName, {
          name: elemName,
          diam,
          rdac,
          gmrac,
          k,
          diaStrand,
          gmrStrand,
          rStrand,
          epsR: epsRRaw !== undefined ? parseFloat(epsRRaw) : undefined,
          insLayer: insLayerRaw !== undefined ? parseFloat(insLayerRaw) : undefined,
          diaIns: diaInsRaw !== undefined ? parseFloat(diaInsRaw) : undefined,
          diaCable: diaCableRaw !== undefined ? parseFloat(diaCableRaw) : undefined,
          range,
        });
      } else if (elemClass === "tsdata") {
        const diam = parseFloat(props.get("diam") ?? props.get("dia") ?? "0.5") || 0.5;
        const rdac = parseFloat(props.get("rdac") ?? props.get("rac") ?? props.get("r") ?? "0.1") || 0.1;
        const gmrac = parseFloat(props.get("gmrac") ?? props.get("gmr") ?? "0.01") || 0.01;
        const diaShield = parseFloat(props.get("diashield") ?? "0.6") || 0.6;
        const tapeLayer = parseFloat(props.get("tapelayer") ?? "0.005") || 0.005;
        const tapeLap = parseFloat(props.get("tapelap") ?? "20.0") || 20.0;
        const epsRRaw = props.get("epsr");
        const diaInsRaw = props.get("diains");
        const diaCableRaw = props.get("diacable");

        tsData.set(elemName, {
          name: elemName,
          diam,
          rdac,
          gmrac,
          diaShield,
          tapeLayer,
          tapeLap,
          epsR: epsRRaw !== undefined ? parseFloat(epsRRaw) : undefined,
          diaIns: diaInsRaw !== undefined ? parseFloat(diaInsRaw) : undefined,
          diaCable: diaCableRaw !== undefined ? parseFloat(diaCableRaw) : undefined,
          range,
        });
      } else if (elemClass === "linespacing") {
        const nconds = parseInt(props.get("nconds") ?? "3", 10) || 3;
        const nphases = parseInt(props.get("nphases") ?? props.get("phases") ?? "3", 10) || 3;
        const rawX = props.get("x") ?? "";
        const rawY = props.get("y") ?? props.get("h") ?? "";
        const x = parseArrayValues(rawX)
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));
        const y = parseArrayValues(rawY)
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));
        const units = props.get("units");

        lineSpacings.set(elemName, {
          name: elemName,
          nconds,
          nphases,
          x,
          y,
          units,
          range,
        });
      } else if (elemClass === "linegeometry") {
        const nconds = parseInt(props.get("nconds") ?? "3", 10) || 3;
        const nphases = parseInt(props.get("nphases") ?? "3", 10) || 3;
        const rawWires = props.get("wires") ?? "";
        const wires = parseArrayValues(rawWires);
        const spacing = props.get("spacing") ?? "";
        const rawCn = props.get("cncables");
        const cncables = rawCn ? parseArrayValues(rawCn) : undefined;
        const rawTs = props.get("tscables");
        const tscables = rawTs ? parseArrayValues(rawTs) : undefined;
        const reduce = (props.get("reduce") ?? "yes").toLowerCase() !== "no";

        lineGeometries.set(elemName, {
          name: elemName,
          nconds,
          nphases,
          wires,
          spacing,
          cncables,
          tscables,
          reduce,
          range,
        });
      } else if (elemClass === "invcontrol") {
        const rawDerList = props.get("derlist") ?? "";
        const derList = parseArrayValues(rawDerList);
        const modeRaw = (props.get("mode") ?? "VOLTVAR").toUpperCase();
        const mode: "VOLTVAR" | "VOLTWATT" | "DYNAMIC_REACTIVE_CURRENT" | "COMBINED" =
          modeRaw === "VOLTWATT" || modeRaw === "DYNAMIC_REACTIVE_CURRENT" || modeRaw === "COMBINED"
            ? modeRaw
            : "VOLTVAR";
        const rawVx = props.get("voltagecurvex");
        const voltageCurveX = rawVx
          ? parseArrayValues(rawVx)
              .map((v) => parseFloat(v))
              .filter((v) => !isNaN(v))
          : undefined;
        const rawQy = props.get("reactivecurvey");
        const reactiveCurveY = rawQy
          ? parseArrayValues(rawQy)
              .map((v) => parseFloat(v))
              .filter((v) => !isNaN(v))
          : undefined;
        const rawPy = props.get("activecurvey");
        const activeCurveY = rawPy
          ? parseArrayValues(rawPy)
              .map((v) => parseFloat(v))
              .filter((v) => !isNaN(v))
          : undefined;
        const vvcCurve = props.get("vvccurve");
        const vwcCurve = props.get("vwccurve");
        const lowRaw = props.get("voltagelowpu");
        const highRaw = props.get("voltagehighpu");
        const voltageLowPu = lowRaw !== undefined ? parseFloat(lowRaw) : undefined;
        const voltageHighPu = highRaw !== undefined ? parseFloat(highRaw) : undefined;

        invControls.set(elemName, {
          name: elemName,
          derList,
          mode,
          voltageCurveX,
          reactiveCurveY,
          activeCurveY,
          vvcCurve,
          vwcCurve,
          voltageLowPu,
          voltageHighPu,
          range,
        });
      } else if (elemClass === "recloser") {
        const monitoredElement = props.get("monitoredobj") ?? props.get("element") ?? "";
        const termRaw = props.get("monitoredterm") ?? props.get("terminal");
        const monitoredTerminal = termRaw !== undefined ? parseInt(termRaw, 10) : 1;
        const numFastShots = parseInt(props.get("numfastshots") ?? props.get("shots") ?? "2", 10) || 2;
        const numSlowShots = parseInt(props.get("numslowshots") ?? "2", 10) || 2;
        const fastCurve = props.get("fastcurve") ?? props.get("phasefast");
        const slowCurve = props.get("slowcurve") ?? props.get("phaseslow");
        const phaseTrip = parseFloat(props.get("phasetrip") ?? "100.0") || 100.0;
        const gtRaw = props.get("groundtrip");
        const groundTrip = gtRaw !== undefined ? parseFloat(gtRaw) : undefined;
        const tdPhaseRaw = props.get("tdphase");
        const tdPhase = tdPhaseRaw !== undefined ? parseFloat(tdPhaseRaw) : 1.0;
        const tdGroundRaw = props.get("tdground");
        const tdGround = tdGroundRaw !== undefined ? parseFloat(tdGroundRaw) : 1.0;
        const resetTimeSeconds = parseFloat(props.get("resettime") ?? props.get("reset") ?? "15.0") || 15.0;
        const rawIntervals = props.get("intervals");
        const intervalSeconds = rawIntervals
          ? parseArrayValues(rawIntervals)
              .map((v) => parseFloat(v))
              .filter((v) => !isNaN(v))
          : [2.0, 2.0];

        reclosers.set(elemName, {
          name: elemName,
          monitoredElement,
          monitoredTerminal,
          numFastShots,
          numSlowShots,
          fastCurve,
          slowCurve,
          phaseTrip,
          groundTrip,
          tdPhase,
          tdGround,
          resetTimeSeconds,
          intervalSeconds,
          range,
        });
      } else if (elemClass === "swtcontrol") {
        const switchedObj = props.get("switchedobj") ?? props.get("element") ?? "";
        const termRaw = props.get("switchedterm") ?? props.get("terminal");
        const switchedTerm = termRaw !== undefined ? parseInt(termRaw, 10) : 1;
        const actionStr = (props.get("action") ?? "open").toLowerCase();
        const action: "open" | "close" = actionStr === "close" ? "close" : "open";
        const lock = (props.get("lock") ?? "no").toLowerCase() === "yes";

        swtControls.set(elemName, {
          name: elemName,
          switchedObj,
          switchedTerm,
          action,
          lock,
          range,
        });
      }
    } else if (firstWord === "set") {
      const rest = tokens.slice(1).join(" ");
      const eqIdx = rest.indexOf("=");
      if (eqIdx !== -1) {
        const prop = rest.slice(0, eqIdx).trim().toLowerCase();
        const val = rest.slice(eqIdx + 1).trim();
        if (prop.startsWith("voltagebases")) {
          const vals = parseArrayValues(val);
          for (const v of vals) {
            const num = parseFloat(v);
            if (!isNaN(num)) voltageBases.push(num);
          }
        }
      }
    }
  }

  return {
    circuit,
    lines: linesMap,
    transformers,
    loads,
    pvSystems,
    storages,
    capacitors,
    generators,
    regControls,
    capControls,
    tccCurves,
    relays,
    fuses,
    reclosers,
    invControls,
    swtControls,
    wireData,
    cnData,
    tsData,
    lineSpacings,
    lineGeometries,
    lineCodes,
    loadShapes,
    voltageBases,
    comments,
    sourceFile: filename,
  };
}

/**
 * Serialize an OpenDSS AST back into .dss script text.
 */
export function serializeOpenDss(deck: DssDeck): string {
  const lines: string[] = [];

  lines.push("! ModelScript OpenDSS Circuit Serializer");
  for (const c of deck.comments) {
    lines.push(`! ${c}`);
  }
  lines.push("Clear");
  lines.push("");

  if (deck.circuit) {
    const c = deck.circuit;
    lines.push(`New Circuit.${c.name} basekv=${c.baseKv} pu=${c.pu} phases=${c.phases} bus1=${c.bus1}`);
  }

  if (deck.wireData) {
    for (const [, w] of deck.wireData) {
      let s = `New WireData.${w.name} diam=${w.diam} rdac=${w.rdac} gmrac=${w.gmrac}`;
      if (w.units) s += ` units=${w.units}`;
      lines.push(s);
    }
  }

  if (deck.cnData) {
    for (const [, cn] of deck.cnData) {
      lines.push(
        `New CNData.${cn.name} diam=${cn.diam} rdac=${cn.rdac} gmrac=${cn.gmrac} k=${cn.k} diastrand=${cn.diaStrand} gmrstrand=${cn.gmrStrand} rstrand=${cn.rStrand}`,
      );
    }
  }

  if (deck.tsData) {
    for (const [, ts] of deck.tsData) {
      lines.push(
        `New TSData.${ts.name} diam=${ts.diam} rdac=${ts.rdac} gmrac=${ts.gmrac} diashield=${ts.diaShield} tapelayer=${ts.tapeLayer} tapelap=${ts.tapeLap}`,
      );
    }
  }

  if (deck.lineSpacings) {
    for (const [, ls] of deck.lineSpacings) {
      lines.push(
        `New LineSpacing.${ls.name} nconds=${ls.nconds} nphases=${ls.nphases} x=[${ls.x.join(", ")}] y=[${ls.y.join(", ")}]`,
      );
    }
  }

  if (deck.lineGeometries) {
    for (const [, lg] of deck.lineGeometries) {
      let s = `New LineGeometry.${lg.name} nconds=${lg.nconds} nphases=${lg.nphases} wires=[${lg.wires.join(", ")}] spacing=${lg.spacing} reduce=${lg.reduce ? "yes" : "no"}`;
      if (lg.cncables) s += ` cncables=[${lg.cncables.join(", ")}]`;
      if (lg.tscables) s += ` tscables=[${lg.tscables.join(", ")}]`;
      lines.push(s);
    }
  }

  for (const [, lc] of deck.lineCodes) {
    lines.push(`New LineCode.${lc.name} nphases=${lc.nphases} r1=${lc.r1} x1=${lc.x1}`);
  }

  for (const [, xfmr] of deck.transformers) {
    let s = `New Transformer.${xfmr.name} phases=${xfmr.phases} windings=${xfmr.windings} buses=[${xfmr.buses.join(", ")}] kvs=[${xfmr.kvs.join(", ")}] kvas=[${xfmr.kvas.join(", ")}]`;
    if (xfmr.conn) s += ` conns=[${xfmr.conn.join(", ")}]`;
    if (xfmr.leadLag) s += ` leadlag=${xfmr.leadLag}`;
    lines.push(s);
  }

  for (const [, line] of deck.lines) {
    let s = `New Line.${line.name} bus1=${line.bus1} bus2=${line.bus2} phases=${line.phases} length=${line.length}`;
    if (line.lineCode) s += ` linecode=${line.lineCode}`;
    if (line.geometry) s += ` geometry=${line.geometry}`;
    if (line.r1 !== undefined) s += ` r1=${line.r1}`;
    if (line.x1 !== undefined) s += ` x1=${line.x1}`;
    lines.push(s);
  }

  for (const [, cap] of deck.capacitors) {
    lines.push(`New Capacitor.${cap.name} bus1=${cap.bus1} phases=${cap.phases} kvar=${cap.kvar} kv=${cap.kv}`);
  }

  for (const [, load] of deck.loads) {
    lines.push(
      `New Load.${load.name} bus1=${load.bus1} phases=${load.phases} kv=${load.kv} kw=${load.kw} kvar=${load.kvar}`,
    );
  }

  for (const [, pv] of deck.pvSystems) {
    lines.push(`New PVSystem.${pv.name} bus1=${pv.bus1} phases=${pv.phases} kv=${pv.kv} kva=${pv.kva} pmpp=${pv.pmpp}`);
  }

  for (const [, st] of deck.storages) {
    lines.push(
      `New Storage.${st.name} bus1=${st.bus1} phases=${st.phases} kv=${st.kv} kwrated=${st.kwRated} kwhrated=${st.kwhRated}`,
    );
  }

  if (deck.generators) {
    for (const [, gen] of deck.generators) {
      let s = `New Generator.${gen.name} bus1=${gen.bus1} phases=${gen.phases} kv=${gen.kv} kw=${gen.kw}`;
      if (gen.kvar !== undefined) s += ` kvar=${gen.kvar}`;
      if (gen.model !== undefined) s += ` model=${gen.model}`;
      if (gen.vpu !== undefined) s += ` vpu=${gen.vpu}`;
      lines.push(s);
    }
  }

  if (deck.regControls) {
    for (const [, rc] of deck.regControls) {
      let s = `New RegControl.${rc.name} transformer=${rc.transformer} winding=${rc.winding} vreg=${rc.vreg} band=${rc.band} ptratio=${rc.ptRatio}`;
      if (rc.r !== undefined) s += ` r=${rc.r}`;
      if (rc.x !== undefined) s += ` x=${rc.x}`;
      if (rc.ctPrim !== undefined) s += ` ctprim=${rc.ctPrim}`;
      lines.push(s);
    }
  }

  if (deck.capControls) {
    for (const [, cc] of deck.capControls) {
      lines.push(
        `New CapControl.${cc.name} capacitor=${cc.capacitor} type=${cc.type} onsetting=${cc.onSetting} offsetting=${cc.offSetting}`,
      );
    }
  }

  if (deck.invControls) {
    for (const [, inv] of deck.invControls) {
      let s = `New InvControl.${inv.name} derlist=[${inv.derList.join(", ")}] mode=${inv.mode}`;
      if (inv.voltageCurveX && inv.reactiveCurveY) {
        s += ` voltagecurvex=[${inv.voltageCurveX.join(", ")}] reactivecurvey=[${inv.reactiveCurveY.join(", ")}]`;
      }
      lines.push(s);
    }
  }

  if (deck.tccCurves) {
    for (const [, tcc] of deck.tccCurves) {
      lines.push(
        `New TCC_Curve.${tcc.name} npts=${tcc.npts} c_array=[${tcc.c_array.join(", ")}] t_array=[${tcc.t_array.join(", ")}]`,
      );
    }
  }

  if (deck.relays) {
    for (const [, rel] of deck.relays) {
      let s = `New Relay.${rel.name} monitoredobj=${rel.monitoredElement} type=${rel.type}`;
      if (rel.phaseCurve) s += ` phasecurve=${rel.phaseCurve}`;
      if (rel.phaseTrip !== undefined) s += ` phasetrip=${rel.phaseTrip}`;
      lines.push(s);
    }
  }

  if (deck.reclosers) {
    for (const [, rec] of deck.reclosers) {
      let s = `New Recloser.${rec.name} monitoredobj=${rec.monitoredElement} shots=${rec.numFastShots} phasetrip=${rec.phaseTrip}`;
      if (rec.fastCurve) s += ` fastcurve=${rec.fastCurve}`;
      if (rec.slowCurve) s += ` slowcurve=${rec.slowCurve}`;
      lines.push(s);
    }
  }

  if (deck.fuses) {
    for (const [, f] of deck.fuses) {
      lines.push(
        `New Fuse.${f.name} monitoredobj=${f.monitoredElement} fusecurve=${f.fuseCurve} ratedcurrent=${f.ratedCurrent}`,
      );
    }
  }

  if (deck.swtControls) {
    for (const [, swt] of deck.swtControls) {
      lines.push(
        `New SwtControl.${swt.name} switchedobj=${swt.switchedObj} action=${swt.action} lock=${swt.lock ? "yes" : "no"}`,
      );
    }
  }

  if (deck.voltageBases.length > 0) {
    lines.push(`Set VoltageBases = [${deck.voltageBases.join(", ")}]`);
    lines.push("CalcVoltageBases");
  }

  lines.push("Solve");
  return lines.join("\n") + "\n";
}
