// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — PSS/E Sequence Data (`.seq`) Parser & Serializer
 *
 * Parses and serializes standard PSS/E REV 33/34/35 `.seq` positive-, negative-,
 * and zero-sequence network data sections:
 * 1. Positive / Negative / Zero Sequence Generator Impedances (`ZRPOS`, `ZXPOS`, `ZRNEG`, `ZXNEG`, `ZR0`, `ZX0`, `ZRG`, `ZXG`)
 * 2. Non-Transformer Branch Zero-Sequence Data (`I`, `J`, `CKT`, `R0`, `X0`, `B0`, `GI0`, `BI0`, `GJ0`, `BJ0`)
 * 3. Zero-Sequence Mutual Impedance Data (`I1`, `J1`, `CKT1`, `I2`, `J2`, `CKT2`, `RM`, `XM`)
 * 4. Two-Winding Transformer Zero-Sequence & Grounding Data (`I`, `J`, `CKT`, `CC`, `RG1`, `XG1`, `R01`, `X01`, `RG2`, `XG2`, `R02`, `X02`)
 * 5. Zero-Sequence Switched/Fixed Shunt Admittance Data (`I`, `G0`, `B0`)
 */

import type {
  PsseSeqCase,
  SeqBranchRecord,
  SeqGeneratorRecord,
  SeqMutualRecord,
  SeqShuntRecord,
  SeqTransformerRecord,
} from "../types.js";

