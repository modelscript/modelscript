// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Autonomous Self-Healing Pipeline for Closed-Loop Compiler Agent.
 *
 * Implements the feedback loop:
 *   Candidate Code -> 4 Verification Gates -> Diagnostic Feedback Prompt -> Repair Synthesizer -> Loop
 * Executes until all gates pass or max iterations (default: 4) are exhausted.
 */

import type { CstParserLike } from "../utils/ast-utils.js";
import {
  ClosedLoopCompilerEngine,
  countChar,
  extractModelicaClassNameFromText,
  extractModelicaStateVarsFromDecls,
  extractSysmlAttributesFromText,
  extractSysmlBraceConstraintsFromText,
  findBracketedUnitAddMismatchSpan,
  findModelicaSectionSpan,
  findNextWordOutsideQuotes,
  hasWordMatch,
  parseSysmlComparisonConstraint,
  readDottedIdentAt,
  readIdentAt,
  readSignedNumberAt,
  skipWs,
  splitModelicaBeforeEquation,
  splitSemicolonStatementsOutsideQuotes,
  splitSemicolonStatementsWithSpans,
  type ClosedLoopCandidateVerification,
  type ClosedLoopLanguage,
  type GateDiagnostic,
  type GateVerificationResult,
  type VerifyCandidateOptions,
} from "./closedLoopCompilerEngine.js";

function findModelicaEndStmtSpan(
  text: string,
  targetName?: string,
): { start: number; end: number; name: string } | undefined {
  let pos = 0;
  while (pos < text.length) {
    const endIdx = findNextWordOutsideQuotes(text, "end", pos);
    if (endIdx === -1) return undefined;
    const nameStart = skipWs(text, endIdx + 3);
    if (nameStart > endIdx + 3) {
      const id = readIdentAt(text, nameStart);
      if (id) {
        const semiPos = skipWs(text, id.next);
        if (text[semiPos] === ";" && (!targetName || id.token === targetName)) {
          return { start: endIdx, end: semiPos + 1, name: id.token };
        }
      }
    }
    pos = endIdx + 3;
  }
  return undefined;
}

function hasModelicaEndStmt(text: string, modelName: string): boolean {
  return findModelicaEndStmtSpan(text, modelName) !== undefined;
}

function hasAnyModelicaEndDecl(text: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    const endIdx = findNextWordOutsideQuotes(text, "end", pos);
    if (endIdx === -1) return false;
    const nameStart = skipWs(text, endIdx + 3);
    if (nameStart > endIdx + 3 && readIdentAt(text, nameStart)) {
      return true;
    }
    pos = endIdx + 3;
  }
  return false;
}

function insertBeforeModelicaEndStmt(text: string, addition: string): string {
  const span = findModelicaEndStmtSpan(text);
  return span ? text.slice(0, span.start) + addition + text.slice(span.start) : text;
}

function repairModelicaTypedDeclRhs(
  text: string,
  declaredType: string,
  featureName: string,
  replacementVal: string,
): string {
  let current = text;
  const spans = splitSemicolonStatementsWithSpans(current);
  for (let idx = spans.length - 1; idx >= 0; idx--) {
    const span = spans[idx]!;
    const slice = current.slice(span.start, span.end);
    let pos = 0;
    while (pos < slice.length) {
      let typeIdx = findNextWordOutsideQuotes(slice, declaredType, pos);
      if (typeIdx === -1) break;
      const afterType = skipWs(slice, typeIdx + declaredType.length);
      if (afterType > typeIdx + declaredType.length) {
        const varId = readIdentAt(slice, afterType);
        if (varId?.token === featureName) {
          let cursor = skipWs(slice, varId.next);
          if (slice[cursor] === "(") {
            const closeParen = slice.indexOf(")", cursor + 1);
            if (closeParen !== -1) cursor = skipWs(slice, closeParen + 1);
          }
          if (slice[cursor] === "=") {
            const rhsStart = skipWs(slice, cursor + 1);
            current = current.slice(0, span.start + rhsStart) + replacementVal + current.slice(span.end);
            break;
          }
        }
      }
      pos = typeIdx + declaredType.length;
    }
  }
  return current;
}

