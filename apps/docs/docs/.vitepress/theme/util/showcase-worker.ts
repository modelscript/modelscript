// SPDX-License-Identifier: AGPL-3.0-or-later

import { evaluateCoordinatorScenario, type CoordinatorEvaluationResult } from "./semantic-coordinator-engine.js";
import {
  compileTargetToSource,
  compileWorkflowPair,
  type WorkflowCompileResult,
  type WorkflowConflictStrategy,
} from "./workflow-compiler.js";
import {
  highlightWorkflowCode,
  lintSyntaxForLang,
  lintWorkflowCode,
  type WorkflowDiagnostic,
} from "./workflow-highlighter.js";

export interface HighlightAndLintResult {
  highlightedLines: string[];
  diagnostics: WorkflowDiagnostic[];
}

export type ShowcaseWorkerRequest =
  | {
      requestId: number;
      kind: "evaluateCoordinator";
      scenarioId: string;
      rawCodes: [string, string, string, string];
      editedPaneIndex: number;
    }
  | {
      requestId: number;
      kind: "compileForward";
      pairId: string;
      sourceCode: string;
      strategy: WorkflowConflictStrategy;
    }
  | {
      requestId: number;
      kind: "compileBackward";
      pairId: string;
      targetCode: string;
      currentSourceCode?: string;
      strategy: WorkflowConflictStrategy;
    }
  | {
      requestId: number;
      kind: "highlightAndLint";
      code: string;
      lang: string;
      pairId?: string;
      side?: "source" | "target";
    };

export type ShowcaseWorkerResponse =
  | { requestId: number; kind: "evaluateCoordinator"; result: CoordinatorEvaluationResult }
  | { requestId: number; kind: "compileForward" | "compileBackward"; result: WorkflowCompileResult }
  | { requestId: number; kind: "highlightAndLint"; result: HighlightAndLintResult }
  | { requestId: number; kind: "error"; message: string };

self.addEventListener("message", (event: MessageEvent<ShowcaseWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.kind === "evaluateCoordinator") {
      const result = evaluateCoordinatorScenario(msg.scenarioId, msg.rawCodes, msg.editedPaneIndex);
      self.postMessage({ requestId: msg.requestId, kind: msg.kind, result } satisfies ShowcaseWorkerResponse);
    } else if (msg.kind === "compileForward") {
      const result = compileWorkflowPair(msg.pairId, msg.sourceCode, msg.strategy);
      self.postMessage({ requestId: msg.requestId, kind: msg.kind, result } satisfies ShowcaseWorkerResponse);
    } else if (msg.kind === "compileBackward") {
      const result = compileTargetToSource(msg.pairId, msg.targetCode, msg.currentSourceCode, msg.strategy);
      self.postMessage({ requestId: msg.requestId, kind: msg.kind, result } satisfies ShowcaseWorkerResponse);
    } else if (msg.kind === "highlightAndLint") {
      const highlightedLines = highlightWorkflowCode(msg.code, msg.lang);
      const diagnostics =
        msg.pairId && msg.side
          ? lintWorkflowCode(msg.pairId, msg.side, msg.code)
          : lintSyntaxForLang(msg.code, msg.lang);
      self.postMessage({
        requestId: msg.requestId,
        kind: msg.kind,
        result: { highlightedLines, diagnostics },
      } satisfies ShowcaseWorkerResponse);
    }
  } catch (err) {
    self.postMessage({
      requestId: msg.requestId,
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies ShowcaseWorkerResponse);
  }
});
