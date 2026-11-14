// SPDX-License-Identifier: AGPL-3.0-or-later

import { COORDINATOR_SCENARIOS, SemanticTheoryCoordinator } from "@modelscript/runtime";
import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerAnalysisEndpoints } from "../src/handlers/analysisEndpoints.js";

type MockRequestHandler = (...args: unknown[]) => unknown;
type MockAnalysisCtx = Parameters<typeof registerAnalysisEndpoints>[0];

function setupMockVerifyAll(docs: TextDocument[]) {
  const handlers = new Map<string, MockRequestHandler>();
  const mockConnection = {
    onRequest: (method: string, handler: MockRequestHandler) => {
      handlers.set(method, handler);
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const coordinator = new SemanticTheoryCoordinator();
  const mockContext = {
    connection: mockConnection,
    documents: {
      all: () => docs,
    },
    workspaceManager: {
      getDocument: (uri: string) => docs.find((d) => d.uri === uri),
      getQueryEngine: () => undefined,
      unifiedWorkspace: undefined,
      coordinator,
      getCoordinator: () => coordinator,
    },
    parserService: {
      sharedContext: undefined,
    },
  } as unknown as MockAnalysisCtx;

  registerAnalysisEndpoints(mockContext);
  const verifyAllHandler = handlers.get("modelscript/verifyAll");
  assert.ok(verifyAllHandler, "modelscript/verifyAll handler should be registered");
  return verifyAllHandler! as (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

test("LSP Analysis Endpoints: verifyAll populates polyglotDigitalThread for multi-file CAE workspace", async () => {
  const scenario = COORDINATOR_SCENARIOS[0]!;
  const docs = scenario.panes.map((p) =>
    TextDocument.create(`file:///workspace/${p.fileName}`, p.lang.toLowerCase(), 1, p.defaultCode),
  );
  const verifyAll = setupMockVerifyAll(docs);
  const report = await verifyAll({ uri: docs[docs.length - 1]!.uri });

  assert.ok(report.polyglotDigitalThread, "Expected report.polyglotDigitalThread to be populated");
  assert.strictEqual(report.polyglotDigitalThread.scenarioId, scenario.id);
  assert.strictEqual(report.polyglotDigitalThread.isSat, true);
  assert.ok(report.polyglotDigitalThread.portBindings.length > 0, "Expected non-empty portBindings");
  assert.ok(report.polyglotDigitalThread.variableLinks.length > 0, "Expected non-empty variableLinks");
});

test("LSP Analysis Endpoints: verifyAll supports generic 2-file SysML2 + SPICE workspace without CAE files", async () => {
  const sysmlDoc = TextDocument.create(
    "file:///workspace/PowerRegulator.sysml",
    "sysml",
    1,
    `package PowerRegulator {
  part def BuckStage {
    attribute v_bus = 12000 [mV];
    attribute r_load = 10000 [Ohm];
  }
}`,
  );
  const spiceDoc = TextDocument.create(
    "file:///workspace/BuckConverter.sp",
    "spice",
    1,
    `* @twin: v_bus <-> PowerRegulator::BuckStage.v_bus
* @twin: R1 <-> PowerRegulator::BuckStage.r_load
* @unit: v_bus = V
.param v_bus=12
V1 in 0 12V
R1 in out 10k`,
  );

  const verifyAll = setupMockVerifyAll([sysmlDoc, spiceDoc]);
  const report = await verifyAll({ uri: spiceDoc.uri });

  assert.ok(report.polyglotDigitalThread, "Expected generic polyglotDigitalThread on 2-file SysML+SPICE workspace");
  assert.strictEqual(report.polyglotDigitalThread.mode, "generic");
  assert.strictEqual(report.polyglotDigitalThread.fileCount, 2);
  assert.strictEqual(report.polyglotDigitalThread.isSat, true);
  assert.strictEqual(report.polyglotDigitalThread.variableLinks.length, 2);
});

test("LSP Analysis Endpoints: verifyAll detects UNSAT drift and ontology disjointness in 3-file generic workspace", async () => {
  const sysmlDoc = TextDocument.create(
    "file:///workspace/DriveUnit.sysml",
    "sysml",
    1,
    `package DriveUnit {
  part def Motor {
    attribute peak_torque = 50.0 [N*m];
  }
}`,
  );
  const moDoc = TextDocument.create(
    "file:///workspace/MotorPlant.mo",
    "modelica",
    1,
    `model MotorPlant
  parameter Real peak_torque(unit="N*m") = 32.0 annotation(twin = "SysML2::DriveUnit::Motor.peak_torque");
end MotorPlant;`,
  );
  const owlDoc = TextDocument.create(
    "file:///workspace/SafetyRules.owl",
    "owl2",
    1,
    `Ontology(<http://modelscript.org/safety>
  Declaration(Class(Actuator))
  Declaration(Class(PassiveStructure))
  DisjointClasses(Actuator PassiveStructure)
)`,
  );

  const verifyAll = setupMockVerifyAll([sysmlDoc, moDoc, owlDoc]);
  const report = await verifyAll({ uri: moDoc.uri });

  assert.ok(report.polyglotDigitalThread);
  assert.strictEqual(report.polyglotDigitalThread.mode, "generic");
  assert.strictEqual(report.polyglotDigitalThread.fileCount, 3);
  assert.strictEqual(report.polyglotDigitalThread.isSat, false);
  assert.ok(report.polyglotDigitalThread.conflicts.length > 0, "Expected twin drift conflict");
  assert.ok(report.stages?.polyglot_digital_thread, "Expected first-class stages.polyglot_digital_thread");
  assert.strictEqual(report.stages.polyglot_digital_thread.passed, false);
  assert.strictEqual(report.summary.overallPassed, false);
});

test("LSP Analysis Endpoints: verifyAll discovers unopened disk siblings, emits sendDiagnostics, and populates SARIF", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-lsp-polyglot-"));
  try {
    const sysmlPath = path.join(tmpDir, "Specs.sysml");
    const moPath = path.join(tmpDir, "Plant.mo");
    fs.writeFileSync(
      sysmlPath,
      `package Specs {
  part def Valve {
    attribute max_pressure = 200 [bar];
  }
}`,
      "utf-8",
    );
    const moContent = `model Plant
  parameter Real max_pressure(unit="bar") = 350.0 annotation(twin = "SysML2::Specs::Valve.max_pressure");
end Plant;`;
    fs.writeFileSync(moPath, moContent, "utf-8");

    // Only open Plant.mo in the editor; Specs.sysml is unopened on disk!
    const moUri = pathToFileURL(moPath).href;
    const moDoc = TextDocument.create(moUri, "modelica", 1, moContent);

    const emittedDiagnostics: Array<{ uri: string; diagnostics: unknown[] }> = [];
    const handlers = new Map<string, MockRequestHandler>();
    const coordinator = new SemanticTheoryCoordinator();
    const mockContext = {
      connection: {
        onRequest: (method: string, handler: MockRequestHandler) => handlers.set(method, handler),
        sendDiagnostics: (payload: { uri: string; diagnostics: unknown[] }) => emittedDiagnostics.push(payload),
        console: { info: () => {}, warn: () => {}, error: () => {} },
      },
      documents: { all: () => [moDoc] },
      workspaceManager: {
        getDocument: (uri: string) => (uri === moUri ? moDoc : undefined),
        getQueryEngine: () => undefined,
        unifiedWorkspace: undefined,
        coordinator,
        getCoordinator: () => coordinator,
      },
      parserService: { sharedContext: undefined },
    } as unknown as MockAnalysisCtx;
    registerAnalysisEndpoints(mockContext);
    const verifyAll = handlers.get("modelscript/verifyAll")! as (params: Record<string, unknown>) => Promise<{
      polyglotDigitalThread?: { fileCount: number; isSat: boolean };
      artifacts?: { formattedOutput?: string };
    }>;
    const res = await verifyAll({ uri: moUri, format: "sarif" });

    assert.ok(res?.polyglotDigitalThread, "Expected polyglotDigitalThread from unopened disk sibling");
    assert.strictEqual(res.polyglotDigitalThread.fileCount, 2);
    assert.strictEqual(res.polyglotDigitalThread.isSat, false);
    const sarifText = res.artifacts?.formattedOutput ?? "";
    assert.ok(
      sarifText.includes("POLYGLOT_TWIN_DRIFT") || sarifText.includes("Digital thread value divergence"),
      "Expected SARIF output to include digital thread conflict",
    );
    assert.ok(
      emittedDiagnostics.some((d) => d.diagnostics.length > 0),
      "Expected connection.sendDiagnostics to emit squiggles",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LSP Analysis Endpoints: verifyAll discovers cross-folder UnifiedWorkspace entries, merges diagnostics without clobbering, and returns suggestedEdits", async () => {
  const { ValidationService } = await import("../src/services/validation-service.js");

  const sysmlUri = "file:///repo/requirements/Specs.sysml";
  const moUri = "file:///repo/plant/Pump.mo";
  const sysmlContent = `package Specs {
  part def Pump {
    attribute max_flow = 120 [L/s];
  }
}`;
  const moContent = `model Pump
  parameter Real max_flow(unit="L/s") = 85.0 annotation(twin = "SysML2::Specs::Pump.max_flow");
end Pump;`;

  // Only Pump.mo is open in editor; Specs.sysml lives in a completely different folder in UnifiedWorkspace!
  const moDoc = TextDocument.create(moUri, "modelica", 1, moContent);
  const sentDiagnostics = new Map<string, unknown[]>();
  const handlers = new Map<string, MockRequestHandler>();

  const mockConnection = {
    onRequest: (method: string, handler: MockRequestHandler) => handlers.set(method, handler),
    sendDiagnostics: (payload: { uri: string; diagnostics: unknown[] }) => {
      sentDiagnostics.set(payload.uri, payload.diagnostics);
    },
    sendNotification: () => {},
    console: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ConstructorParameters<typeof ValidationService>[0];
  const mockDocumentManager = {
    documents: {
      all: () => [moDoc],
      get: (uri: string) => (uri === moUri ? moDoc : undefined),
    },
    cachedSyntaxDiagnostics: new Map(),
  } as unknown as ConstructorParameters<typeof ValidationService>[1];
  const coordinator = new SemanticTheoryCoordinator();
  const mockWorkspaceManager = {
    getDocument: (uri: string) => (uri === moUri ? moDoc : undefined),
    getQueryEngine: () => undefined,
    unifiedWorkspace: {
      getAllDocumentEntries: () => [
        { uri: sysmlUri, text: sysmlContent, language: "sysml2" },
        { uri: moUri, text: moContent, language: "modelica" },
      ],
    },
    coordinator,
    getCoordinator: () => coordinator,
  } as unknown as ConstructorParameters<typeof ValidationService>[2];
  const mockParserService = { sharedContext: undefined } as unknown as ConstructorParameters<
    typeof ValidationService
  >[3];

  const validationService = new ValidationService(
    mockConnection,
    mockDocumentManager,
    mockWorkspaceManager,
    mockParserService,
  );
  // Seed a pre-existing per-document semantic diagnostic that must NOT be clobbered
  validationService.lastSemanticDiagnostics.set(moUri, [
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      severity: 2,
      code: "M9999",
      source: "modelscript-semantic",
      message: "Pre-existing model warning",
    },
  ]);

  registerAnalysisEndpoints({
    connection: mockConnection,
    documents: (mockDocumentManager as unknown as { documents: unknown }).documents,
    workspaceManager: mockWorkspaceManager,
    parserService: mockParserService,
    validationService,
  } as unknown as MockAnalysisCtx);

  const verifyAll = handlers.get("modelscript/verifyAll")! as (params: Record<string, unknown>) => Promise<{
    polyglotDigitalThread?: { fileCount: number; isSat: boolean; suggestedEdits?: unknown[] };
  }>;
  const report = await verifyAll({ uri: moUri });

  assert.ok(report.polyglotDigitalThread, "Expected polyglotDigitalThread across folders");
  assert.strictEqual(report.polyglotDigitalThread.fileCount, 2);
  assert.strictEqual(report.polyglotDigitalThread.isSat, false);
  assert.ok(
    Array.isArray(report.polyglotDigitalThread.suggestedEdits) &&
      report.polyglotDigitalThread.suggestedEdits.length > 0,
    "Expected surgical suggestedEdits on twin drift",
  );

  // Verify mergeDigitalThreadDiagnostics kept the pre-existing warning AND added the digital thread conflict
  const mergedForMo = sentDiagnostics.get(moUri) ?? [];
  assert.ok(
    mergedForMo.some((d) => d.code === "M9999"),
    "Expected normal per-document diagnostic M9999 to be preserved",
  );
  assert.ok(
    mergedForMo.some((d) => d.code === "POLYGLOT_TWIN_DRIFT" && d.data?.suggestedEdits?.length > 0),
    "Expected merged POLYGLOT_TWIN_DRIFT diagnostic with data.suggestedEdits",
  );
});

test("LSP CodeAction Provider: POLYGLOT_TWIN_DRIFT offers multi-file WorkspaceEdit QuickFix", async () => {
  const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");
  const { CodeActionKind } = await import("vscode-languageserver/node.js");

  let onCodeActionHandler: ((params: any) => any) | undefined;
  const mockConnection: any = {
    onReferences: () => {},
    onRenameRequest: () => {},
    onCodeAction: (handler: (params: any) => any) => {
      onCodeActionHandler = handler;
    },
    onWorkspaceSymbol: () => {},
  };

  const targetUri = "file:///repo/plant/Pump.mo";
  const targetDoc = TextDocument.create(
    targetUri,
    "modelica",
    1,
    `model Pump\n  parameter Real max_flow = 85.0;\nend Pump;`,
  );

  const mockDocuments: any = {
    get: (uri: string) => (uri === targetUri ? targetDoc : undefined),
    all: () => [targetDoc],
  };

  registerWorkspaceFeaturesProvider(
    mockConnection,
    mockDocuments,
    new Map(),
    async () => {},
    async () => null,
  );
  assert.ok(onCodeActionHandler, "onCodeAction should be registered");

  const actions = onCodeActionHandler!({
    textDocument: { uri: targetUri },
    range: { start: { line: 1, character: 28 }, end: { line: 1, character: 32 } },
    context: {
      diagnostics: [
        {
          range: { start: { line: 1, character: 28 }, end: { line: 1, character: 32 } },
          severity: 1,
          code: "POLYGLOT_TWIN_DRIFT",
          source: "modelscript-digital-thread",
          message: "Digital thread value divergence for 'max_flow'",
          data: {
            suggestedEdits: [
              {
                fileIndex: 1,
                uri: targetUri,
                fileName: "Pump.mo",
                line: 2,
                startOffset: 37,
                endOffset: 41,
                newText: "120",
                description: "Sync Pump.mo max_flow to 120",
              },
            ],
          },
        },
      ],
    },
  });

  assert.ok(Array.isArray(actions), "Expected CodeAction array");
  const quickFix = actions.find(
    (a: any) => a.kind === CodeActionKind.QuickFix && a.title === "Sync Pump.mo max_flow to 120",
  );
  assert.ok(quickFix, "Expected Sync Pump.mo max_flow to 120 QuickFix CodeAction");
  assert.ok(quickFix.edit?.changes?.[targetUri]?.length === 1, "Expected multi-file WorkspaceEdit changes");
  assert.strictEqual(quickFix.edit.changes[targetUri][0].newText, "120");
  assert.deepStrictEqual(quickFix.edit.changes[targetUri][0].range, {
    start: { line: 1, character: 26 },
    end: { line: 1, character: 30 },
  });
});

test("LSP CodeAction & Live Validation: resolves unopened file:// sibling QuickFix and runs on-edit digital thread validation", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");
  const { ValidationService } = await import("../src/services/validation-service.js");
  const { CodeActionKind } = await import("vscode-languageserver/node.js");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-lsp-live-dt-"));
  try {
    const sysmlPath = path.join(tmpDir, "Specs.sysml");
    const moPath = path.join(tmpDir, "Pump.mo");
    const sysmlContent = `package Specs {\n  part def Pump {\n    attribute max_flow = 120 [L/s];\n  }\n}`;
    const moContent = `model Pump\n  parameter Real max_flow(unit="L/s") = 85.0 annotation(twin = "SysML2::Specs::Pump.max_flow");\nend Pump;`;
    fs.writeFileSync(sysmlPath, sysmlContent, "utf-8");
    fs.writeFileSync(moPath, moContent, "utf-8");

    const sysmlUri = pathToFileURL(sysmlPath).href;
    const moUri = pathToFileURL(moPath).href;
    const sysmlDoc = TextDocument.create(sysmlUri, "sysml", 1, sysmlContent);

    // 1. Test CodeAction when only Specs.sysml is open and Pump.mo is unopened on disk
    let onCodeActionHandler: ((params: any) => any) | undefined;
    const caConnection: any = {
      onReferences: () => {},
      onRenameRequest: () => {},
      onCodeAction: (h: any) => {
        onCodeActionHandler = h;
      },
      onWorkspaceSymbol: () => {},
    };
    registerWorkspaceFeaturesProvider(
      caConnection,
      { get: (u: string) => (u === sysmlUri ? sysmlDoc : undefined), all: () => [sysmlDoc] } as any,
      new Map(),
      async () => {},
      async () => null,
    );
    const valOffset = moContent.indexOf("85.0");
    const actions = onCodeActionHandler!({
      textDocument: { uri: sysmlUri },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      context: {
        diagnostics: [
          {
            range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
            severity: 1,
            code: "POLYGLOT_TWIN_DRIFT",
            source: "modelscript-digital-thread",
            message: "Drift on max_flow",
            data: {
              suggestedEdits: [
                {
                  fileIndex: 1,
                  uri: moUri,
                  fileName: "Pump.mo",
                  line: 2,
                  startOffset: valOffset,
                  endOffset: valOffset + 4,
                  newText: "120",
                  description: "Sync unopened Pump.mo max_flow to 120",
                },
              ],
            },
          },
        ],
      },
    });
    const unopenedFix = actions.find(
      (a: any) => a.kind === CodeActionKind.QuickFix && a.edit?.changes?.[moUri]?.length === 1,
    );
    assert.ok(unopenedFix, "Expected QuickFix WorkspaceEdit for unopened file:// sibling");

    // 2. Test live ValidationService.runLiveDigitalThreadValidation pushes squiggles automatically
    const sent = new Map<string, any[]>();
    const moDoc = TextDocument.create(moUri, "modelica", 1, moContent);
    const vs = new ValidationService(
      {
        sendDiagnostics: (p: { uri: string; diagnostics: any[] }) => sent.set(p.uri, p.diagnostics),
        sendNotification: () => {},
        console: { info: () => {}, warn: () => {}, error: () => {} },
      } as any,
      {
        documents: { all: () => [sysmlDoc, moDoc], get: (u: string) => (u === sysmlUri ? sysmlDoc : moDoc) },
        cachedSyntaxDiagnostics: new Map(),
      } as any,
      { getQueryEngine: () => undefined, unifiedWorkspace: undefined, hypergraph: undefined } as any,
      { sharedContext: undefined } as any,
    );
    await vs.runLiveDigitalThreadValidation(moUri);
    assert.ok(
      (sent.get(moUri) ?? []).some((d) => d.code === "POLYGLOT_TWIN_DRIFT"),
      "Expected runLiveDigitalThreadValidation to publish POLYGLOT_TWIN_DRIFT squiggle",
    );

    // 3. Test unopened disk-sibling fallback when only SysML doc is open
    const sentSib = new Map<string, any[]>();
    const vsSib = new ValidationService(
      {
        sendDiagnostics: (p: { uri: string; diagnostics: any[] }) => sentSib.set(p.uri, p.diagnostics),
        sendNotification: () => {},
        console: { info: () => {}, warn: () => {}, error: () => {} },
      } as any,
      {
        documents: { all: () => [sysmlDoc], get: (u: string) => (u === sysmlUri ? sysmlDoc : undefined) },
        cachedSyntaxDiagnostics: new Map(),
      } as any,
      { getQueryEngine: () => undefined, unifiedWorkspace: undefined, hypergraph: undefined } as any,
      { sharedContext: undefined } as any,
    );
    await vsSib.runLiveDigitalThreadValidation(sysmlUri);
    assert.ok(
      (sentSib.get(moUri) ?? []).some((d) => d.code === "POLYGLOT_TWIN_DRIFT"),
      "Expected runLiveDigitalThreadValidation to discover unopened Pump.mo sibling on disk",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