function splitSeqLine(line: string): string[] {
  const commentSlash = line.indexOf("@!");
  const raw = commentSlash >= 0 ? line.slice(0, commentSlash) : line;
  const slashIdx = raw.indexOf("/");
  const clean = slashIdx >= 0 ? raw.slice(0, slashIdx) : raw;
  const tokens: string[] = [];
  let cur = "";
  let inQuotes = false;
  let qChar = "";

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (inQuotes) {
      if (ch === qChar) {
        inQuotes = false;
        tokens.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (cur.trim().length > 0) {
        tokens.push(cur.trim());
        cur = "";
      }
      inQuotes = true;
      qChar = ch;
      continue;
    }
    if (ch === "," || ch === " " || ch === "\t") {
      if (cur.trim().length > 0) {
        tokens.push(cur.trim());
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) {
    tokens.push(cur.trim());
  }
  return tokens;
}

/**
 * Parses a PSS/E `.seq` sequence data file string into a structured `PsseSeqCase`.
 */
export function parseSeq(source: string): PsseSeqCase {
  const generators: SeqGeneratorRecord[] = [];
  const branches: SeqBranchRecord[] = [];
  const mutuals: SeqMutualRecord[] = [];
  const transformers: SeqTransformerRecord[] = [];
  const shunts: SeqShuntRecord[] = [];

  const lines = source.split(/\r?\n/);
  // Sections:
  // 0: Header / Machine sequence impedances
  // 1: Constant-admittance loads (neg/zero) — skipped or folded
  // 2: Zero-sequence non-transformer branches
  // 3: Zero-sequence mutual couplings
  // 4: Zero-sequence transformers
  // 5: Zero-sequence switched/fixed shunts
  let section = 0;
  let seenHeader = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("@!") || trimmed.startsWith("//")) continue;
    if (/^Q\b/i.test(trimmed)) break;

    const tokens = splitSeqLine(trimmed);
    if (tokens.length === 0) continue;

    // Detect `0 / END OF ...` section delimiters
    if (tokens[0] === "0" && (tokens.length === 1 || rawLine.includes("/"))) {
      if (!seenHeader && rawLine.toUpperCase().includes("SEQ")) {
        seenHeader = true;
        continue;
      }
      section++;
      continue;
    }

    // Also allow explicit `@! SECTION:` or keyword headers to jump to specific section
    const upperLine = rawLine.toUpperCase();
    if (upperLine.includes("ZERO-SEQUENCE BRANCH") || upperLine.includes("NON-TRANSFORMER BRANCH")) {
      section = 2;
      continue;
    }
    if (upperLine.includes("MUTUAL")) {
      section = 3;
      continue;
    }
    if (upperLine.includes("TRANSFORMER")) {
      section = 4;
      continue;
    }
    if (upperLine.includes("SHUNT")) {
      section = 5;
      continue;
    }

    const firstInt = Number.parseInt(tokens[0] ?? "", 10);
    if (!Number.isFinite(firstInt) || firstInt <= 0) continue;

    if (section === 0) {
      // Machine sequence impedance record: I, ID, ZRPOS, ZXPOS, ZRNEG, ZXNEG, ZR0, ZX0, ZRG, ZXG
      const numOr = (idx: number, def: number): number => {
        const v = Number.parseFloat(tokens[idx] ?? "");
        return Number.isFinite(v) ? v : def;
      };
      const id = (tokens[1] ?? "1").trim() || "1";
      const zrpos = numOr(2, 0.0);
      const zxpos = numOr(3, 0.18);
      const zrneg = numOr(4, zrpos);
      const zxneg = numOr(5, zxpos);
      const zr0 = numOr(6, 0.0);
      const zx0 = numOr(7, 0.08);
      const zrg = numOr(8, 0.0);
      const zxg = numOr(9, 0.0);

      generators.push({
        i: firstInt,
        id,
        zrpos,
        zxpos,
        zrneg,
        zxneg,
        zr0,
        zx0,
        zrg,
        zxg,
      });
    } else if (section === 1 || section === 2) {
      // If tokens[1] is a positive integer bus J, it's a zero-sequence branch (I, J, CKT, R0, X0, B0, ...)
      const jBus = Number.parseInt(tokens[1] ?? "", 10);
      if (Number.isFinite(jBus) && jBus > 0 && tokens.length >= 5) {
        section = 2;
        const numOr = (idx: number, def: number): number => {
          const v = Number.parseFloat(tokens[idx] ?? "");
          return Number.isFinite(v) ? v : def;
        };
        const ckt = (tokens[2] ?? "1").trim() || "1";
        const r0 = numOr(3, 0.05);
        const x0 = numOr(4, 0.25);
        const b0 = numOr(5, 0.0);
        const gi0 = numOr(6, 0.0);
        const bi0 = numOr(7, 0.0);
        const gj0 = numOr(8, 0.0);
        const bj0 = numOr(9, 0.0);
        branches.push({ i: firstInt, j: jBus, ckt, r0, x0, b0, gi0, bi0, gj0, bj0 });
      }
    } else if (section === 3) {
      // Mutual coupling: I1, J1, CKT1, I2, J2, CKT2, RM, XM
      if (tokens.length >= 8) {
        const j1 = Number.parseInt(tokens[1] ?? "0", 10);
        const ckt1 = (tokens[2] ?? "1").trim() || "1";
        const i2 = Number.parseInt(tokens[3] ?? "0", 10);
        const j2 = Number.parseInt(tokens[4] ?? "0", 10);
        const ckt2 = (tokens[5] ?? "1").trim() || "1";
        const rm = Number.parseFloat(tokens[6] ?? "0") || 0.0;
        const xm = Number.parseFloat(tokens[7] ?? "0") || 0.0;
        if (j1 > 0 && i2 > 0 && j2 > 0) {
          mutuals.push({ i1: firstInt, j1, ckt1, i2, j2, ckt2, rm, xm });
        }
      }
    } else if (section === 4) {
      // Transformer zero-sequence: I, J, CKT, CC, RG1, XG1, R01, X01, RG2, XG2, R02, X02
      const jBus = Number.parseInt(tokens[1] ?? "0", 10);
      if (jBus > 0 && tokens.length >= 8) {
        // Handle 3-winding K=0 token if present (`I, J, 0, CKT, CC, ...`)
        const hasKZero = tokens[2] === "0";
        const offset = hasKZero ? 1 : 0;
        const ckt = (tokens[2 + offset] ?? "1").trim() || "1";
        const cc = Number.parseInt(tokens[3 + offset] ?? "1", 10) || 1;
        const rg1 = Number.parseFloat(tokens[4 + offset] ?? "0") || 0.0;
        const xg1 = Number.parseFloat(tokens[5 + offset] ?? "0") || 0.0;
        const r01 = Number.parseFloat(tokens[6 + offset] ?? "0") || 0.0;
        const x01 = Number.parseFloat(tokens[7 + offset] ?? "0.1") || 0.1;
        const rg2 = Number.parseFloat(tokens[8 + offset] ?? "0") || 0.0;
        const xg2 = Number.parseFloat(tokens[9 + offset] ?? "0") || 0.0;
        const r02 = Number.parseFloat(tokens[10 + offset] ?? "0") || 0.0;
        const x02 = Number.parseFloat(tokens[11 + offset] ?? "0") || 0.0;
        transformers.push({ i: firstInt, j: jBus, ckt, cc, rg1, xg1, r01, x01, rg2, xg2, r02, x02 });
      }
    } else if (section >= 5) {
      const g0 = Number.parseFloat(tokens[1] ?? "0") || 0.0;
      const b0 = Number.parseFloat(tokens[2] ?? "0") || 0.0;
      shunts.push({ i: firstInt, g0, b0 });
    }
  }

  return {
    generators,
    branches,
    mutuals,
    transformers,
    shunts,
  };
}