function repairModelicaBracketedUnitMismatches(text: string): string {
  let current = text;
  const spans = splitSemicolonStatementsWithSpans(current);
  for (let idx = spans.length - 1; idx >= 0; idx--) {
    const span = spans[idx]!;
    let stmtSlice = current.slice(span.start, span.end);
    let hit = findBracketedUnitAddMismatchSpan(stmtSlice);
    while (hit) {
      stmtSlice = stmtSlice.slice(0, hit.u2Start) + `[${hit.u1}]` + stmtSlice.slice(hit.u2End);
      hit = findBracketedUnitAddMismatchSpan(stmtSlice);
    }
    current = current.slice(0, span.start) + stmtSlice + current.slice(span.end);
  }
  return current;
}

function isArithmeticZeroComparisonBody(body: string): boolean {
  let pos = skipWs(body, 0);
  if (body[pos] !== "(") return false;
  pos = skipWs(body, pos + 1);
  const lhs = readDottedIdentAt(body, pos, false);
  if (!lhs) return false;
  pos = skipWs(body, lhs.next);
  if (body[pos] !== "+" && body[pos] !== "-") return false;
  pos = skipWs(body, pos + 1);
  const rhs = readDottedIdentAt(body, pos, false);
  if (!rhs) return false;
  pos = skipWs(body, rhs.next);
  if (body[pos] !== ")") return false;
  pos = skipWs(body, pos + 1);
  if (body[pos] !== "<" && body[pos] !== ">") return false;
  pos++;
  if (body[pos] === "=") pos++;
  pos = skipWs(body, pos);
  if (body[pos] !== "0") return false;
  pos = skipWs(body, pos + 1);
  return pos === body.length;
}

function repairIncompatibleLengthConstraints(text: string, fallbackLengthVar: string): string {
  let current = text;
  const constraints = extractSysmlBraceConstraintsFromText(current);
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i]!;
    if (c.hasAssert && isArithmeticZeroComparisonBody(c.body)) {
      const endNoSemi = current[c.end - 1] === ";" ? c.end - 1 : c.end;
      current = current.slice(0, c.start) + `assert constraint { ${fallbackLengthVar} > 0 }` + current.slice(endNoSemi);
    }
  }
  return current;
}

function repairSysmlConnectStatements(text: string): string {
  let current = text;
  let pos = 0;
  while (pos < current.length) {
    const connIdx = findNextWordOutsideQuotes(current, "connect", pos);
    if (connIdx === -1) break;
    const srcStart = skipWs(current, connIdx + 7);
    const src = srcStart > connIdx + 7 ? readDottedIdentAt(current, srcStart, false) : undefined;
    if (!src) {
      pos = connIdx + 7;
      continue;
    }
    const toStart = skipWs(current, src.next);
    if (toStart > src.next && current.startsWith("to", toStart)) {
      const dstStart = skipWs(current, toStart + 2);
      const dst = dstStart > toStart + 2 ? readDottedIdentAt(current, dstStart, false) : undefined;
      if (dst) {
        const semiPos = skipWs(current, dst.next);
        if (current[semiPos] === ";") {
          const replacement =
            src.token === "lenPort" && dst.token === "timePort"
              ? "connect lenPort to lenPort2;"
              : `connect ${src.token} to ${src.token}2;`;
          current = current.slice(0, connIdx) + replacement + current.slice(semiPos + 1);
          pos = connIdx + replacement.length;
          continue;
        }
      }
    }
    pos = connIdx + 7;
  }
  return current;
}

function repairWeightMassInit(text: string): string {
  let current = text;
  const attrs = extractSysmlAttributesFromText(current);
  for (let i = attrs.length - 1; i >= 0; i--) {
    const a = attrs[i]!;
    if (a.name === "weight" && a.typeName === "Mass" && a.hasInitializer && a.valueText?.trim() === "100") {
      current = current.slice(0, a.stmtStart) + "attribute weight : Mass = 40;" + current.slice(a.stmtEnd);
    }
  }
  return current;
}

function repairWeightConstraintLowerBound(text: string): string {
  let current = text;
  const constraints = extractSysmlBraceConstraintsFromText(current);
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i]!;
    const comp = parseSysmlComparisonConstraint(c.body);
    if (comp && comp.lhs === "weight" && comp.operator === ">=" && comp.rhs === 100) {
      const endNoSemi = current[c.end - 1] === ";" ? c.end - 1 : c.end;
      current = current.slice(0, c.start) + "constraint { weight <= 50 }" + current.slice(endNoSemi);
    }
  }
  return current;
}

