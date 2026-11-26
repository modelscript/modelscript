// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure client-side utilities for:
 *   1. Replaying worst-case zonotope perturbation corners (ξ*) directly into Modelica,
 *      OpenSCAD, and SysML2 source code without corrupting syntax, comments, or strings.
 *   2. Computing side-by-side checkpoint / FormalModelEvalReport regression diffs
 *      without coupling `@modelscript/editor` to `@modelscript/runtime`.
 */

export interface WorstCaseCornerInput {
  symbolName?: string | undefined;
  label?: string | undefined;
  xiSign: 1 | -1;
}

export interface AppliedCornerMutation {
  symbolName: string;
  before: number;
  after: number;
  xiSign: 1 | -1;
}

export interface WorstCaseReplayResult {
  perturbedSource: string;
  appliedMutations: AppliedCornerMutation[];
}

export interface ClientEvalCaseResult {
  caseId: string;
  formalPassed: boolean;
  behavioralPassed: boolean;
  rewardHacking: boolean;
  rewardHackingReasons?: string[] | undefined;
  outputSpreadDeltaT: number;
}

export interface ClientFormalModelEvalReport {
  promoted: boolean;
  totalCases: number;
  formalGatePassRate: number;
  nonTrivialPassRate: number;
  rewardHackingRate: number;
  diskAnnRecallAtK?: number | undefined;
  calibration: {
    ece: number;
    meanSpreadOnCorrect?: number | undefined;
    meanSpreadOnError?: number | undefined;
    retrievalTriggerRecall?: number | undefined;
    sampleCount?: number | undefined;
  };
  failureReasons?: string[] | undefined;
  perCase: ClientEvalCaseResult[];
}

export interface ClientEvalRegressionDiff {
  promotionChange: "unchanged-pass" | "unchanged-fail" | "promoted" | "regressed";
  formalPassRateDelta: number;
  nonTrivialPassRateDelta: number;
  rewardHackingRateDelta: number;
  eceDelta: number;
  flippedPassToFail: string[];
  flippedFailToPass: string[];
}

const IDENT_CHAR_RE = /[A-Za-z0-9_]/;
const NUMERIC_LITERAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Masks single-line comments (`//...`), block comments (`/*...*\/`), and double-quoted
 * string literals (`"..."`) with spaces while preserving string length and newline positions.
 */
function maskCommentsAndStrings(source: string): string {
  const chars = source.split("");
  const n = chars.length;
  let i = 0;

  while (i < n) {
    const ch = chars[i]!;
    const next = i + 1 < n ? chars[i + 1] : "";

    // Single-line comment: //...
    if (ch === "/" && next === "/") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < n && chars[i] !== "\n") {
        chars[i] = " ";
        i++;
      }
      continue;
    }

    // Block comment: /* ... */
    if (ch === "/" && next === "*") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      while (i < n) {
        if (chars[i] === "*" && i + 1 < n && chars[i + 1] === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          i += 2;
          break;
        }
        if (chars[i] !== "\n") {
          chars[i] = " ";
        }
        i++;
      }
      continue;
    }

    // Double-quoted string literal: "..."
    if (ch === '"') {
      chars[i] = " ";
      i++;
      while (i < n) {
        if (chars[i] === "\\" && i + 1 < n) {
          chars[i] = " ";
          if (chars[i + 1] !== "\n") chars[i + 1] = " ";
          i += 2;
          continue;
        }
        const cur = chars[i]!;
        if (cur !== "\n") chars[i] = " ";
        i++;
        if (cur === '"') break;
      }
      continue;
    }

    i++;
  }

  return chars.join("");
}

function skipHorizontalSpace(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    i++;
  }
  return i;
}

function skipBalancedParens(text: string, pos: number): number {
  if (text[pos] !== "(") return pos;
  let depth = 0;
  let i = pos;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

function isSafeAssignmentTerminator(source: string, pos: number): boolean {
  const i = skipHorizontalSpace(source, pos);
  if (i >= source.length) return true;
  const ch = source[i]!;
  if (
    ch === ";" ||
    ch === "," ||
    ch === ")" ||
    ch === "]" ||
    ch === "[" ||
    ch === "{" ||
    ch === "}" ||
    ch === '"' ||
    ch === "\n" ||
    ch === "\r"
  ) {
    return true;
  }
  if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
    return true;
  }
  if (/^annotation\b/.test(source.slice(i))) {
    return true;
  }
  return false;
}

interface AssignmentCandidate {
  numStart: number;
  numEnd: number;
  numStr: string;
  isIntegerDecl: boolean;
  priority: number;
}

