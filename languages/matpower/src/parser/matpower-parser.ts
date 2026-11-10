// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance MATPOWER case file (.m) parser.
 */

import type { MatpowerBranch, MatpowerBus, MatpowerCase, MatpowerGen, MatpowerGenCost } from "../types.js";

/**
 * Parses numeric tokens from a matrix block in MATPOWER .m format.
 */
function parseMatrixRows(block: string): number[][] {
  const rows: number[][] = [];
  const lines = block.split(/\r?\n/);

  let currentRow: number[] = [];

  for (const rawLine of lines) {
    // Strip comments (% or //)
    let line = rawLine;
    const commentIdx = line.search(/%|\/\//);
    if (commentIdx >= 0) {
      line = line.slice(0, commentIdx);
    }
    line = line.trim();
    if (!line) continue;

    // Check for row terminator ';'
    const segments = line.split(";");
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!.trim();
      if (seg.length > 0) {
        // Split by whitespace or comma
        const tokens = seg.split(/[\s,]+/);
        for (const tok of tokens) {
          const num = Number.parseFloat(tok);
          if (!Number.isNaN(num)) {
            currentRow.push(num);
          }
        }
      }

      // If there is another segment on this line (i.e. we hit a semicolon),
      // or if this segment ended with a semicolon, finalize the current row
      if (s < segments.length - 1 && currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
    }

    // In MATLAB matrix notation, a newline within brackets also terminates a row
    // if the line didn't end with a continuation marker ('...')
    if (!line.endsWith("...") && currentRow.length > 0) {
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
 * Extracts the contents enclosed by `[ ... ]` or `{ ... }` for a given property name.
 */
function extractBlock(text: string, prop: string): string | null {
  const regex = new RegExp(`(?:mpc\\.)?${prop}\\s*=\\s*[\\[\\{]([\\s\\S]*?)[\\]\\}]\\s*;?`, "i");
  const match = text.match(regex);
  return match ? match[1]! : null;
}

/**
 * Parses a MATPOWER case .m string into a typed MatpowerCase structure.
 */
export function parseMatpowerCase(source: string): MatpowerCase {
  // 1. Extract case name from function definition if present
  let caseName = "case_matpower";
  const funcMatch = source.match(/function\s+(?:\[?\s*\w+\s*\]?\s*=\s*)?([A-Za-z0-9_]+)/i);
  if (funcMatch && funcMatch[1]) {
    caseName = funcMatch[1];
  }

  // 2. Extract version and baseMVA
  let version = "2";
  const versionMatch = source.match(/(?:mpc\.)?version\s*=\s*['"]([^'"]+)['"]/i);
  if (versionMatch && versionMatch[1]) {
    version = versionMatch[1];
  }

  let baseMVA = 100.0;
  const baseMvaMatch = source.match(/(?:mpc\.)?baseMVA\s*=\s*([0-9.]+)/i);
  if (baseMvaMatch && baseMvaMatch[1]) {
    baseMVA = Number.parseFloat(baseMvaMatch[1]);
  }

  // 3. Extract bus names if available: mpc.bus_name = { 'Bus 1', ... };
  const busNames = new Map<number, string>();
  const busNameBlock = extractBlock(source, "bus_name");
  if (busNameBlock) {
    const nameMatches = busNameBlock.matchAll(/['"]([^'"]+)['"]/g);
    let idx = 1;
    for (const m of nameMatches) {
      if (m[1]) {
        busNames.set(idx++, m[1]);
      }
    }
  }

  // 4. Parse bus data
  const buses: MatpowerBus[] = [];
  const busBlock = extractBlock(source, "bus");
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
  const genBlock = extractBlock(source, "gen");
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
  const branchBlock = extractBlock(source, "branch");
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
  const gencostBlock = extractBlock(source, "gencost");
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
