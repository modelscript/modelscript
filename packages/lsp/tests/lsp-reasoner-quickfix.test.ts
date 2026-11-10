// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BFO,
  getBfoIofCoreAxioms,
  IOF,
  LanguageWorkspaceIndex,
  SemanticAxiomProjector,
  UnifiedWorkspace,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { CodeActionKind } from "vscode-languageserver";
import { ValidationService } from "../src/services/validation-service.js";

describe("LSP Reasoner Integration: Diagnostics, Explanations & QuickFixes", () => {
  it("should project SymbolIndex to BFO/IOF axioms and detect BFO disjointness contradictions", () => {
    // 1. Verify BFO vocabulary axioms
    const bfoAxioms = getBfoIofCoreAxioms();
    assert(bfoAxioms.length > 20, "Should provide baseline BFO/IOF axioms");

    const hasContinuantOccurrentDisjoint = bfoAxioms.some(
      (a) =>
        a.type === "DisjointClasses" &&
        a.classIris.includes(BFO.Continuant) &&
        a.classIris.includes(BFO.Occurrent),
    );
    assert(hasContinuantOccurrentDisjoint, "BFO baseline must include Continuant vs Occurrent disjointness");

    // 2. Mock a Polyglot SymbolIndex (e.g. SPICE / Robotics)
    const mockIndex: any = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "M1",
            kind: "Component",
            ruleName: "subcircuit_definition",
            startOffset: 0,
            endOffset: 20,
            parentId: null,
            exports: [],
            inherits: [IOF.Component],
            metadata: { value: 24, variability: "parameter" },
          },
        ],
        [
          2,
          {
            id: 2,
            name: "CoolingAction",
            kind: "Action",
            ruleName: "action_definition",
            startOffset: 25,
            endOffset: 50,
            parentId: null,
            exports: [],
            inherits: [],
            metadata: { defKind: "action" },
          },
        ],
      ]),
    };

    const projected = SemanticAxiomProjector.projectSymbolIndex(mockIndex, {
      sourceLang: "spice",
      sourceUri: "file:///workspace/circuit.cir",
      basePrefix: "spice:",
    });

    assert(projected.length >= 4, "Should emit BFO/IOF declarations and subclass axioms");

    const m1Axiom = projected.find((a) => a.type === "SubClassOf" && (a as any).subClassIri === "spice:M1");
    assert.strictEqual((m1Axiom as any)?.superClassIri, IOF.Component);

    const actionAxiom = projected.find(
      (a) => a.type === "SubClassOf" && (a as any).subClassIri === "spice:CoolingAction",
    );
    assert.strictEqual((actionAxiom as any)?.superClassIri, BFO.Process);
  });

  it("should route rich diagnostics with error code, explanations, and relatedInformation", async () => {
    const docUri = "memfs:circuits/inverter.cir";
    const docText = "M1 VCC GND 24V\n";

    const sentDiagnostics: { uri: string; diagnostics: any[] }[] = [];

    const mockConnection: any = {
      console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {} },
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiagnostics.push(params);
      },
      sendNotification: () => {},
    };

    const mockDocManager: any = {
      documents: new Map([
        [
          docUri,
          {
            uri: docUri,
            languageId: "spice",
            version: 1,
            getText: () => docText,
            positionAt: (offset: number) => ({ line: 0, character: offset }),
          },
        ],
      ]),
      documentTrees: new Map(),
    };

    const mockWorkspaceManager: any = {
      unifiedWorkspace: new UnifiedWorkspace(),
      getWorkspaceIndex: () => new LanguageWorkspaceIndex("spice"),
    };

    const validationService = new ValidationService(
      mockConnection,
      mockDocManager,
      mockWorkspaceManager,
      { getParser: () => null, isParserReady: () => false, getSharedCstTreeWrapper: () => null } as any,
    );

    // Mock an inconsistency from the Tableau reasoner with a Minimal Conflict Core
    const consistency = {
      isConsistent: false,
      explanation: "Rated voltage 24V exceeded by supply bus 48V (BFO Quality constraint)",
      minimalConflictCore: [
        {
          type: "SubClassOf",
          subClassIri: "spice:M1",
          superClassIri: "iof:Component",
        },
      ],
      minimalCorrectionSubsets: [
        [
          {
            type: "SubClassOf",
            subClassIri: "spice:M1",
            superClassIri: "iof:Component",
          },
        ],
      ],
    };

    const diagnostics: any[] = [];
    (validationService as any).routeReasonerDiagnostics(docUri, consistency, diagnostics, "spice-reasoner");

    // Diagnostic must have been emitted
    assert(diagnostics.length > 0 || sentDiagnostics.length > 0, "Should emit reasoner diagnostic");
    const diag = diagnostics[0] || sentDiagnostics[0]?.diagnostics[0];

    assert(diag, "Diagnostic should be present");
    assert.strictEqual(diag.severity, 1, "Severity should be Error (1)");
    assert(diag.code === "M4101" || diag.code === "M4102", `Code should be M4101 or M4102, got ${diag.code}`);
    assert(diag.data, "Diagnostic must carry explanation data for QuickFixes");
    assert.strictEqual(diag.data.code, diag.code);
  });

  it("should generate QuickFix code actions to relax conflicting parameters or comment assertions", async () => {
    const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");

    const docUri = "memfs:circuits/stage.cir";
    const docText = "parameter Real V_rated = 24;\n";

    let codeActionHandler: any = null;
    const mockConnection: any = {
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
      onRenameRequest: () => {},
      onPrepareRename: () => {},
      onReferences: () => {},
      onWorkspaceSymbol: () => {},
    };

    const mockDocs = new Map([
      [
        docUri,
        {
          getText: () => docText,
          offsetAt: (pos: any) => (pos.line === 0 ? pos.character : docText.length),
          positionAt: (offset: number) => ({ line: 0, character: offset }),
        },
      ],
    ]);

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocs as any,
      new Map(),
      () => {},
      () => null,
      () => null,
    );

    assert(codeActionHandler, "onCodeAction handler should be registered");

    const mockDiag: any = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 28 } },
      severity: 1,
      code: "M4101",
      source: "spice-reasoner",
      message: "Logical contradiction: Rated voltage 24 exceeds bus supply 48",
      data: {
        code: "M4101",
        suggestedValue: 48,
      },
    };

    const actions = codeActionHandler({
      textDocument: { uri: docUri },
      range: mockDiag.range,
      context: { diagnostics: [mockDiag] },
    });

    assert(actions.length >= 2, "Should return at least two QuickFix options");
    const relaxFix = actions.find((a: any) => a.title.includes("Relax boundary parameter"));
    assert(relaxFix, "Should offer boundary relaxation QuickFix");
    assert.strictEqual(relaxFix.kind, CodeActionKind.QuickFix);
    assert.strictEqual(relaxFix.isPreferred, true);

    const edits = relaxFix.edit.changes[docUri];
    assert(edits && edits.length === 1, "QuickFix should produce exactly one text edit");
    assert.strictEqual(edits[0].newText, "48", "QuickFix should replace with suggested value 48");

    const commentFix = actions.find((a: any) => a.title.includes("Comment out"));
    assert(commentFix, "Should offer comment-out QuickFix");
    assert.strictEqual(commentFix.kind, CodeActionKind.QuickFix);
  });

  it("should detect domain-specific physics violations in SPICE, URDF, SBML, and CAD", () => {
    // 1. SPICE Overvoltage SOA Violation
    const spiceIndex: any = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "MOS_Q1",
            kind: "Component",
            ruleName: "mosfet_definition",
            startOffset: 0,
            endOffset: 20,
            parentId: null,
            exports: [],
            inherits: [],
            metadata: { vmax: 20, voltage: 30 },
          },
        ],
      ]),
    };
    const spiceAxioms = SemanticAxiomProjector.projectSymbolIndex(spiceIndex, { sourceLang: "spice" });
    const hasDisjoint = spiceAxioms.some((a) => a.type === "DisjointClasses");
    assert(hasDisjoint, "Should flag overvoltage breakdown as disjoint constraint");

    // 2. URDF Inverted Joint Limits
    const urdfIndex: any = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "elbow_joint",
            kind: "Port",
            ruleName: "joint_definition",
            startOffset: 0,
            endOffset: 20,
            parentId: null,
            exports: [],
            inherits: [],
            metadata: { lower: 3.14, upper: -1.57 }, // lower > upper
          },
        ],
      ]),
    };
    const urdfAxioms = SemanticAxiomProjector.projectSymbolIndex(urdfIndex, { sourceLang: "urdf" });
    assert(urdfAxioms.some((a) => a.type === "DisjointClasses"), "Should flag inverted joint limits as disjointness");

    // 3. SBML Reaction Empty Reactants
    const sbmlIndex: any = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "R1",
            kind: "Action",
            ruleName: "reaction_definition",
            startOffset: 0,
            endOffset: 20,
            parentId: null,
            exports: [],
            inherits: [],
            metadata: { reactantsCount: 0, productsCount: 2, isBoundary: false },
          },
        ],
      ]),
    };
    const sbmlAxioms = SemanticAxiomProjector.projectSymbolIndex(sbmlIndex, { sourceLang: "sbml" });
    assert(sbmlAxioms.some((a) => a.type === "DisjointClasses"), "Should flag mass creation without reactants as disjointness");

    // 4. CAD Degenerate Bounding Box
    const cadIndex: any = {
      symbols: new Map([
        [
          1,
          {
            id: 1,
            name: "bracket_solid",
            kind: "Component",
            ruleName: "solid_definition",
            startOffset: 0,
            endOffset: 20,
            parentId: null,
            exports: [],
            inherits: [],
            metadata: { dx: 10, dy: 0, dz: 5 }, // zero depth
          },
        ],
      ]),
    };
    const cadAxioms = SemanticAxiomProjector.projectSymbolIndex(cadIndex, { sourceLang: "step" });
    assert(cadAxioms.some((a) => a.type === "DisjointClasses"), "Should flag degenerate solid geometry as disjointness");
  });

  it("should offer M5102 contract refinement and M5103 reachability boundary QuickFixes", async () => {
    const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");

    const docUri = "memfs:contracts/power_stage.sysml";
    const docText = "attribute peak_current : Real = 85.0;\n";

    let codeActionHandler: any = null;
    const mockConnection: any = {
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
      onRenameRequest: () => {},
      onPrepareRename: () => {},
      onReferences: () => {},
      onWorkspaceSymbol: () => {},
    };

    const mockDocs = new Map([
      [
        docUri,
        {
          getText: () => docText,
          offsetAt: (pos: any) => (pos.line === 0 ? pos.character : docText.length),
          positionAt: (offset: number) => ({ line: 0, character: offset }),
        },
      ],
    ]);

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocs as any,
      new Map(),
      () => {},
      () => null,
      () => null,
    );

    const contractDiag: any = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 35 } },
      severity: 1,
      code: "M5102",
      source: "contract-verifier",
      message: "Contract refinement failure: peak_current (85.0) exceeds parent requirement (60.0)",
      data: {
        code: "M5102",
        requiredLimit: 60.0,
      },
    };

    const actions = codeActionHandler({
      textDocument: { uri: docUri },
      range: contractDiag.range,
      context: { diagnostics: [contractDiag] },
    });

    const contractFix = actions.find((a: any) => a.title.includes("Adjust contract to satisfy parent requirement"));
    assert(contractFix, "Should offer contract refinement QuickFix");
    assert.strictEqual(contractFix.edit.changes[docUri][0].newText, "60");

    const reachDiag: any = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 35 } },
      severity: 1,
      code: "M5103",
      source: "modelscript-dae-verifier",
      message: "Reachability flowpipe boundary exceeded: proven max is 95.5",
      data: {
        code: "M5103",
        provenBound: 95.5,
      },
    };

    const reachActions = codeActionHandler({
      textDocument: { uri: docUri },
      range: reachDiag.range,
      context: { diagnostics: [reachDiag] },
    });

    const flowpipeFix = reachActions.find((a: any) => a.title.includes("Enclose reachability flowpipe boundary"));
    assert(flowpipeFix, "Should offer reachability boundary QuickFix");
    assert.strictEqual(flowpipeFix.edit.changes[docUri][0].newText, "95.5");
  });

  it("should offer M5101 division by zero safety guard QuickFix", async () => {
    const docUri = "memfs:algorithms/divide.mo";
    const docText = "Real y = 100.0 / denom;\n";

    let codeActionHandler: any = null;
    const mockConnection: any = {
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
      onWorkspaceSymbol: () => {},
      onReferences: () => {},
      onDocumentHighlight: () => {},
      onPrepareRename: () => {},
      onRenameRequest: () => {},
      onSignatureHelp: () => {},
    };

    const mockDocs: any = new Map([
      [
        docUri,
        {
          uri: docUri,
          getText: () => docText,
          offsetAt: (pos: any) => (pos.line === 0 ? pos.character : docText.length),
          positionAt: (offset: number) => ({ line: 0, character: offset }),
        },
      ],
    ]);

    const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");
    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocs as any,
      new Map(),
      () => {},
      () => null,
      () => null,
    );

    const divDiag: any = {
      range: { start: { line: 0, character: 9 }, end: { line: 0, character: 22 } },
      severity: 1,
      code: "M5101",
      source: "modelscript-prover",
      message: "Potential division by zero: denominator interval [-0.5, 0.5] contains 0",
      data: {
        code: "M5101",
        kind: "div_by_zero",
      },
    };

    const actions = codeActionHandler({
      textDocument: { uri: docUri },
      range: divDiag.range,
      context: { diagnostics: [divDiag] },
    });

    const guardFix = actions.find((a: any) => a.title.includes("Guard against division by zero"));
    assert(guardFix, "Should offer division guard QuickFix");
    assert.strictEqual(guardFix.edit.changes[docUri][0].newText, "max(1e-6, denom)");
  });

  it("should display BFO/IOF classification and DAE reachability invariants in hover", async () => {
    const docUri = "memfs:circuits/stage.cir";
    const docText = "R1 VCC v_out 100\n";

    let hoverHandler: any = null;
    const mockConnection: any = {
      onHover: (handler: any) => {
        hoverHandler = handler;
      },
    };

    const mockDoc = {
      uri: docUri,
      languageId: "spice",
      getText: () => docText,
      positionAt: (offset: number) => ({ line: 0, character: offset }),
      offsetAt: (pos: any) => pos.character,
    };

    const mockDocs: any = {
      get: (uri: string) => (uri === docUri ? mockDoc : undefined),
    };

    const taxonomyMap = new Map([
      [
        "spice:R1",
        {
          superClasses: new Set(["iof:MaterialArtifact", "bfo:MaterialEntity", "spice:Resistor"]),
          subClasses: new Set([]),
        },
      ],
    ]);

    const mockValidationService: any = {
      documentLSPBridges: new Map(),
      reasonerService: {
        reasoner: {
          getTaxonomy: () => taxonomyMap,
        },
      },
      daeVerificationResultsByUri: new Map([
        [
          docUri,
          new Map([
            [
              "PowerStage",
              {
                variableBounds: new Map([
                  ["v_out", { toString: () => "[0.0 .. 24.0]", isTop: () => false, isBottom: () => false }],
                ]),
              },
            ],
          ]),
        ],
      ]),
    };

    const { registerHoverProvider } = await import("../src/providers/hoverProvider.js");
    registerHoverProvider(mockConnection, mockDocs, mockValidationService);

    // 1. Hover on R1 -> BFO/IOF classification & inferred types
    const r1Hover = await hoverHandler({
      textDocument: { uri: docUri },
      position: { line: 0, character: 1 }, // hovering "R1"
    });

    assert(r1Hover, "Hover on R1 should return hover information");
    const r1Text = r1Hover.contents.value;
    assert(r1Text.includes("Ontological Category (BFO/IOF):"), "Should show BFO/IOF category");
    assert(r1Text.includes("iof:MaterialArtifact"), "Should show iof:MaterialArtifact");
    assert(r1Text.includes("Inferred Types (Reasoner):"), "Should show Inferred Types");
    assert(r1Text.includes("Resistor"), "Should show Resistor inferred type");

    // 2. Hover on v_out -> DAE reachability invariant
    const voutHover = await hoverHandler({
      textDocument: { uri: docUri },
      position: { line: 0, character: 8 }, // hovering "v_out"
    });

    assert(voutHover, "Hover on v_out should return hover information");
    const voutText = voutHover.contents.value;
    assert(voutText.includes("DAE Reachability Invariant:"), "Should show DAE reachability invariant");
    assert(voutText.includes("v_out \u2208 [0.0 .. 24.0]"), "Should show sound interval enclosure");
  });

  it("should flag cross-language parameter drift (M5104) and generate synchronization QuickFix", async () => {
    const { registerWorkspaceFeaturesProvider } = await import("../src/providers/workspaceFeaturesProvider.js");

    const spiceUri = "memfs:circuits/filter.cir";
    const spiceText = "R1 in out 100\n";

    let codeActionHandler: any = null;
    const mockConnection: any = {
      onCodeAction: (handler: any) => {
        codeActionHandler = handler;
      },
      onRenameRequest: () => {},
      onPrepareRename: () => {},
      onReferences: () => {},
      onWorkspaceSymbol: () => {},
    };

    const moUri = "memfs:models/LowPassFilter.mo";
    const moText = "parameter Real R = 50;\nparameter Real C = 1e-6;\n";
    const spiceText2 = "R1 in out 100\nC1 out 0 2e-6\n";

    const mockDocs = new Map([
      [
        spiceUri,
        {
          getText: () => spiceText2,
          offsetAt: (pos: any) => (pos.line === 0 ? pos.character : spiceText.length + pos.character),
          positionAt: (offset: number) => {
            if (offset < spiceText.length) return { line: 0, character: offset };
            return { line: 1, character: offset - spiceText.length };
          },
        },
      ],
      [
        moUri,
        {
          getText: () => moText,
          offsetAt: (pos: any) => (pos.line === 0 ? pos.character : 24 + pos.character),
          positionAt: (offset: number) => {
            if (offset < 24) return { line: 0, character: offset };
            return { line: 1, character: offset - 24 };
          },
        },
      ],
    ]);

    registerWorkspaceFeaturesProvider(
      mockConnection,
      mockDocs as any,
      new Map(),
      () => {},
      () => null,
      () => null,
    );

    const driftDiagR: any = {
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 13 } },
      severity: 1,
      code: "M5104",
      source: "modelscript-drift-checker",
      message: "Cross-language parameter drift: 'R' in SPICE (100) diverges from MODELICA (50) by 66.7%",
      data: {
        code: "M5104",
        component: "LowPassFilter",
        param: "R",
        currentValue: 100,
        suggestedValue: 50,
        sourceLang: "spice",
        counterpartLang: "modelica",
        counterpartUri: moUri,
        counterpartRange: { start: { line: 0, character: 19 }, end: { line: 0, character: 21 } },
      },
    };

    const driftDiagC: any = {
      range: { start: { line: 1, character: 9 }, end: { line: 1, character: 13 } },
      severity: 1,
      code: "M5104",
      source: "modelscript-drift-checker",
      message: "Cross-language parameter drift: 'C' in SPICE (2e-6) diverges from MODELICA (1e-6) by 66.7%",
      data: {
        code: "M5104",
        component: "LowPassFilter",
        param: "C",
        currentValue: 2e-6,
        suggestedValue: 1e-6,
        sourceLang: "spice",
        counterpartLang: "modelica",
        counterpartUri: moUri,
        counterpartRange: { start: { line: 1, character: 19 }, end: { line: 1, character: 23 } },
      },
    };

    const actions = codeActionHandler({
      textDocument: { uri: spiceUri },
      range: driftDiagR.range,
      context: { diagnostics: [driftDiagR, driftDiagC] },
    });

    // 1. Local synchronization QuickFix
    assert(actions.length >= 2, "Should offer both local sync and counterpart propagation");
    const syncFix = actions.find((a: any) => a.title.includes("Synchronize 'R' to 50"));
    assert(syncFix, "Should find QuickFix to synchronize 'R' to 50 matching Modelica");
    assert.strictEqual(syncFix.kind, CodeActionKind.QuickFix);
    assert.strictEqual(syncFix.isPreferred, true);
    const edit = syncFix.edit.changes[spiceUri][0];
    assert.strictEqual(edit.newText, "50", "Should replace 100 with 50");

    // 2. Reverse counterpart propagation QuickFix
    const propFix = actions.find((a: any) => a.title.includes("Propagate local 'R' (100) to MODELICA"));
    assert(propFix, "Should find QuickFix to propagate local value 100 into Modelica counterpart");
    assert.strictEqual(propFix.kind, CodeActionKind.QuickFix);
    const propEdit = propFix.edit.changes[moUri][0];
    assert.strictEqual(propEdit.newText, "100", "Should update Modelica file with 100");

    // 3. Batch reconciliation QuickFix (all drifted parameters in file)
    const batchFix = actions.find((a: any) => a.title.includes("Synchronize all drifted parameters"));
    assert(batchFix, "Should offer batch synchronization QuickFix for multiple drifted parameters");
    assert.strictEqual(batchFix.kind, CodeActionKind.SourceFixAll);
    const batchEdits = batchFix.edit.changes[spiceUri];
    assert.strictEqual(batchEdits.length, 2, "Batch fix should synchronize both R and C");
  });

  it("should stream work done progress and handle cooperative client cancellation", async () => {
    const { LspWorkDoneProgressReporter } = await import("../src/utils/progress-reporter.js");

    const requests: { method: string; params: any }[] = [];
    const notifications: { method: string; params: any }[] = [];
    const notificationHandlers = new Map<string, (params: any) => void>();

    const mockConnection: any = {
      sendRequest: async (method: string, params: any) => {
        requests.push({ method, params });
        return null;
      },
      sendNotification: (method: string, params: any) => {
        notifications.push({ method, params });
      },
      onNotification: (method: string, handler: (params: any) => void) => {
        notificationHandlers.set(method, handler);
      },
      console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
    };

    // 1. Create reporter
    const reporter = await LspWorkDoneProgressReporter.create(
      mockConnection,
      "ModelScript Formal Verification",
      { message: "Verifying invariants..." },
    );

    assert(reporter.token.startsWith("modelscript-verif-"), "Should allocate verification token");
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0]?.method, "window/workDoneProgress/create");

    // 2. Initial begin notification
    assert(notifications.length >= 1);
    assert.strictEqual(notifications[0]?.method, "$/progress");
    assert.strictEqual(notifications[0]?.params.value.kind, "begin");
    assert.strictEqual(notifications[0]?.params.value.title, "ModelScript Formal Verification");

    // 3. Report incremental progress
    reporter.report(50, "Evaluating flowpipe reachability...");
    const reportNote = notifications.find((n) => n.params?.value?.kind === "report");
    assert(reportNote, "Should emit incremental $/progress report");
    assert.strictEqual(reportNote.params.value.percentage, 50);
    assert.strictEqual(reportNote.params.value.message, "Evaluating flowpipe reachability...");

    // 4. Test client cancellation notification
    const cancelHandler = notificationHandlers.get("window/workDoneProgress/cancel");
    assert(cancelHandler, "Should have registered window/workDoneProgress/cancel listener");

    assert.strictEqual(reporter.isCancelled, false);
    assert.strictEqual(reporter.abortController.signal.aborted, false);

    cancelHandler({ token: reporter.token });

    assert.strictEqual(reporter.isCancelled, true);
    assert.strictEqual(reporter.abortController.signal.aborted, true);

    // 5. Complete session
    reporter.done("Verification cancelled by user");
    const endNote = notifications.find((n) => n.params?.value?.kind === "end");
    assert(endNote, "Should emit $/progress end notification");
    assert.strictEqual(endNote.params.value.message, "Verification cancelled by user");
  });
});
