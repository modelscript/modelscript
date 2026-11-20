// SPDX-License-Identifier: AGPL-3.0-or-later

import { getModelicaCodeLenses } from "@modelscript/modelica";
import { getSysml2CodeLenses } from "@modelscript/sysml2";
import assert from "node:assert";
import test from "node:test";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerInlayHintProvider } from "../src/providers/inlayHintProvider.js";
import { ValidationService } from "../src/services/validation-service.js";
import { hasWorkspaceLinter } from "../src/services/workspace-linter-dispatch.js";

function createTestValidationService(overrides?: { sendRequest?: (method: string) => Promise<unknown> }) {
  const sentRequests: string[] = [];
  const mockConnection: any = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    sendDiagnostics() {},
    sendNotification() {},
    sendRequest: (method: string) => {
      sentRequests.push(method);
      return overrides?.sendRequest ? overrides.sendRequest(method) : Promise.resolve();
    },
  };
  const docs = new Map<string, TextDocument>();
  const mockDocManager: any = {
    documents: {
      get: (u: string) => docs.get(u),
      all: () => Array.from(docs.values()),
    },
    documentTrees: new Map(),
  };
  const mockWorkspaceManager: any = {
    getQueryEngine: () => undefined,
    getWorkspaceIndex: () => undefined,
    getThreadsForUri: () => [],
    unifiedWorkspace: {
      getIndex: () => ({ symbols: new Map(), symbolsByResource: new Map() }),
      owl2Store: { getAxioms: () => [], setAxioms: () => {} },
    },
  };
  const service = new ValidationService(mockConnection, mockDocManager, mockWorkspaceManager, {} as any);
  return { service, docs, sentRequests };
}

test("ValidationService.applyDiagnosticFilters enforces disabledRules, crossDomainDrift, and maxProblems", () => {
  const { service } = createTestValidationService();
  const sample: Diagnostic[] = [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      severity: DiagnosticSeverity.Error,
      code: 2002,
      message: "Variable not found",
      source: "modelica",
    },
    {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      severity: DiagnosticSeverity.Warning,
      code: "M5104",
      message: "Cross-language parameter drift",
      source: "modelscript-drift-checker",
    },
    {
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
      severity: DiagnosticSeverity.Warning,
      code: "div_by_zero",
      message: "Potential division by zero",
      source: "modelscript-dae-verifier",
      data: { rule: "M5101" },
    },
  ];

  // disabledRules matches numeric M-prefixed code and data.rule
  service.diagnosticsConfig = { disabledRules: ["M2002", "m5101"] };
  const afterDisabled = service.applyDiagnosticFilters(sample);
  assert.strictEqual(afterDisabled.length, 1);
  assert.strictEqual(afterDisabled[0]?.code, "M5104");

  // crossDomainDrift: "off" removes drift diagnostics; "error" upgrades severity
  service.diagnosticsConfig = { crossDomainDrift: "off" };
  const afterDriftOff = service.applyDiagnosticFilters(sample);
  assert.strictEqual(
    afterDriftOff.some((d) => d.code === "M5104"),
    false,
  );

  service.diagnosticsConfig = { crossDomainDrift: "error" };
  const afterDriftErr = service.applyDiagnosticFilters(sample);
  const driftDiag = afterDriftErr.find((d) => d.code === "M5104");
  assert.strictEqual(driftDiag?.severity, DiagnosticSeverity.Error);

  // maxNumberOfProblems caps result length
  service.diagnosticsConfig = { maxNumberOfProblems: 2 };
  const afterCap = service.applyDiagnosticFilters(sample);
  assert.strictEqual(afterCap.length, 2);
});

test("ValidationService.checkAutoVerify prevents infinite re-verification loop for unchanged text", () => {
  const { service, docs } = createTestValidationService();
  const uri = "file:///workspace/verify.sysml";
  const doc = TextDocument.create(uri, "sysml2", 1, "verification def V {}");
  docs.set(uri, doc);

  // Inject a verification case symbol so checkAutoVerify would normally schedule
  (service as any).workspaceManager.unifiedWorkspace.getIndex = () => ({
    symbols: new Map([[1, { id: 1, ruleName: "VerificationCaseDefinition", resourceId: uri }]]),
    symbolsByResource: new Map([[uri, [1]]]),
  });

  // First call schedules verification and records lastAutoVerifiedText
  (service as any).checkAutoVerify(uri);
  const firstTimer = service.verificationTimer;
  assert.ok(firstTimer, "First checkAutoVerify should schedule verificationTimer");
  assert.strictEqual(service.lastAutoVerifiedText.get(uri), doc.getText());

  // Second call on identical text must be a no-op (does not replace/reschedule timer)
  (service as any).checkAutoVerify(uri);
  assert.strictEqual(service.verificationTimer, firstTimer, "Second checkAutoVerify on same text must not reschedule");

  if (service.verificationTimer) {
    clearTimeout(service.verificationTimer);
    service.verificationTimer = null;
  }
});

