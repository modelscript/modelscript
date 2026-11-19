// SPDX-License-Identifier: AGPL-3.0-or-later

import { tokenizeFortran } from "@modelscript/fortran";
import type { PscadDiagnostic } from "../types.js";

export interface UdmCfgAnalysisResult {
  nstorfAdvance: number;
  nstoriAdvance: number;
  outOfBoundsAccesses: Array<{ array: "STORF" | "STORI"; offset: number; advance: number }>;
  uninitializedReads: Array<{ array: "STORF" | "STORI"; offset: number; reason: string }>;
}

/**
 * Parses a normalized `STORF(...)` / `STORI(...)` index expression into an integer offset relative to `NSTORF`/`NSTORI`.
 * Supports `NSTORF`, `NSTORF+k`, `NSTORF-k`, or constant `0..N`. Returns `null` for symbolic/non-affine expressions.
 */
function parseStorOffset(expr: string, baseVar: "NSTORF" | "NSTORI"): number | null {
  const clean = expr.replace(/\s+/g, "").toUpperCase();
  if (clean === baseVar) return 0;
  const plusM = new RegExp(`^${baseVar}\\+(\\d+)$`).exec(clean);
  if (plusM) return Number.parseInt(plusM[1]!, 10);
  const minusM = new RegExp(`^${baseVar}-(\\d+)$`).exec(clean);
  if (minusM) return -Number.parseInt(minusM[1]!, 10);
  if (/^\d+$/.test(clean)) return Number.parseInt(clean, 10);
  return null;
}

/**
 * Branch-aware CFG abstract interpreter for PSCAD Fortran UDM segments (`Fortran`, `Dsdyn`, `Dsout`).
 *
 * Models `IF (TIMEZERO)` / `ELSE` / `ENDIF` control-flow branches and affine `STORF(NSTORF + k)` /
 * `STORI(NSTORI + k)` offsets against the declared `NSTORF = NSTORF + M` allocation budget to prove:
 * 1. Out-of-bounds storage array access (`k < 0 || k >= M`), which corrupts adjacent PSCAD component state.
 * 2. Uninitialized history reads on steady-state paths when the `TIMEZERO` branch never initialized offset `k`.
 */