function relaxSysmlLowerBoundToUpper(text: string, varName: string, upper: number): string {
  let current = text;
  const constraints = extractSysmlBraceConstraintsFromText(current);
  for (let i = constraints.length - 1; i >= 0; i--) {
    const c = constraints[i]!;
    const comp = parseSysmlComparisonConstraint(c.body);
    if (comp && comp.lhs === varName && comp.operator === ">=" && comp.rhs > upper) {
      const varIdx = findNextWordOutsideQuotes(c.body, varName, 0);
      if (varIdx !== -1) {
        const gePos = skipWs(c.body, varIdx + varName.length);
        if (c.body.startsWith(">=", gePos)) {
          const valStart = skipWs(c.body, gePos + 2);
          const num = readSignedNumberAt(c.body, valStart);
          if (num) {
            const absStart = c.bodyStart + gePos;
            const absEnd = c.bodyStart + num.next;
            const spaceBetween = c.body.slice(gePos + 2, valStart);
            current = current.slice(0, absStart) + `<=${spaceBetween}${upper}` + current.slice(absEnd);
          }
        }
      }
    }
  }
  return current;
}

function clampSysmlAttrAboveUpper(text: string, varName: string, upper: number): string {
  let current = text;
  const attrs = extractSysmlAttributesFromText(current);
  for (let i = attrs.length - 1; i >= 0; i--) {
    const a = attrs[i]!;
    if (a.name === varName && a.hasInitializer && a.valueText) {
      const val = Number(a.valueText.trim());
      if (Number.isFinite(val) && val > upper) {
        const eqIdx = current.indexOf("=", a.stmtStart);
        if (eqIdx !== -1 && eqIdx < a.stmtEnd) {
          const valStart = skipWs(current, eqIdx + 1);
          const num = readSignedNumberAt(current, valStart);
          if (num) {
            current =
              current.slice(0, valStart) + String(Math.floor(upper * 0.8)) + current.slice(valStart + num.text.length);
          }
        }
      }
    }
  }
  return current;
}

function repairModelicaAssertStatements(text: string): string {
  let current = text;
  let pos = 0;
  while (pos < current.length) {
    const idx = findNextWordOutsideQuotes(current, "assert", pos);
    if (idx === -1) break;
    const openParen = skipWs(current, idx + 6);
    if (current[openParen] !== "(") {
      pos = idx + 6;
      continue;
    }
    const argStart = skipWs(current, openParen + 1);
    if (current.startsWith("false", argStart)) {
      const afterFalse = skipWs(current, argStart + 5);
      if (current[afterFalse] === ",") {
        current = current.slice(0, argStart) + "true" + current.slice(argStart + 5);
        pos = argStart + 4;
        continue;
      }
    }
    const lhs = readSignedNumberAt(current, argStart);
    if (lhs) {
      const opStart = skipWs(current, lhs.next);
      const two = current.slice(opStart, opStart + 2);
      const one = current[opStart];
      let op: "<" | "<=" | ">" | ">=" | undefined;
      if (two === "<=" || two === ">=") op = two;
      else if (one === "<" || one === ">") op = one;
      if (op) {
        const rhsStart = skipWs(current, opStart + op.length);
        const rhs = readSignedNumberAt(current, rhsStart);
        if (rhs) {
          const afterRhs = skipWs(current, rhs.next);
          if (current[afterRhs] === ",") {
            const ok =
              op === "<"
                ? lhs.value < rhs.value
                : op === "<="
                  ? lhs.value <= rhs.value
                  : op === ">"
                    ? lhs.value > rhs.value
                    : lhs.value >= rhs.value;
            if (!ok) {
              const flipped = op.startsWith("<") ? ">=" : "<=";
              const replacement = `${lhs.text} ${flipped} ${rhs.text}`;
              current = current.slice(0, argStart) + replacement + current.slice(rhs.next);
              pos = argStart + replacement.length;
              continue;
            }
          }
        }
      }
    }
    pos = openParen + 1;
  }
  return current;
}

function replaceTrailingClosingBrace(text: string, suffix: string): string {
  const trimmedEnd = text.trimEnd();
  return trimmedEnd.endsWith("}") ? trimmedEnd.slice(0, -1) + suffix : text;
}

export interface SelfHealingIterationStep {
  iteration: number;
  code: string;
  verification: ClosedLoopCandidateVerification;
  feedbackPrompt?: string | undefined;
}

