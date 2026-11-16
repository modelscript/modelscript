// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance MATPOWER case file (.m) parser.
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/matpower/wasm-parser";
import { groupCstLeavesByLine, type CstNodeLike } from "@modelscript/runtime";
import type { MatpowerBranch, MatpowerBus, MatpowerCase, MatpowerGen, MatpowerGenCost } from "../types.js";

function getMatpowerWasmParser() {
  return getOrLoadLanguageWasmParser("matpower", import.meta.url, createWasmParserSync);
}

type CstLine = { row: number; tokens: CstNodeLike[] };

/**
 * Parses numeric tokens from CST lines inside a MATPOWER matrix block.
 */
function parseMatrixRows(blockLines: CstLine[]): number[][] {
  const rows: number[][] = [];
  let currentRow: number[] = [];

  for (const { tokens } of blockLines) {
    let hasContinuation = false;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const txt = tok.text;
      if (txt === "%" || txt === "//") break;
      if (txt === "...") {
        hasContinuation = true;
        break;
      }
      if (txt === ";") {
        if (currentRow.length > 0) {
          rows.push(currentRow);
          currentRow = [];
        }
        continue;
      }
      // Handle leading '-' before a number token if lexer split them
      if (txt === "-" && i + 1 < tokens.length) {
        const nextNum = Number.parseFloat(tokens[i + 1]!.text);
        if (!Number.isNaN(nextNum)) {
          currentRow.push(-nextNum);
          i++;
          continue;
        }
      }
      for (const part of txt.split(/[\s,;]+/)) {
        if (!part) continue;
        const num = Number.parseFloat(part);
        if (!Number.isNaN(num)) {
          currentRow.push(num);
        }
      }
    }
    if (!hasContinuation && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }
  return rows;
}

/**
 * Extracts CST lines enclosed by `[ ... ]` or `{ ... }` for a given property name.
 */
function extractBlock(lines: CstLine[], prop: string): CstLine[] | null {
  const target = prop.toLowerCase();
  let capturing = false;
  let openChar = "[";
  let closeChar = "]";
  const collected: CstLine[] = [];

  for (const line of lines) {
    if (!capturing) {
      const toks = line.tokens;
      const propIdx = toks.findIndex(
        (t) => t.text.toLowerCase() === target || t.text.toLowerCase() === `mpc.${target}`,
      );
      if (propIdx === -1) continue;
      const eqIdx = toks.findIndex((t, idx) => idx > propIdx && t.text.includes("="));
      if (eqIdx === -1) continue;
      const openIdx = toks.findIndex((t, idx) => idx >= eqIdx && (t.text.includes("[") || t.text.includes("{")));
      if (openIdx === -1) continue;
      openChar = toks[openIdx]!.text.includes("{") ? "{" : "[";
      closeChar = openChar === "{" ? "}" : "]";
      capturing = true;
      const afterOpen = toks.slice(openIdx + 1);
      const closeIdx = afterOpen.findIndex((t) => t.text.includes(closeChar));
      if (closeIdx >= 0) {
        if (closeIdx > 0) collected.push({ row: line.row, tokens: afterOpen.slice(0, closeIdx) });
        return collected;
      }
      if (afterOpen.length > 0) collected.push({ row: line.row, tokens: afterOpen });
    } else {
      const closeIdx = line.tokens.findIndex((t) => t.text.includes(closeChar));
      if (closeIdx >= 0) {
        if (closeIdx > 0) collected.push({ row: line.row, tokens: line.tokens.slice(0, closeIdx) });
        return collected;
      }
      collected.push(line);
    }
  }
  return capturing ? collected : null;
}

/**
 * Parses a MATPOWER case .m string into a typed MatpowerCase structure.
 */