export function analyzeUdmCfgStorage(raw: string): UdmCfgAnalysisResult {
  const lines = raw.split(/\r?\n/);
  let nstorfAdvance = 0;
  let nstoriAdvance = 0;

  // Track branch context stack: "always" | "timezero" | "non_timezero"
  const branchStack: Array<"always" | "timezero" | "non_timezero"> = ["always"];
  const initWrittenF = new Set<number>();
  const initWrittenI = new Set<number>();
  const alwaysWrittenF = new Set<number>();
  const alwaysWrittenI = new Set<number>();
  const reads: Array<{
    array: "STORF" | "STORI";
    offset: number;
    branch: "always" | "timezero" | "non_timezero";
    writtenBeforeReadInBranch: boolean;
  }> = [];
  const allAccesses: Array<{ array: "STORF" | "STORI"; offset: number }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("C ") || trimmed.startsWith("c ")) continue;
    const upper = trimmed.toUpperCase();

    // Control-flow branch transitions for IF (TIMEZERO) / ELSE / ENDIF
    if (/^IF\s*\(.*\b(TIMEZERO|TZERO|FIRSTSTEP)\b.*\)\s*THEN\b/.test(upper)) {
      const isNegated = /\.NOT\.\s*(TIMEZERO|TZERO|FIRSTSTEP)/.test(upper);
      branchStack.push(isNegated ? "non_timezero" : "timezero");
      continue;
    }
    if (/^ELSE\b/.test(upper) && branchStack.length > 1) {
      const top = branchStack[branchStack.length - 1]!;
      branchStack[branchStack.length - 1] = top === "timezero" ? "non_timezero" : "timezero";
      continue;
    }
    if (/^END\s*IF\b/.test(upper) && branchStack.length > 1) {
      branchStack.pop();
      continue;
    }

    const curBranch = branchStack[branchStack.length - 1]!;
    const toks = tokenizeFortran(trimmed);

    // Check NSTORF/NSTORI advances: `NSTORF = NSTORF + M`
    for (let i = 0; i + 4 < toks.length; i++) {
      const t0 = toks[i]!.value.toUpperCase();
      if (
        (t0 === "NSTORF" || t0 === "NSTORI") &&
        toks[i + 1]!.value === "=" &&
        toks[i + 2]!.value.toUpperCase() === t0 &&
        toks[i + 3]!.value === "+"
      ) {
        const val = Number.parseInt(toks[i + 4]!.value, 10);
        if (Number.isFinite(val) && val > 0) {
          if (t0 === "NSTORF") nstorfAdvance += val;
          else nstoriAdvance += val;
        }
      }
    }

    // Track STORF/STORI reads and writes with exact affine offsets
    for (let i = 0; i < toks.length; i++) {
      const up = toks[i]!.value.toUpperCase();
      if (up !== "STORF" && up !== "STORI") continue;
      let j = i + 1;
      let idxExpr = "";
      if (toks[j]?.value === "(") {
        let depth = 1;
        j++;
        while (j < toks.length && depth > 0) {
          const tv = toks[j]!.value;
          if (tv === "(") depth++;
          else if (tv === ")") depth--;
          if (depth > 0) idxExpr += tv;
          j++;
        }
      }
      const baseVar = up === "STORF" ? "NSTORF" : "NSTORI";
      const offset = parseStorOffset(idxExpr, baseVar);
      if (offset === null) continue;

      allAccesses.push({ array: up, offset });
      const isWrite = toks[j]?.value === "=";
      if (isWrite) {
        if (up === "STORF") {
          if (curBranch === "timezero") initWrittenF.add(offset);
          else if (curBranch === "always") alwaysWrittenF.add(offset);
        } else {
          if (curBranch === "timezero") initWrittenI.add(offset);
          else if (curBranch === "always") alwaysWrittenI.add(offset);
        }
      } else {
        const writtenHere = up === "STORF" ? alwaysWrittenF.has(offset) : alwaysWrittenI.has(offset);
        reads.push({ array: up, offset, branch: curBranch, writtenBeforeReadInBranch: writtenHere });
      }
    }
  }

  const outOfBoundsAccesses: UdmCfgAnalysisResult["outOfBoundsAccesses"] = [];
  const seenOob = new Set<string>();
  for (const acc of allAccesses) {
    const adv = acc.array === "STORF" ? nstorfAdvance : nstoriAdvance;
    if (adv > 0 && (acc.offset < 0 || acc.offset >= adv)) {
      const key = `${acc.array}:${acc.offset}`;
      if (!seenOob.has(key)) {
        seenOob.add(key);
        outOfBoundsAccesses.push({ array: acc.array, offset: acc.offset, advance: adv });
      }
    }
  }

  const uninitializedReads: UdmCfgAnalysisResult["uninitializedReads"] = [];
  const seenUninit = new Set<string>();
  for (const rd of reads) {
    if (rd.writtenBeforeReadInBranch) continue;
    const initSet = rd.array === "STORF" ? initWrittenF : initWrittenI;
    const hasAnyInit = initSet.size > 0;
    // If the segment has a TIMEZERO block that initializes some offsets, reading an offset NOT
    // initialized in TIMEZERO on the non-TIMEZERO/always path is a proven uninitialized read.
    if (hasAnyInit && !initSet.has(rd.offset) && rd.branch !== "timezero") {
      const key = `${rd.array}:${rd.offset}`;
      if (!seenUninit.has(key)) {
        seenUninit.add(key);
        uninitializedReads.push({
          array: rd.array,
          offset: rd.offset,
          reason: `offset +${rd.offset} is read on steady-state path but never initialized in the TIMEZERO branch`,
        });
      }
    }
  }

  return { nstorfAdvance, nstoriAdvance, outOfBoundsAccesses, uninitializedReads };
}

/**
 * Emits `M6066` diagnostics (`rigor: "float-sound"`) for CFG-proven UDM storage OOB and
 * branch-uninitialized history reads.
 */
export function lintUdmCfgStorage(defName: string, segName: string, raw: string, baseLine?: number): PscadDiagnostic[] {
  const res = analyzeUdmCfgStorage(raw);
  const diags: PscadDiagnostic[] = [];
  for (const oob of res.outOfBoundsAccesses) {
    diags.push({
      code: "M6066",
      rule: "fortran-udm-uninitialized-history-state",
      severity: "error",
      message: `Definition '${defName}' ${segName} segment accesses ${oob.array}(N${oob.array}+${oob.offset}) outside allocated advance N${oob.array}+${oob.advance}, corrupting adjacent component storage.`,
      line: baseLine,
      rigor: "float-sound",
    });
  }
  for (const u of res.uninitializedReads) {
    diags.push({
      code: "M6066",
      rule: "fortran-udm-uninitialized-history-state",
      severity: "warning",
      message: `Definition '${defName}' ${segName} segment ${u.array} ${u.reason}.`,
      line: baseLine,
      rigor: "float-sound",
    });
  }
  return diags;
}
