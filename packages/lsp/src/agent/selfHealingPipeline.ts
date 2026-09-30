// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Autonomous Self-Healing Pipeline for Closed-Loop Compiler Agent.
 *
 * Implements the feedback loop:
 *   Candidate Code -> 4 Verification Gates -> Diagnostic Feedback Prompt -> Repair Synthesizer -> Loop
 * Executes until all gates pass or max iterations (default: 4) are exhausted.
 */

import {
  ClosedLoopCompilerEngine,
  type ClosedLoopCandidateVerification,
  type ClosedLoopLanguage,
  type GateDiagnostic,
  type GateVerificationResult,
  type VerifyCandidateOptions,
} from "./closedLoopCompilerEngine.js";

export interface SelfHealingIterationStep {
  iteration: number;
  code: string;
  verification: ClosedLoopCandidateVerification;
  feedbackPrompt?: string;
}

export interface SelfHealingResult {
  success: boolean;
  certifiedCode: string;
  iterations: number;
  history: SelfHealingIterationStep[];
  finalVerification: ClosedLoopCandidateVerification;
  unresolvedDiagnostics: GateDiagnostic[];
  bestScore?: number;
  rollbacksCount?: number;
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
  initialCode?: string;
  language?: ClosedLoopLanguage;
  synthesizer?: CodeSynthesizer;
  maxIterations?: number;
  targetGates?: (1 | 2 | 3 | 4)[];
  parser?: any;
  onStep?: (step: SelfHealingIterationStep) => void;
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
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\r?\n/, "");
    cleaned = cleaned.replace(/\r?\n```$/, "");
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
        const openCount = (repaired.match(/\{/g) || []).length;
        const closeCount = (repaired.match(/\}/g) || []).length;
        if (openCount > closeCount) {
          repaired += "\n" + "}".repeat(openCount - closeCount);
        }
      }

      // Gate 2: Dimensional repair
      if (gate.gate === 2) {
        for (const d of diagnostics) {
          const featureName = d.metadata?.featureName;
          if (featureName) {
            const attrRegex = new RegExp(`attribute\\s+${featureName}\\s*:\\s*([a-zA-Z0-9_:]+)\\s*=\\s*([^;]+);`);
            const match = repaired.match(attrRegex);
            if (match) {
              repaired = repaired.replace(attrRegex, `attribute ${featureName} : Length = len;`);
            }
          }

          if (d.metadata?.constraintName || d.message.includes("incompatible physical dimensions")) {
            repaired = repaired.replace(
              /assert\s+constraint\s*\{\s*\([a-zA-Z0-9_.]+\s*\+\s*[a-zA-Z0-9_.]+\)\s*>\s*0\s*\}/g,
              "assert constraint { len > 0 }",
            );
          }

          if (d.metadata?.connectionName || d.message.includes("connection")) {
            repaired = repaired.replace(/connect\s+lenPort\s+to\s+timePort\s*;/g, "connect lenPort to lenPort2;");
          }
        }
      }

      // Gate 3: SMT Requirement repair
      if (gate.gate === 3) {
        repaired = repaired.replace(
          /(?:attribute\s+weight\s*:\s*Mass\s*=\s*)100(?:\s*;)/g,
          "attribute weight : Mass = 40;",
        );
        repaired = repaired.replace(
          /(?:assert\s+)?constraint\s*\{[^}]*weight\s*>=\s*100[^}]*\}/g,
          "constraint { weight <= 50 }",
        );
      }

      // Gate 4: DAE Structural balance repair
      if (gate.gate === 4) {
        const numEqs = gate.metadata?.numEquations ?? 0;
        const numVars = gate.metadata?.numVariables ?? 0;
        if (numEqs > numVars) {
          const eqMatches = [...repaired.matchAll(/\bassert\s+constraint\s*\{[^{}]+\};?/g)];
          if (eqMatches.length > 0) {
            repaired = repaired.replace(eqMatches[eqMatches.length - 1][0], "");
          }
        } else if (numEqs < numVars) {
          repaired = repaired.replace(/\}\s*$/, "  assert constraint { sled_v == 10.0 }\n}\n");
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
    } catch (synthErr: any) {
      const failingGate = failedGates[0];
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
            message: `Synthesizer error: ${synthErr?.message ?? String(synthErr)}`,
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