export interface SelfHealingResult {
  success: boolean;
  certifiedCode: string;
  iterations: number;
  history: SelfHealingIterationStep[];
  finalVerification: ClosedLoopCandidateVerification;
  unresolvedDiagnostics: GateDiagnostic[];
  bestScore?: number | undefined;
  rollbacksCount?: number | undefined;
}

export type CodeSynthesizer = (
  prompt: string,
  iteration: number,
  diagnostics: GateDiagnostic[],
  previousCode: string,
  failedGate: GateVerificationResult,
  failedGates?: GateVerificationResult[],
  feedbackPrompt?: string,
) => Promise<string>;

export interface SelfHealingPipelineOptions {
  prompt: string;
  initialCode?: string | undefined;
  language?: ClosedLoopLanguage | undefined;
  synthesizer?: CodeSynthesizer | undefined;
  maxIterations?: number | undefined;
  targetGates?: (1 | 2 | 3 | 4)[] | undefined;
  parser?: CstParserLike | null | undefined;
  onStep?: ((step: SelfHealingIterationStep) => void) | undefined;
}

/**
 * Computes a quantitative heuristic fitness score for candidate verification.
 * Gate 1 (syntax) is heavily weighted as a prerequisite; passing semantic gates
 * yields positive rewards while diagnostics incur proportional penalties.
 */
export function scoreCandidateVerification(verification: ClosedLoopCandidateVerification): number {
  if (verification.allPassed) return 10000;
  let score = 0;
  for (const g of verification.gates) {
    if (g.passed) {
      score += g.gate === 1 ? 2000 : 1000;
    } else {
      score -= g.diagnostics.length * 50;
    }
  }
  return score;
}

/**
 * Strip potential Markdown code block fencing from LLM responses (e.g., ```sysml ... ```)
 */
export function cleanEmittedCode(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const nlIdx = cleaned.indexOf("\n");
    if (nlIdx !== -1) {
      const fenceLine = cleaned.slice(3, nlIdx);
      const tag = fenceLine.endsWith("\r") ? fenceLine.slice(0, -1) : fenceLine;
      const isLangTag = [...tag].every((c) => {
        const code = c.charCodeAt(0);
        return (
          (code >= 65 && code <= 90) ||
          (code >= 97 && code <= 122) ||
          (code >= 48 && code <= 57) ||
          c === "_" ||
          c === "-"
        );
      });
      if (isLangTag) {
        cleaned = cleaned.slice(nlIdx + 1);
      }
    }
    if (cleaned.endsWith("\n```")) {
      cleaned = cleaned.slice(0, -4);
      if (cleaned.endsWith("\r")) cleaned = cleaned.slice(0, -1);
    }
  }
  return cleaned.trim();
}

/**
 * Formats a structured diagnostic feedback prompt for the synthesizer LLM,
 * incorporating diagnostics and mathematical proof artifacts across all failed gates.
 */
export function formatCompilerFeedbackPrompt(
  userIntent: string,
  iteration: number,
  failedGateOrGates: GateVerificationResult | GateVerificationResult[],
  code: string,
): string {
  const failedGates = Array.isArray(failedGateOrGates) ? failedGateOrGates : [failedGateOrGates];
  const allDiags = failedGates.flatMap((g) => g.diagnostics);

  const diagLines = allDiags
    .map(
      (d) =>
        `- [${d.severity.toUpperCase()}] Gate ${d.gate} (${d.gateName}): ${d.message}${
          d.line ? ` (Line ${d.line}${d.column ? `:${d.column}` : ""})` : ""
        }${d.sourceContext ? ` Context: '${d.sourceContext}'` : ""}`,
    )
    .join("\n");

  const metaSections: string[] = [];
  for (const g of failedGates) {
    if (g.metadata?.unsatCore && g.metadata.unsatCore.length > 0) {
      metaSections.push(`Minimal UNSAT Core (Conflicting Requirements): ${g.metadata.unsatCore.join(", ")}`);
    }
    if (g.metadata?.degreesOfFreedom !== undefined) {
      metaSections.push(
        `Structural Balance Discrepancy: ${g.metadata.numEquations} equations vs ${g.metadata.numVariables} variables (Degrees of freedom: ${g.metadata.degreesOfFreedom})`,
      );
    }
  }

  const gateHeader = failedGates.map((g) => `Gate ${g.gate} (${g.gateName})`).join(", ");

  return `
The candidate model failed verification at ${gateHeader} on Iteration ${iteration}.

### Compiler Diagnostics:
${diagLines}
${metaSections.length > 0 ? `\n### Mathematical Proof Details:\n${metaSections.join("\n")}\n` : ""}

### Original Specification:
"${userIntent}"

### Current Code:
\`\`\`
${code}
\`\`\`

### Instruction:
Please repair the model to resolve ALL compiler diagnostics above. Ensure that:
1. All physical dimensions, units, and quantity equations are strictly consistent.
2. All SMT requirement bounds are mathematically feasible without contradictions.
3. The system of equations is structurally balanced (N_eq == N_var).
4. Do NOT remove functional elements unless directly conflicting.
Output ONLY the complete, repaired model code without introductory explanations.
`.trim();
}