function findAssignmentCandidate(
  source: string,
  masked: string,
  symbolName: string,
  claimedSpans: Set<string>,
): AssignmentCandidate | null {
  const escaped = escapeRegExp(symbolName);
  const symRe = new RegExp(escaped, "g");
  const isDottedSymbol = symbolName.includes(".");
  let best: AssignmentCandidate | null = null;

  let match: RegExpExecArray | null;
  while ((match = symRe.exec(masked)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Verify left identifier boundary
    const prevChar = start > 0 ? masked[start - 1]! : "";
    if (prevChar && IDENT_CHAR_RE.test(prevChar)) continue;
    const precededByDot = prevChar === ".";

    // Verify right identifier boundary
    const nextChar = end < masked.length ? masked[end]! : "";
    if (nextChar && (IDENT_CHAR_RE.test(nextChar) || nextChar === ".")) continue;

    let pos = skipHorizontalSpace(masked, end);

    // Optional Modelica component modifier: R(min=0, unit="Ohm")
    if (masked[pos] === "(") {
      const afterParens = skipBalancedParens(masked, pos);
      if (afterParens < 0) continue;
      pos = skipHorizontalSpace(masked, afterParens);
    }

    // Optional SysML2 type annotation: attribute mass : Real = 12.5; or attribute mass: MassValue := 12.5;
    if (masked[pos] === ":" && masked[pos + 1] !== "=") {
      pos++;
      while (pos < masked.length) {
        const ch = masked[pos]!;
        if (ch === "=" || ch === ";" || ch === "\n" || ch === "\r" || ch === "{" || ch === "}") {
          break;
        }
        if (ch === ":" && masked[pos + 1] === "=") {
          break;
        }
        if (ch === "d" && /^default\b/.test(masked.slice(pos))) {
          pos += "default".length;
          pos = skipHorizontalSpace(masked, pos);
          break;
        }
        pos++;
      }
      pos = skipHorizontalSpace(masked, pos);
    } else if (/^default\b/.test(masked.slice(pos))) {
      pos += "default".length;
      pos = skipHorizontalSpace(masked, pos);
    }

    // Assignment operator: `:=` (SysML2) or `=` (Modelica / OpenSCAD / SysML2)
    if (masked[pos] === ":" && masked[pos + 1] === "=") {
      pos += 2;
    } else if (masked[pos] === "=") {
      // Reject `==` and `=>`
      if (masked[pos + 1] === "=" || masked[pos + 1] === ">") continue;
      pos += 1;
    } else {
      continue;
    }

    pos = skipHorizontalSpace(masked, pos);
    const numMatch = NUMERIC_LITERAL_RE.exec(masked.slice(pos));
    if (!numMatch) continue;

    const numStr = numMatch[0];
    const numStart = pos;
    const numEnd = pos + numStr.length;

    // Ensure number is not immediately glued to identifier or dot
    const afterNum = numEnd < masked.length ? masked[numEnd]! : "";
    if (afterNum && (IDENT_CHAR_RE.test(afterNum) || afterNum === ".")) continue;

    // Ensure assignment RHS is a standalone numeric literal, not a compound expression like `1.0 + y`
    if (!isSafeAssignmentTerminator(source, numEnd)) continue;

    const spanKey = `${numStart}:${numEnd}`;
    if (claimedSpans.has(spanKey)) continue;

    // Inspect prefix on the current line to prioritize declarations and detect `Integer`
    const lineStart = masked.lastIndexOf("\n", start - 1) + 1;
    const linePrefix = masked.slice(lineStart, start);
    const isIntegerDecl = /\bInteger\b/.test(linePrefix);
    const isDeclaration =
      /\b(?:parameter|constant|attribute|Real|Integer)\b/.test(linePrefix) || linePrefix.trim().length === 0;

    let priority = 0;
    if (!precededByDot || isDottedSymbol) priority += 4;
    if (isDeclaration) priority += 2;

    if (!best || priority > best.priority) {
      best = { numStart, numEnd, numStr, isIntegerDecl, priority };
    }
  }

  return best;
}

function formatPerturbedNumber(
  numStr: string,
  before: number,
  xiSign: 1 | -1,
  deltaFraction: number,
  isIntegerDecl: boolean,
): { after: number; formatted: string } {
  const delta = Math.abs(deltaFraction);

  if (isIntegerDecl) {
    let after =
      before === 0 ? xiSign * Math.max(1, Math.round(delta)) : Math.round(before + xiSign * Math.abs(before) * delta);
    if (after === before && delta > 0) {
      after = before + xiSign;
    }
    return { after, formatted: String(after) };
  }

  const raw = before === 0 ? xiSign * delta : before + xiSign * Math.abs(before) * delta;
  const after = Number(raw.toPrecision(10));
  const hadDecimalPoint = numStr.includes(".") && !/[eE]/.test(numStr);
  const formatted = hadDecimalPoint && Number.isInteger(after) ? after.toFixed(1) : String(after);
  return { after, formatted };
}

/**
 * Perturbs numeric parameter/attribute assignments in Modelica, OpenSCAD, or SysML2 source code
 * along a worst-case zonotope perturbation corner (`ξ*`).
 */
export function applyWorstCaseCornerToSource(
  source: string,
  corner: readonly WorstCaseCornerInput[],
  deltaFraction = 0.05,
): WorstCaseReplayResult {
  if (!source || corner.length === 0 || !Number.isFinite(deltaFraction) || deltaFraction === 0) {
    return { perturbedSource: source, appliedMutations: [] };
  }

  const masked = maskCommentsAndStrings(source);
  const claimedSpans = new Set<string>();
  const seenSymbols = new Set<string>();

  interface PendingEdit {
    numStart: number;
    numEnd: number;
    replacement: string;
    mutation: AppliedCornerMutation;
  }

  const edits: PendingEdit[] = [];

  for (const entry of corner) {
    const rawSym = (entry.symbolName ?? entry.label ?? "").trim();
    if (!rawSym || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(rawSym)) continue;
    if (seenSymbols.has(rawSym)) continue;
    seenSymbols.add(rawSym);

    const xiSign: 1 | -1 = entry.xiSign >= 0 ? 1 : -1;
    let candidate = findAssignmentCandidate(source, masked, rawSym, claimedSpans);
    let matchedName = rawSym;

    // If a qualified name (e.g. `resistor.R`) did not match verbatim, try its leaf symbol (`R`).
    if (!candidate && rawSym.includes(".")) {
      const leaf = rawSym.split(".").pop() ?? "";
      if (leaf && !seenSymbols.has(leaf)) {
        candidate = findAssignmentCandidate(source, masked, leaf, claimedSpans);
        if (candidate) {
          matchedName = leaf;
          seenSymbols.add(leaf);
        }
      }
    }

    if (!candidate) continue;

    const before = Number(candidate.numStr);
    if (!Number.isFinite(before)) continue;

    const { after, formatted } = formatPerturbedNumber(
      candidate.numStr,
      before,
      xiSign,
      deltaFraction,
      candidate.isIntegerDecl,
    );

    claimedSpans.add(`${candidate.numStart}:${candidate.numEnd}`);
    edits.push({
      numStart: candidate.numStart,
      numEnd: candidate.numEnd,
      replacement: formatted,
      mutation: {
        symbolName: matchedName,
        before,
        after,
        xiSign,
      },
    });
  }

  if (edits.length === 0) {
    return { perturbedSource: source, appliedMutations: [] };
  }

  // Apply replacements from end to start to keep all string offsets intact.
  const sortedForSplice = [...edits].sort((a, b) => b.numStart - a.numStart);
  let perturbedSource = source;
  for (const edit of sortedForSplice) {
    perturbedSource = perturbedSource.slice(0, edit.numStart) + edit.replacement + perturbedSource.slice(edit.numEnd);
  }

  return {
    perturbedSource,
    appliedMutations: edits.map((e) => e.mutation),
  };
}

/**
 * Lightweight client-side equivalent of `diffEvalReports` for comparing two
 * `FormalModelEvalReport` JSON blobs inside `@modelscript/editor`.
 */
export function computeClientEvalRegressionDiff(
  before: ClientFormalModelEvalReport,
  after: ClientFormalModelEvalReport,
): ClientEvalRegressionDiff {
  const beforeMap = new Map(before.perCase.map((c) => [c.caseId, c]));
  const flippedPassToFail: string[] = [];
  const flippedFailToPass: string[] = [];

  for (const cur of after.perCase) {
    const prev = beforeMap.get(cur.caseId);
    if (!prev) continue;
    const prevOk = prev.formalPassed && prev.behavioralPassed && !prev.rewardHacking;
    const curOk = cur.formalPassed && cur.behavioralPassed && !cur.rewardHacking;
    if (prevOk && !curOk) flippedPassToFail.push(cur.caseId);
    else if (!prevOk && curOk) flippedFailToPass.push(cur.caseId);
  }

  const promotionChange: ClientEvalRegressionDiff["promotionChange"] =
    before.promoted === after.promoted
      ? after.promoted
        ? "unchanged-pass"
        : "unchanged-fail"
      : after.promoted
        ? "promoted"
        : "regressed";

  return {
    promotionChange,
    formalPassRateDelta: Number((after.formalGatePassRate - before.formalGatePassRate).toFixed(4)),
    nonTrivialPassRateDelta: Number((after.nonTrivialPassRate - before.nonTrivialPassRate).toFixed(4)),
    rewardHackingRateDelta: Number((after.rewardHackingRate - before.rewardHackingRate).toFixed(4)),
    eceDelta: Number((after.calibration.ece - before.calibration.ece).toFixed(4)),
    flippedPassToFail,
    flippedFailToPass,
  };
}

/**
 * Parses and validates a JSON string representing a `FormalModelEvalReport`.
 */
export function parseClientEvalReportJson(raw: string): {
  report: ClientFormalModelEvalReport | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(raw) as Partial<ClientFormalModelEvalReport> | null;
    if (!parsed || typeof parsed !== "object") {
      return { report: null, error: "JSON root must be an eval report object." };
    }
    if (typeof parsed.promoted !== "boolean") {
      return { report: null, error: "Missing boolean field 'promoted'." };
    }
    if (typeof parsed.formalGatePassRate !== "number" || typeof parsed.nonTrivialPassRate !== "number") {
      return { report: null, error: "Missing numeric pass rate fields ('formalGatePassRate', 'nonTrivialPassRate')." };
    }
    if (!parsed.calibration || typeof parsed.calibration.ece !== "number") {
      return { report: null, error: "Missing numeric field 'calibration.ece'." };
    }
    if (!Array.isArray(parsed.perCase)) {
      return { report: null, error: "Missing array field 'perCase'." };
    }
    return {
      report: {
        promoted: parsed.promoted,
        totalCases: typeof parsed.totalCases === "number" ? parsed.totalCases : parsed.perCase.length,
        formalGatePassRate: parsed.formalGatePassRate,
        nonTrivialPassRate: parsed.nonTrivialPassRate,
        rewardHackingRate: typeof parsed.rewardHackingRate === "number" ? parsed.rewardHackingRate : 0,
        diskAnnRecallAtK: parsed.diskAnnRecallAtK,
        calibration: parsed.calibration,
        failureReasons: Array.isArray(parsed.failureReasons) ? parsed.failureReasons : [],
        perCase: parsed.perCase,
      },
      error: null,
    };
  } catch (err) {
    return { report: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export const SAMPLE_EVAL_REPORT_BEFORE: ClientFormalModelEvalReport = {
  promoted: false,
  totalCases: 5,
  formalGatePassRate: 0.8,
  nonTrivialPassRate: 0.6,
  rewardHackingRate: 0.2,
  diskAnnRecallAtK: 0.8,
  calibration: {
    ece: 0.28,
    meanSpreadOnCorrect: 0.16,
    meanSpreadOnError: 0.34,
    retrievalTriggerRecall: 0.72,
    sampleCount: 5,
  },
  failureReasons: [
    "formalGatePassRate 0.8 < 0.9",
    "nonTrivialPassRate 0.6 < 0.85",
    "rewardHackingRate 0.2 > 0.05",
    "calibration ECE 0.28 > 0.25",
  ],
  perCase: [
    {
      caseId: "modelica/rlc_step_response",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.12,
    },
    {
      caseId: "scad/enclosure_wall_clearance",
      formalPassed: false,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.44,
    },
    {
      caseId: "sysml2/propulsion_mass_budget",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: true,
      rewardHackingReasons: ["Trivialized constraint by omitting required mass symbol"],
      outputSpreadDeltaT: 0.39,
    },
    {
      caseId: "modelica/thermal_pid_loop",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.19,
    },
    {
      caseId: "spice/buck_converter_ripple",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.17,
    },
  ],
};

export const SAMPLE_EVAL_REPORT_AFTER: ClientFormalModelEvalReport = {
  promoted: true,
  totalCases: 5,
  formalGatePassRate: 1.0,
  nonTrivialPassRate: 0.8,
  rewardHackingRate: 0.0,
  diskAnnRecallAtK: 1.0,
  calibration: {
    ece: 0.11,
    meanSpreadOnCorrect: 0.13,
    meanSpreadOnError: 0.49,
    retrievalTriggerRecall: 0.94,
    sampleCount: 5,
  },
  failureReasons: [],
  perCase: [
    {
      caseId: "modelica/rlc_step_response",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.11,
    },
    {
      caseId: "scad/enclosure_wall_clearance",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.16,
    },
    {
      caseId: "sysml2/propulsion_mass_budget",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.14,
    },
    {
      caseId: "modelica/thermal_pid_loop",
      formalPassed: true,
      behavioralPassed: false,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.49,
    },
    {
      caseId: "spice/buck_converter_ripple",
      formalPassed: true,
      behavioralPassed: true,
      rewardHacking: false,
      rewardHackingReasons: [],
      outputSpreadDeltaT: 0.12,
    },
  ],
};