/**
 * Serializes a `PsseSeqCase` back to canonical PSS/E `.seq` format.
 */
export function writeSeq(seq: PsseSeqCase): string {
  const lines: string[] = [];
  lines.push("0, 33 / PSS/E SEQUENCE DATA FILE");
  for (const g of seq.generators) {
    lines.push(
      `${g.i}, '${g.id}', ${g.zrpos}, ${g.zxpos}, ${g.zrneg}, ${g.zxneg}, ${g.zr0}, ${g.zx0}, ${g.zrg}, ${g.zxg}`,
    );
  }
  lines.push("0 / END OF MACHINE IMPEDANCE DATA, BEGIN NEGATIVE/ZERO SEQUENCE LOAD DATA");
  lines.push("0 / END OF LOAD DATA, BEGIN ZERO-SEQUENCE NON-TRANSFORMER BRANCH DATA");
  for (const b of seq.branches) {
    lines.push(`${b.i}, ${b.j}, '${b.ckt}', ${b.r0}, ${b.x0}, ${b.b0}, ${b.gi0}, ${b.bi0}, ${b.gj0}, ${b.bj0}`);
  }
  lines.push("0 / END OF ZERO-SEQUENCE BRANCH DATA, BEGIN ZERO-SEQUENCE MUTUAL DATA");
  for (const m of seq.mutuals) {
    lines.push(`${m.i1}, ${m.j1}, '${m.ckt1}', ${m.i2}, ${m.j2}, '${m.ckt2}', ${m.rm}, ${m.xm}`);
  }
  lines.push("0 / END OF ZERO-SEQUENCE MUTUAL DATA, BEGIN ZERO-SEQUENCE TRANSFORMER DATA");
  for (const t of seq.transformers) {
    lines.push(
      `${t.i}, ${t.j}, 0, '${t.ckt}', ${t.cc}, ${t.rg1}, ${t.xg1}, ${t.r01}, ${t.x01}, ${t.rg2}, ${t.xg2}, ${t.r02}, ${t.x02}`,
    );
  }
  lines.push("0 / END OF ZERO-SEQUENCE TRANSFORMER DATA, BEGIN ZERO-SEQUENCE SHUNT DATA");
  for (const s of seq.shunts) {
    lines.push(`${s.i}, ${s.g0}, ${s.b0}`);
  }
  lines.push("0 / END OF ZERO-SEQUENCE SHUNT DATA");
  lines.push("Q");
  return lines.join("\n") + "\n";
}
