// SPDX-License-Identifier: AGPL-3.0-or-later

import { tokenizeFortran } from "@modelscript/fortran";
import { ArraySegmentState, NumericalInterval, ReducedProductState } from "@modelscript/runtime";
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

export interface UdmLoopBoundsViolation {
  array: "STORF" | "STORI";
  loopVar: string;
  loopLo: number;
  loopHi: number;
  allocatedLength: number;
}

/**
 * Analyzes Fortran `DO <var> = <lo>, <hi>` loops that index `STORF(NSTORF + <var>)` /
 * `STORI(NSTORI + <var>)` using `@modelscript/runtime`'s `ArraySegmentState` abstract domain
 * to prove loop-indexed out-of-bounds storage access.
 */
export function analyzeUdmLoopSegments(
  raw: string,
  nstorfAdvance: number,
  nstoriAdvance: number,
): UdmLoopBoundsViolation[] {
  const violations: UdmLoopBoundsViolation[] = [];
  const activeLoops = new Map<string, { lo: number; hi: number }>();

  const storfSeg = new ArraySegmentState(new NumericalInterval(nstorfAdvance, nstorfAdvance));
  const storiSeg = new ArraySegmentState(new NumericalInterval(nstoriAdvance, nstoriAdvance));

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^[cC*!]/.test(trimmed)) continue;
    const upper = trimmed.toUpperCase();

    const doMatch = /^DO\s+(?:\d+\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(-?\d+)\s*,\s*(-?\d+)/.exec(upper);
    if (doMatch) {
      activeLoops.set(doMatch[1]!, {
        lo: Number.parseInt(doMatch[2]!, 10),
        hi: Number.parseInt(doMatch[3]!, 10),
      });
      continue;
    }
    if (/^END\s*DO\b|^CONTINUE\b/.test(upper)) {
      activeLoops.clear();
      continue;
    }

    if (activeLoops.size === 0) continue;

    const storRe = /\b(STOR[FI])\s*\(\s*(NSTOR[FI])\s*\+\s*([A-Z_][A-Z0-9_]*)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = storRe.exec(upper)) !== null) {
      const arr = m[1]! as "STORF" | "STORI";
      const loopVar = m[3]!;
      const bounds = activeLoops.get(loopVar);
      if (!bounds) continue;
      const seg = arr === "STORF" ? storfSeg : storiSeg;
      const allocHi = seg.length.high;
      if (allocHi > 0 && (bounds.lo < 0 || bounds.hi >= allocHi)) {
        violations.push({
          array: arr,
          loopVar,
          loopLo: bounds.lo,
          loopHi: bounds.hi,
          allocatedLength: allocHi,
        });
      }
    }
  }

  return violations;
}

export interface UdmNumericalHazard {
  kind: "division_by_zero" | "negative_sqrt";
  variable: string;
  interval: [number, number];
  lineOffset: number;
}

/**
 * Static numerical safety abstract interpreter for Fortran UDM segments powered by
 * `@modelscript/runtime`'s `ReducedProductState` (Intervals ⊗ Octagon DBM).
 * Detects provable division-by-zero (`X / Y` where `0 ∈ [Y]`) and negative `SQRT(X)` (`X.low < 0`).
 */
export function analyzeUdmNumericalSafety(raw: string): UdmNumericalHazard[] {
  const hazards: UdmNumericalHazard[] = [];
  let state = ReducedProductState.topContinuous(32);
  const lines = raw.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const trimmed = lines[idx]!.trim();
    if (!trimmed || /^[cC*!]/.test(trimmed)) continue;
    const upper = trimmed.toUpperCase();

    // Track scalar constant assignments: VAR = <number>
    const assignMatch = /^([A-Z_][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?(?:[ED][+-]?\d+)?)\s*$/.exec(upper);
    if (assignMatch) {
      const v = assignMatch[1]!;
      const num = Number.parseFloat(assignMatch[2]!.replace("D", "E"));
      if (Number.isFinite(num)) {
        const nextIntervals = state.intervals.set(v, new NumericalInterval(num, num));
        state = new ReducedProductState(
          nextIntervals,
          state.octagon.clone(),
          new Map(state.varIndices),
          state.arraySegments,
          false,
          state.tvpi.clone(),
        ).reduce();
      }
      continue;
    }

    // Check division by tracked zero-containing variable or literal 0.0
    const divRe = /\/\s*([A-Z_][A-Z0-9_]*|0(?:\.0+)?(?:[ED][+-]?0+)?)\b/g;
    let dm: RegExpExecArray | null;
    while ((dm = divRe.exec(upper)) !== null) {
      const denom = dm[1]!;
      if (/^0(?:\.0+)?(?:[ED][+-]?0+)?$/.test(denom)) {
        hazards.push({ kind: "division_by_zero", variable: denom, interval: [0, 0], lineOffset: idx });
      } else {
        const iv = state.intervals.get(denom);
        if (iv && iv.low <= 0 && iv.high >= 0 && Number.isFinite(iv.low) && Number.isFinite(iv.high)) {
          hazards.push({ kind: "division_by_zero", variable: denom, interval: [iv.low, iv.high], lineOffset: idx });
        }
      }
    }

    // Check SQRT(VAR) or SQRT(-const)
    const sqrtRe = /\bSQRT\s*\(\s*([A-Z_][A-Z0-9_]*|-\d+(?:\.\d+)?)\s*\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = sqrtRe.exec(upper)) !== null) {
      const arg = sm[1]!;
      if (arg.startsWith("-")) {
        const val = Number.parseFloat(arg);
        hazards.push({ kind: "negative_sqrt", variable: arg, interval: [val, val], lineOffset: idx });
      } else {
        const iv = state.intervals.get(arg);
        if (iv && iv.high < 0) {
          hazards.push({ kind: "negative_sqrt", variable: arg, interval: [iv.low, iv.high], lineOffset: idx });
        }
      }
    }
  }

  return hazards;
}

/**
 * Emits `M6066` diagnostics (`rigor: "float-sound"`) for CFG-proven UDM storage OOB,
 * loop-indexed `ArraySegmentState` violations, `ReducedProductState` div-by-zero / NaN hazards,
 * and branch-uninitialized history reads.
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
  for (const lv of analyzeUdmLoopSegments(raw, res.nstorfAdvance, res.nstoriAdvance)) {
    diags.push({
      code: "M6066",
      rule: "fortran-udm-uninitialized-history-state",
      severity: "error",
      message: `Definition '${defName}' ${segName} loop '${lv.loopVar}=${lv.loopLo}..${lv.loopHi}' accesses ${lv.array}(N${lv.array}+${lv.loopVar}) outside ArraySegmentState budget [0, ${lv.allocatedLength - 1}].`,
      line: baseLine,
      rigor: "float-sound",
    });
  }
  for (const hz of analyzeUdmNumericalSafety(raw)) {
    diags.push({
      code: "M6066",
      rule: "fortran-udm-uninitialized-history-state",
      severity: "error",
      message: `Definition '${defName}' ${segName} segment has ${hz.kind === "division_by_zero" ? "division by zero" : "negative SQRT (NaN)"} on '${hz.variable}' ∈ [${hz.interval[0]}, ${hz.interval[1]}] (ReducedProductState).`,
      line: baseLine !== undefined ? baseLine + hz.lineOffset : undefined,
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