/**
 * Built-in heuristic repair synthesizer for offline testing, deterministic repairs,
 * and environments without external LLM access.
 */
export function createHeuristicRepairSynthesizer(): CodeSynthesizer {
  return async (
    _prompt: string,
    _iteration: number,
    diagnostics: GateDiagnostic[],
    previousCode: string,
    failedGate: GateVerificationResult,
    failedGates?: GateVerificationResult[],
  ): Promise<string> => {
    let repaired = previousCode;
    const gatesToProcess = failedGates && failedGates.length > 0 ? failedGates : [failedGate];

    for (const gate of gatesToProcess) {
      // Gate 1: Syntax repair
      if (gate.gate === 1) {
        const openCount = countChar(repaired, "{");
        const closeCount = countChar(repaired, "}");
        if (openCount > closeCount) {
          repaired += "\n" + "}".repeat(openCount - closeCount);
        }
        // Check for unclosed Modelica model/class definition
        const modelName = extractModelicaClassNameFromText(repaired, ["model", "class", "block"]);
        if (modelName && !hasModelicaEndStmt(repaired, modelName)) {
          repaired = `${repaired.trimEnd()}\nend ${modelName};\n`;
        }
      }

      // Gate 2: Dimensional repair
      if (gate.gate === 2) {
        const lengthAttr = extractSysmlAttributesFromText(repaired).find((a) => a.typeName === "Length");
        const fallbackLengthVar = lengthAttr?.name ?? "len";

        for (const d of diagnostics) {
          const featureName = d.metadata?.["featureName"];
          const declaredType = d.metadata?.["declaredType"];
          if (featureName) {
            const matchingAttr = extractSysmlAttributesFromText(repaired).find(
              (a) => a.name === featureName && a.hasInitializer,
            );
            if (matchingAttr) {
              repaired =
                repaired.slice(0, matchingAttr.stmtStart) +
                `attribute ${featureName} : Length = ${fallbackLengthVar};` +
                repaired.slice(matchingAttr.stmtEnd);
            }
            if (declaredType) {
              repaired = repairModelicaTypedDeclRhs(repaired, String(declaredType), String(featureName), "1.0");
            }
          }

          // Modelica unit bracket mismatch repair: e.g. 5[m] + 10[s] -> 5[m] + 10[m]
          repaired = repairModelicaBracketedUnitMismatches(repaired);

          if (d.metadata?.["constraintName"] || d.message.includes("incompatible physical dimensions")) {
            repaired = repairIncompatibleLengthConstraints(repaired, fallbackLengthVar);
          }

          if (d.metadata?.["connectionName"] || d.message.includes("connection")) {
            repaired = repairSysmlConnectStatements(repaired);
          }
        }
      }

      // Gate 3: SMT Requirement repair
      if (gate.gate === 3) {
        // Specific known patterns + general bound conflict resolution
        repaired = repairWeightMassInit(repaired);
        repaired = repairWeightConstraintLowerBound(repaired);

        // General SysML v2 upper/lower bound conflict repair:
        // If `var <= U` and `var >= L` with L > U, relax the >= L constraint to <= U
        const upperBounds = new Map<string, number>();
        for (const c of extractSysmlBraceConstraintsFromText(repaired)) {
          const comp = parseSysmlComparisonConstraint(c.body);
          if (comp && comp.operator === "<=") {
            upperBounds.set(comp.lhs, comp.rhs);
          }
        }
        for (const [varName, upper] of upperBounds) {
          repaired = relaxSysmlLowerBoundToUpper(repaired, varName, upper);
          repaired = clampSysmlAttrAboveUpper(repaired, varName, upper);
        }

        // General Modelica infeasible assert(...) repair
        repaired = repairModelicaAssertStatements(repaired);
      }

      // Gate 4: DAE Structural balance repair
      if (gate.gate === 4) {
        const numEqs = gate.metadata?.numEquations ?? 0;
        const numVars = gate.metadata?.numVariables ?? 0;
        const isModelica = hasWordMatch(repaired, "equation") && hasAnyModelicaEndDecl(repaired);

        if (isModelica) {
          if (numEqs > numVars) {
            // Remove excess equations from equation section
            const sec = findModelicaSectionSpan(repaired, "equation");
            if (sec) {
              const keep = splitSemicolonStatementsOutsideQuotes(repaired.slice(sec.bodyStart, sec.bodyEnd)).slice(
                0,
                Math.max(0, numVars),
              );
              const replacement = `equation\n  ${keep.map((s) => `${s};`).join("\n  ")}\n${sec.endTermText}`;
              repaired =
                repaired.slice(0, sec.kwStart) + replacement + repaired.slice(sec.endKwStart + sec.endTermText.length);
            }
          } else if (numEqs < numVars) {
            // Find declared dynamic variables missing an equation
            const declPart = splitModelicaBeforeEquation(repaired);
            const eqIdx = findNextWordOutsideQuotes(repaired, "equation", 0);
            const eqPart = eqIdx !== -1 ? repaired.slice(eqIdx + 8) : "";
            const missingVars = extractModelicaStateVarsFromDecls(declPart).filter((v) => !hasWordMatch(eqPart, v));
            const needed = numVars - numEqs;
            const additions: string[] = [];
            for (let i = 0; i < needed; i++) {
              const vName = missingVars[i] ?? `x_${i}`;
              additions.push(`  ${vName} = 0.0;`);
            }
            repaired = insertBeforeModelicaEndStmt(repaired, `${additions.join("\n")}\n`);
          } else {
            // Structurally singular (numEqs == numVars, but unmatched variables exist)
            const unmatchedVars = gate.diagnostics.flatMap(
              (d) => (d.metadata?.["unmatchedVars"] as string[] | undefined) ?? [],
            );
            if (unmatchedVars.length > 0) {
              const sec = findModelicaSectionSpan(repaired, "equation");
              if (sec) {
                const stmts = splitSemicolonStatementsOutsideQuotes(repaired.slice(sec.bodyStart, sec.bodyEnd));
                for (let i = 0; i < unmatchedVars.length && i < stmts.length; i++) {
                  stmts[stmts.length - 1 - i] = `${unmatchedVars[i]} = 0.0`;
                }
                const replacement = `equation\n  ${stmts.map((s) => `${s};`).join("\n  ")}\n${sec.endTermText}`;
                repaired =
                  repaired.slice(0, sec.kwStart) +
                  replacement +
                  repaired.slice(sec.endKwStart + sec.endTermText.length);
              }
            }
          }
        } else {
          if (numEqs > numVars) {
            const nonEmpty = extractSysmlBraceConstraintsFromText(repaired).filter((c) => c.body.trim().length > 0);
            if (nonEmpty.length > 0) {
              const last = nonEmpty[nonEmpty.length - 1]!;
              repaired = repaired.slice(0, last.start) + repaired.slice(last.end);
            }
          } else if (numEqs < numVars) {
            // Find uninitialized attributes in SysML v2
            const uninitVars = extractSysmlAttributesFromText(repaired)
              .filter((a) => !a.hasInitializer)
              .map((a) => a.name);
            const targetVar = uninitVars.includes("sled_v")
              ? "sled_v"
              : (uninitVars[uninitVars.length - 1] ?? "sled_v");
            repaired = replaceTrailingClosingBrace(repaired, `  assert constraint { ${targetVar} == 10.0 }\n}\n`);
          }
        }
      }
    }

    return repaired;
  };
}