test("ValidationService.requestCodeLensRefresh debounces workspace/codeLens/refresh", async () => {
  const { service, sentRequests } = createTestValidationService();
  service.requestCodeLensRefresh(20);
  service.requestCodeLensRefresh(20);
  service.requestCodeLensRefresh(20);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepStrictEqual(sentRequests, ["workspace/codeLens/refresh"]);
});

test("getModelicaCodeLenses respects problemsOnly even when formalVerification is true and normalizes library URIs", () => {
  const libUri = "modelscript-lib://global/pkg/Demo.mo";
  const fileUri = "file:///pkg/Demo.mo";
  const text = `package Demo
  function safeFn
    input Real x;
    output Real y;
  algorithm
    y := x;
  end safeFn;

  function badFn
    input Real x;
    output Real y;
  algorithm
    y := 1.0 / 0.0;
  end badFn;
end Demo;`;

  const proofMap = new Map<string, any>([
    ["safeFn", { isCertifiedSafe: true, definiteBugs: [], potentialBugs: [], formattedMatrix: "" }],
    [
      "badFn",
      {
        isCertifiedSafe: false,
        definiteBugs: [{ category: "division_by_zero", description: "div by zero" }],
        potentialBugs: [],
        formattedMatrix: "bad",
      },
    ],
  ]);

  const problemsOnlyLenses = getModelicaCodeLenses(
    { uri: libUri, getText: () => text },
    {
      uri: libUri,
      text,
      flags: {
        showSimulate: false,
        showVerification: true,
        verificationMode: "problemsOnly",
        formalVerification: true,
      },
      validationService: {
        // Stored under effective file:// URI while CodeLens is queried with modelscript-lib://global URI
        modelicaProofResultsByUri: new Map([[fileUri, proofMap]]),
      },
    },
  );

  assert.strictEqual(
    problemsOnlyLenses.some((l) => l.command.title.includes("Formally Verified")),
    false,
    "problemsOnly must suppress healthy badge even when formalVerification=true",
  );
  assert.strictEqual(
    problemsOnlyLenses.some((l) => l.command.title.includes("Formal Defect")),
    true,
    "problemsOnly must resolve proofMap across modelscript-lib://global -> file:// and show defect badge",
  );
});

test("getSysml2CodeLenses emits a single deduplicated lens per requirement def", () => {
  const text = `requirement def MaxTempReq {
  doc /* Temperature must stay below 80C */
}`;
  const lenses = getSysml2CodeLenses(text, "file:///workspace/reqs.sysml", {
    flags: { showVerification: true },
  });
  assert.strictEqual(lenses.length, 1, `Expected 1 lens for requirement def, got ${lenses.length}`);
  assert.strictEqual(lenses[0]?.command.command, "modelscript.runReachabilityFlowpipe");
});

test("inlayHintProvider emits DAE variable bound hints when formalProofBadges is enabled", async () => {
  const uri = "file:///workspace/Bounds.mo";
  const text = "model Bounds\n  Real x;\nend Bounds;\n";
  const doc = TextDocument.create(uri, "modelica", 1, text);

  let inlayHandler: any = null;
  const daeMap = new Map([
    [
      "Bounds",
      {
        variableBounds: new Map([
          [
            "x",
            {
              isTop: () => false,
              isBottom: () => false,
              toString: () => "[0, 10]",
            },
          ],
        ]),
      },
    ],
  ]);

  const mockContext: any = {
    connection: {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/inlayHint") inlayHandler = handler;
      },
    },
    documents: { get: (u: string) => (u === uri ? doc : undefined) },
    workspaceManager: {
      getWorkspaceIndex: (lang: string) =>
        lang === "modelica"
          ? {
              getFileIndex: () => ({
                symbols: new Map([
                  [
                    1,
                    {
                      name: "x",
                      selectionRange: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } },
                      metadata: {},
                    },
                  ],
                ]),
              }),
            }
          : undefined,
    },
    validationService: {
      daeVerificationResultsByUri: new Map([[uri, daeMap]]),
    },
    settings: {
      inlayHints: { enabled: true, unitsAndBounds: true, formalProofBadges: false },
    },
  };

  registerInlayHintProvider(mockContext);
  assert.ok(inlayHandler);

  const range = { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } };
  const hintsOff = await inlayHandler({ textDocument: { uri }, range });
  assert.strictEqual(hintsOff.length, 0, "formalProofBadges=false must not emit bound hints");

  mockContext.settings.inlayHints.formalProofBadges = true;
  const hintsOn = await inlayHandler({ textDocument: { uri }, range });
  assert.strictEqual(hintsOn.length, 1);
  assert.strictEqual(hintsOn[0].label, " ∈ [0, 10]");
});

