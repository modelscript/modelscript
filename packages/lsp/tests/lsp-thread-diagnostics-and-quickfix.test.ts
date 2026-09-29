// SPDX-License-Identifier: AGPL-3.0-or-later

import { ThreadDomain } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerWorkspaceFeaturesProvider } from "../src/providers/workspaceFeaturesProvider.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
});

describe("LSP Live Digital Thread Diagnostics & QuickFix Actions", () => {
  it("should have canonical hypergraph and default threads in WorkspaceManager", () => {
    const wm = new WorkspaceManager();
    expect(wm.hypergraph).toBeDefined();
    expect(wm.hypergraph.getThreadCount()).toBeGreaterThan(0);

    const threads = wm.getThreadsForUri("file:///workspace/modelica/InverterDrive.mo");
    expect(threads).toHaveLength(1);
    expect(threads[0]!.slot).toBeDefined();
    expect(threads[0]!.domain).toBe("modelica");
    expect(threads[0]!.meta.name).toBe("model InverterDrive");
  });

  it("should generate cross-domain divergence diagnostics when parameters differ", () => {
    const wm = new WorkspaceManager();

    // Create a mock document manager
    const mockDocManager: any = {
      documents: new Map(),
      documentTrees: new Map(),
    };

    const mockConnection: any = {
      console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
      sendDiagnostics: () => {},
      sendNotification: () => {},
    };

    const mockParserService: any = {
      getSharedCstTreeWrapper: () => null,
      facade: null,
      sharedContext: null,
    };

    const vs = new ValidationService(mockConnection, mockDocManager, wm, mockParserService);

    // Bind thread 201 with parameter divergence: SysML mass=2.5 kg vs Modelica mass=1.8 kg
    const slot = wm.bindThreadSlot(201, ThreadDomain.SysML2, 2021, {
      name: "part def MotorChassis",
      uri: "file:///workspace/sysml/Motor.sysml",
      line: 10,
      column: 3,
      domain: "sysml2",
      properties: { mass: 2.5 },
    });

    wm.bindThreadSlot(201, ThreadDomain.Modelica, 3021, {
      name: "model Motor",
      uri: "file:///workspace/modelica/Motor.mo",
      line: 5,
      column: 3,
      domain: "modelica",
      properties: { mass: 1.8 },
    });

    const moDoc = TextDocument.create(
      "file:///workspace/modelica/Motor.mo",
      "modelica",
      1,
      "model Motor\n  parameter Real mass = 1.8;\nend Motor;\n",
    );

    const diags = vs.collectThreadDiagnostics("file:///workspace/modelica/Motor.mo", moDoc);
    expect(diags).toHaveLength(1);

    const diag = diags[0]!;
    expect(diag.source).toBe("modelscript-digital-thread");
    expect(diag.severity).toBe(DiagnosticSeverity.Error);
    expect(diag.code).toBe("THREAD_CONFLICT");
    expect(diag.message).toContain("Parameter 'mass' divergence");
    expect(diag.message).toContain("Modelica (1.8 kg)");
    expect(diag.message).toContain("SysML v2 source (2.5 kg)");
    expect(diag.data.simplexConsensus).toBe(2.15);
    expect(diag.data.sourceValue).toBe(2.5);
    expect(diag.data.targetValue).toBe(1.8);
    expect(diag.data.unit).toBe("kg");
  });

  it("should generate SMT Physics-Simplex QuickFix code actions", () => {
    const wm = new WorkspaceManager();

    const moDoc = TextDocument.create(
      "file:///workspace/modelica/Motor.mo",
      "modelica",
      1,
      "model Motor\n  parameter Real mass = 1.8;\nend Motor;\n",
    );

    const mockDocsMap = new Map<string, TextDocument>();
    mockDocsMap.set(moDoc.uri, moDoc);

    const mockDocuments: any = {
      get: (uri: string) => mockDocsMap.get(uri),
      all: () => Array.from(mockDocsMap.values()),
    };

    let codeActionHandler: any = null;
    const mockConnection: any = {
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
      onDocumentSymbol: () => {},
      onWorkspaceSymbol: () => {},
      onReferences: () => {},
      onRenameRequest: () => {},
      onPrepareRename: () => {},
      onRequest: () => {},
    };

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocuments,
      new Map(),
      async () => {},
      async () => ({ symbols: new Map(), byName: new Map() }),
    );

    expect(codeActionHandler).toBeDefined();

    // Construct diagnostic as emitted by collectThreadDiagnostics
    const mockDiag: any = {
      range: {
        start: { line: 1, character: 17 },
        end: { line: 1, character: 21 },
      },
      severity: DiagnosticSeverity.Error,
      code: "THREAD_CONFLICT",
      source: "modelscript-digital-thread",
      message:
        "[Digital Thread Conflict] Parameter 'mass' divergence: Modelica (1.8 kg) conflicts with SysML v2 source (2.5 kg). SMT physics-simplex consensus: 2.15 kg.",
      data: {
        threadId: 201,
        slot: 1,
        elementName: "mass",
        sourceDomain: "sysml2",
        sourceValue: 2.5,
        targetDomain: "modelica",
        targetValue: 1.8,
        simplexConsensus: 2.15,
        unit: "kg",
      },
    };

    const actions = codeActionHandler({
      textDocument: { uri: moDoc.uri },
      range: mockDiag.range,
      context: { diagnostics: [mockDiag] },
    });

    expect(actions).toBeDefined();
    expect(actions.length).toBeGreaterThan(1);

    // 1. Check Physics-Simplex QuickFix
    const simplexAction = actions.find((a: any) => a.title.includes("SMT Physics-Simplex"));
    expect(simplexAction).toBeDefined();
    expect(simplexAction.kind).toBe(CodeActionKind.QuickFix);
    expect(simplexAction.isPreferred).toBe(true);
    expect(simplexAction.title).toContain("2.15 kg");

    const edits = simplexAction.edit.changes[moDoc.uri];
    expect(edits).toBeDefined();
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe("2.15");

    // 2. Check Source Value Override QuickFix
    const sourceAction = actions.find((a: any) => a.title.includes("Accept 'mass' from SYSML2 source"));
    expect(sourceAction).toBeDefined();
    expect(sourceAction.kind).toBe(CodeActionKind.QuickFix);
    expect(sourceAction.title).toContain("2.5 kg");
    expect(sourceAction.edit.changes[moDoc.uri][0].newText).toBe("2.5");

    // 3. Check Open in Explorer Command
    const explorerAction = actions.find((a: any) => a.title.includes("Open Thread #201"));
    expect(explorerAction).toBeDefined();
    expect(explorerAction.command.command).toBe("modelscript.openDigitalThread");
  });

  it("should clear conflict and stale diagnostics after reconciliation", () => {
    const wm = new WorkspaceManager();
    const mockDocManager: any = { documents: new Map(), documentTrees: new Map() };
    const mockConnection: any = {
      console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
      sendDiagnostics: () => {},
      sendNotification: () => {},
    };
    const vs = new ValidationService(mockConnection, mockDocManager, wm, {} as any);

    const slot = wm.bindThreadSlot(301, ThreadDomain.SysML2, 4001, {
      name: "part def Battery",
      uri: "file:///workspace/sysml/Battery.sysml",
      line: 5,
      column: 1,
      domain: "sysml2",
      properties: { voltage: 48.0 },
    });
    wm.bindThreadSlot(301, ThreadDomain.Modelica, 4002, {
      name: "model BatteryPack",
      uri: "file:///workspace/modelica/BatteryPack.mo",
      line: 8,
      column: 1,
      domain: "modelica",
      properties: { voltage: 24.0 },
    });

    // Mark slot conflicted
    wm.hypergraph.markConflict(slot);
    expect(wm.hypergraph.isConflicted(slot)).toBe(true);

    const moDoc = TextDocument.create(
      "file:///workspace/modelica/BatteryPack.mo",
      "modelica",
      1,
      "model BatteryPack\n  parameter Real voltage = 24.0;\nend BatteryPack;\n",
    );

    let diags = vs.collectThreadDiagnostics(moDoc.uri, moDoc);
    expect(diags.length).toBeGreaterThan(0);

    // Reconcile slot via Theory Sat / Simplex
    wm.hypergraph.recordTheorySat(slot);
    expect(wm.hypergraph.isConflicted(slot)).toBe(false);
    expect(wm.hypergraph.isStale(slot)).toBe(false);

    // Update properties to consensus
    const elements = wm.findAlignedElementsBySlot(slot);
    for (const el of elements) {
      if (el.properties) el.properties.voltage = 36.0;
    }

    // Now re-run diagnostics: should be completely clean!
    diags = vs.collectThreadDiagnostics(moDoc.uri, moDoc);
    expect(diags).toHaveLength(0);
  });
});
