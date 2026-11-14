// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CoordinatorEvaluationResult } from "./semantic-coordinator-engine.js";
import type { ShowcaseWorkerRequest, ShowcaseWorkerResponse } from "./showcase-worker.js";
import type { WorkflowCompileResult, WorkflowConflictStrategy } from "./workflow-compiler.js";
import type { WorkflowDiagnostic } from "./workflow-highlighter.js";

/** HTML-escaped plain line array used for instant SSR and before the Web Worker returns highlights. */
export function plainLinesHtml(code: string): string[] {
  return code.split("\n").map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || " ");
}

let workerInstance: Worker | null | undefined;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (err: Error) => void; superseded?: boolean }
>();
const latestByChannel = new Map<string, number>();

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  if (workerInstance !== undefined) return workerInstance;
  try {
    const w = new Worker(new URL("./showcase-worker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (event: MessageEvent<ShowcaseWorkerResponse>) => {
      const res = event.data;
      const entry = pending.get(res.requestId);
      if (!entry) return;
      pending.delete(res.requestId);
      if (entry.superseded) return;
      if (res.kind === "error") {
        entry.reject(new Error(res.message));
      } else {
        entry.resolve(res.result);
      }
    });
    w.addEventListener("error", () => {
      workerInstance = null;
    });
    workerInstance = w;
    return w;
  } catch {
    workerInstance = null;
    return null;
  }
}

async function dispatchToWorker<T>(
  channel: string,
  buildReq: (requestId: number) => ShowcaseWorkerRequest,
  asyncFallback: () => Promise<T>,
): Promise<T> {
  const worker = getWorker();
  if (!worker) {
    return asyncFallback();
  }

  const prevId = latestByChannel.get(channel);
  if (prevId !== undefined) {
    const prevEntry = pending.get(prevId);
    if (prevEntry) prevEntry.superseded = true;
  }

  const requestId = nextRequestId++;
  latestByChannel.set(channel, requestId);

  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    try {
      worker.postMessage(buildReq(requestId));
    } catch {
      pending.delete(requestId);
      void asyncFallback().then(resolve, reject);
    }
  });
}

export function evaluateCoordinatorScenarioAsync(
  scenarioId: string,
  rawCodes: [string, string, string, string],
  editedPaneIndex: number = 0,
): Promise<CoordinatorEvaluationResult> {
  return dispatchToWorker(
    `coordinator:${scenarioId}`,
    (requestId) => ({
      requestId,
      kind: "evaluateCoordinator",
      scenarioId,
      rawCodes: [...rawCodes] as [string, string, string, string],
      editedPaneIndex,
    }),
    async () => {
      const { evaluateCoordinatorScenario } = await import("./semantic-coordinator-engine.js");
      return evaluateCoordinatorScenario(scenarioId, rawCodes, editedPaneIndex);
    },
  );
}

export function compileWorkflowPairAsync(
  pairId: string,
  sourceCode: string,
  strategy: WorkflowConflictStrategy = "target-wins",
): Promise<WorkflowCompileResult> {
  return dispatchToWorker(
    `tgg:${pairId}`,
    (requestId) => ({
      requestId,
      kind: "compileForward",
      pairId,
      sourceCode,
      strategy,
    }),
    async () => {
      const { compileWorkflowPair } = await import("./workflow-compiler.js");
      return compileWorkflowPair(pairId, sourceCode, strategy);
    },
  );
}

export function compileTargetToSourceAsync(
  pairId: string,
  targetCode: string,
  currentSourceCode?: string,
  strategy: WorkflowConflictStrategy = "target-wins",
): Promise<WorkflowCompileResult> {
  return dispatchToWorker(
    `tgg:${pairId}`,
    (requestId) => ({
      requestId,
      kind: "compileBackward",
      pairId,
      targetCode,
      currentSourceCode,
      strategy,
    }),
    async () => {
      const { compileTargetToSource } = await import("./workflow-compiler.js");
      return compileTargetToSource(pairId, targetCode, currentSourceCode, strategy);
    },
  );
}

export function highlightAndLintCodeAsync(
  channelKey: string,
  code: string,
  lang: string,
  pairId?: string,
  side?: "source" | "target",
): Promise<{ highlightedLines: string[]; diagnostics: WorkflowDiagnostic[] }> {
  return dispatchToWorker(
    `hl:${channelKey}`,
    (requestId) => ({
      requestId,
      kind: "highlightAndLint",
      code,
      lang,
      pairId,
      side,
    }),
    async () => {
      const { highlightWorkflowCode, lintSyntaxForLang, lintWorkflowCode } = await import("./workflow-highlighter.js");
      return {
        highlightedLines: highlightWorkflowCode(code, lang),
        diagnostics: pairId && side ? lintWorkflowCode(pairId, side, code) : lintSyntaxForLang(code, lang),
      };
    },
  );
}