test("hasWorkspaceLinter includes cross-domain reqif and sysml2 languages", () => {
  assert.strictEqual(hasWorkspaceLinter("reqif"), true);
  assert.strictEqual(hasWorkspaceLinter("sysml2"), true);
  assert.strictEqual(hasWorkspaceLinter("psse"), true);
  assert.strictEqual(hasWorkspaceLinter("pscad"), true);
});

test("inlayHintProvider emits (-∞, +∞) hints for unbounded variables when DAE proof is inconclusive", async () => {
  const uri = "file:///workspace/Unbounded.mo";
  const text = "model Unbounded\n  Real x;\nend Unbounded;\n";
  const doc = TextDocument.create(uri, "modelica", 1, text);

  let inlayHandler: any = null;
  const daeMap = new Map([
    [
      "Unbounded",
      {
        verdict: { kind: "unknown" },
        unboundedVariables: 1,
        variableBounds: new Map(),
      },
    ],
  ]);

  const mockContext: any = {
    connection: {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/inlayHint") inlayHandler = handler;
      },
    },
    documents: { get: (u: string) => (u === uri ? doc : undefined) },
    workspaceManager: {
      getWorkspaceIndex: (lang: string) =>
        lang === "modelica"
          ? {
              getFileIndex: () => ({
                symbols: new Map([
                  [
                    1,
                    {
                      name: "x",
                      kind: "Component",
                      selectionRange: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } },
                      metadata: { variability: "continuous" },
                    },
                  ],
                ]),
              }),
            }
          : undefined,
    },
    validationService: {
      daeVerificationResultsByUri: new Map([[uri, daeMap]]),
    },
    settings: {
      inlayHints: { enabled: true, unitsAndBounds: true, formalProofBadges: true },
    },
  };

  registerInlayHintProvider(mockContext);
  const hints = await inlayHandler({
    textDocument: { uri },
    range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
  });
  assert.strictEqual(hints.length, 1);
  assert.strictEqual(hints[0].label, " ∈ (-∞, +∞)");
});

test("ValidationService.emitVerificationStatus publishes counts and gutter markers", () => {
  const notifications: Array<{ method: string; params: any }> = [];
  const mockConnection: any = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    sendDiagnostics() {},
    sendNotification: (method: string, params: any) => {
      notifications.push({ method, params });
    },
  };
  const uri = "file:///workspace/StatusDemo.mo";
  const text = "model Safe\nend Safe;\nfunction Bad\nend Bad;\n";
  const doc = TextDocument.create(uri, "modelica", 1, text);
  const mockDocManager: any = {
    documents: { get: (u: string) => (u === uri ? doc : undefined), all: () => [doc] },
    documentTrees: new Map(),
  };
  const mockWorkspaceManager: any = {
    getQueryEngine: () => undefined,
    getWorkspaceIndex: () => undefined,
    getThreadsForUri: () => [],
    unifiedWorkspace: {
      getIndex: () => ({ symbols: new Map() }),
      owl2Store: { getAxioms: () => [], setAxioms: () => {} },
    },
  };
  const service = new ValidationService(mockConnection, mockDocManager, mockWorkspaceManager, {} as any);
  service.modelicaProofResultsByUri.set(
    uri,
    new Map([
      ["Safe", { definiteBugs: [], potentialBugs: [] }],
      ["Bad", { definiteBugs: [{ category: "division_by_zero" }], potentialBugs: [] }],
    ]),
  );

  service.emitVerificationStatus(uri);
  const ev = notifications.find((n) => n.method === "modelscript/verificationStatus");
  assert.ok(ev, "Must emit modelscript/verificationStatus notification");
  assert.strictEqual(ev.params.provenCount, 1);
  assert.strictEqual(ev.params.defectCount, 1);
  assert.strictEqual(ev.params.markers.length, 2);
  assert.strictEqual(ev.params.markers[0].line, 0);
  assert.strictEqual(ev.params.markers[0].status, "proven");
  assert.strictEqual(ev.params.markers[1].line, 2);
  assert.strictEqual(ev.params.markers[1].status, "defect");
});