export function parseMatpowerCase(source: string): MatpowerCase {
  const tree = getMatpowerWasmParser().parse(source);
  const cstLines = groupCstLeavesByLine(tree?.rootNode);

  // 1. Extract case name from function definition if present
  let caseName = "case_matpower";
  for (const { tokens } of cstLines) {
    if (tokens[0]?.text.toLowerCase() === "function") {
      const eqIdx = tokens.findIndex((t) => t.text === "=");
      const nameTok = eqIdx >= 0 ? tokens[eqIdx + 1] : tokens[1];
      if (nameTok && /^[A-Za-z_][A-Za-z0-9_]*$/.test(nameTok.text)) {
        caseName = nameTok.text;
      }
      break;
    }
  }

  // 2. Extract version and baseMVA from CST tokens
  let version = "2";
  let baseMVA = 100.0;
  for (const { tokens } of cstLines) {
    const joined = tokens.map((t) => t.text).join(" ");
    const vIdx = tokens.findIndex((t) => t.text.toLowerCase() === "version" || t.text.toLowerCase() === "mpc.version");
    if (vIdx >= 0) {
      const strTok = tokens.slice(vIdx + 1).find((t) => /^['"]/.test(t.text));
      if (strTok) version = strTok.text.replace(/^['"]|['"]$/g, "");
    }
    const bIdx = tokens.findIndex((t) => t.text.toLowerCase() === "basemva" || t.text.toLowerCase() === "mpc.basemva");
    if (bIdx >= 0) {
      const numTok = tokens.slice(bIdx + 1).find((t) => !Number.isNaN(Number.parseFloat(t.text)));
      if (numTok) baseMVA = Number.parseFloat(numTok.text);
    }
    void joined;
  }

  // 3. Extract bus names if available: mpc.bus_name = { 'Bus 1', ... };
  const busNames = new Map<number, string>();
  const busNameBlock = extractBlock(cstLines, "bus_name");
  if (busNameBlock) {
    let idx = 1;
    for (const { tokens } of busNameBlock) {
      for (const tok of tokens) {
        if (/^['"]/.test(tok.text)) {
          const val = tok.text.replace(/^['"]|['"]$/g, "");
          if (val) busNames.set(idx++, val);
        }
      }
    }
  }

  // 4. Parse bus data
  const buses: MatpowerBus[] = [];
  const busBlock = extractBlock(cstLines, "bus");
  if (busBlock) {
    const rows = parseMatrixRows(busBlock);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.length < 13) continue;
      const bus_i = Math.round(row[0]!);
      buses.push({
        bus_i,
        type: Math.round(row[1]!),
        pd: row[2]!,
        qd: row[3]!,
        gs: row[4]!,
        bs: row[5]!,
        area: Math.round(row[6]!),
        vm: row[7]!,
        va: row[8]!,
        baseKv: row[9]!,
        zone: Math.round(row[10]!),
        vmax: row[11]!,
        vmin: row[12]!,
        name: busNames.get(bus_i) ?? `Bus ${bus_i}`,
      });
    }
  }

  // 5. Parse generator data
  const generators: MatpowerGen[] = [];
  const genBlock = extractBlock(cstLines, "gen");
  if (genBlock) {
    const rows = parseMatrixRows(genBlock);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.length < 10) continue;
      generators.push({
        bus: Math.round(row[0]!),
        pg: row[1]!,
        qg: row[2]!,
        qmax: row[3]!,
        qmin: row[4]!,
        vg: row[5]!,
        mbase: row[6] || baseMVA,
        status: Math.round(row[7]!),
        pmax: row[8]!,
        pmin: row[9]!,
        pc1: row[10],
        pc2: row[11],
        qc1min: row[12],
        qc1max: row[13],
        qc2min: row[14],
        qc2max: row[15],
        ramp_agc: row[16],
        ramp_10: row[17],
        ramp_30: row[18],
        ramp_q: row[19],
        apf: row[20],
      });
    }
  }

  // 6. Parse branch data
  const branches: MatpowerBranch[] = [];
  const branchBlock = extractBlock(cstLines, "branch");
  if (branchBlock) {
    const rows = parseMatrixRows(branchBlock);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.length < 11) continue;
      branches.push({
        fbus: Math.round(row[0]!),
        tbus: Math.round(row[1]!),
        r: row[2]!,
        x: row[3]!,
        b: row[4]!,
        rateA: row[5]!,
        rateB: row[6] || 0.0,
        rateC: row[7] || 0.0,
        ratio: row[8] || 0.0,
        angle: row[9] || 0.0,
        status: Math.round(row[10]!),
        angmin: row.length > 11 ? row[11]! : -360.0,
        angmax: row.length > 12 ? row[12]! : 360.0,
      });
    }
  }

  // 7. Parse generator cost data (optional)
  const gencosts: MatpowerGenCost[] = [];
  const gencostBlock = extractBlock(cstLines, "gencost");
  if (gencostBlock) {
    const rows = parseMatrixRows(gencostBlock);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.length < 4) continue;
      gencosts.push({
        model: Math.round(row[0]!),
        startup: row[1]!,
        shutdown: row[2]!,
        ncost: Math.round(row[3]!),
        cost: row.slice(4),
      });
    }
  }

  return {
    caseName,
    version,
    baseMVA,
    bus: buses,
    gen: generators,
    branch: branches,
    gencost: gencosts.length > 0 ? gencosts : undefined,
    busNames: busNames.size > 0 ? busNames : undefined,
  };
}