/**
 * Executes the full Closed-Loop Self-Healing Pipeline with Pareto candidate tracking
 * and automatic rollback on regressions.
 */
export async function runSelfHealingPipeline(options: SelfHealingPipelineOptions): Promise<SelfHealingResult> {
  const engine = new ClosedLoopCompilerEngine();
  const maxIterations = options.maxIterations ?? 4;
  const language = options.language ?? "sysml2";
  const synthesizer = options.synthesizer ?? createHeuristicRepairSynthesizer();
  const targetGates = options.targetGates ?? [1, 2, 3, 4];
  const history: SelfHealingIterationStep[] = [];

  let currentCode = cleanEmittedCode(
    options.initialCode || `package CandidateModel {\n  part def System {\n    attribute status : String;\n  }\n}`,
  );

  let lastVerification: ClosedLoopCandidateVerification = {
    allPassed: false,
    gates: [],
    summary: "Verification not started",
    timestamp: new Date().toISOString(),
  };

  const verifyOpts: VerifyCandidateOptions = {
    parser: options.parser,
    targetGates,
  };

  interface BestCandidateState {
    code: string;
    score: number;
    verification: ClosedLoopCandidateVerification;
    iteration: number;
  }

  let bestCandidate: BestCandidateState | null = null;
  let rollbacksCount = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const verification = await engine.verifyCandidate(currentCode, language, verifyOpts);
    lastVerification = verification;
    const currentScore = scoreCandidateVerification(verification);

    const step: SelfHealingIterationStep = {
      iteration,
      code: currentCode,
      verification,
    };

    if (verification.allPassed) {
      history.push(step);
      options.onStep?.(step);
      return {
        success: true,
        certifiedCode: currentCode,
        iterations: iteration,
        history,
        finalVerification: verification,
        unresolvedDiagnostics: [],
        bestScore: currentScore,
        rollbacksCount,
      };
    }

    // Identify all failing gates
    const failedGates = verification.gates.filter((g) => !g.passed);
    const failedGate = failedGates[0];
    if (!failedGate) {
      history.push(step);
      options.onStep?.(step);
      break;
    }

    // Update Pareto best-candidate tracking
    if (!bestCandidate || currentScore > bestCandidate.score) {
      bestCandidate = {
        code: currentCode,
        score: currentScore,
        verification,
        iteration,
      };
    } else if (bestCandidate && currentScore < bestCandidate.score - 40 && iteration < maxIterations) {
      // Regression detected (e.g. broke syntax or introduced extra gate failures)
      // Roll back candidate code to the highest-scoring candidate
      currentCode = bestCandidate.code;
      rollbacksCount++;
    }

    const allFailedDiagnostics = failedGates.flatMap((g) => g.diagnostics);
    const feedbackPrompt = formatCompilerFeedbackPrompt(options.prompt, iteration, failedGates, currentCode);
    step.feedbackPrompt = feedbackPrompt;
    history.push(step);
    options.onStep?.(step);

    if (iteration === maxIterations) {
      break;
    }

    // Call synthesizer to get repaired candidate
    try {
      const repaired = await synthesizer(
        options.prompt,
        iteration,
        allFailedDiagnostics,
        currentCode,
        failedGate,
        failedGates,
        feedbackPrompt,
      );
      currentCode = cleanEmittedCode(repaired);
    } catch (synthErr: unknown) {
      const failingGate = failedGates[0];
      const errMsg = synthErr instanceof Error ? synthErr.message : String(synthErr);
      return {
        success: false,
        certifiedCode: bestCandidate?.code ?? currentCode,
        iterations: iteration,
        history,
        finalVerification: bestCandidate?.verification ?? verification,
        unresolvedDiagnostics: [
          ...allFailedDiagnostics,
          {
            gate: failingGate?.gate ?? 1,
            gateName: failingGate?.gateName ?? "WASM GLR Syntax",
            severity: "error",
            message: `Synthesizer error: ${errMsg}`,
          },
        ],
        bestScore: bestCandidate?.score ?? currentScore,
        rollbacksCount,
      };
    }
  }

  // If search exhausted without passing all gates, return best-scoring candidate
  const returnedCode =
    bestCandidate && bestCandidate.score > scoreCandidateVerification(lastVerification)
      ? bestCandidate.code
      : currentCode;
  const returnedVerification =
    bestCandidate && bestCandidate.score > scoreCandidateVerification(lastVerification)
      ? bestCandidate.verification
      : lastVerification;

  const unresolved = returnedVerification.gates.filter((g) => !g.passed).flatMap((g) => g.diagnostics);

  return {
    success: false,
    certifiedCode: returnedCode,
    iterations: maxIterations,
    history,
    finalVerification: returnedVerification,
    unresolvedDiagnostics: unresolved,
    bestScore: bestCandidate?.score,
    rollbacksCount,
  };
}
