// SPDX-License-Identifier: AGPL-3.0-or-later

import { assembly, compileAssemblyToAp242Step, cylinder, part, tagPatch } from "@modelscript/cad";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as vscode from "vscode";
import { CadViewerPanel } from "../src/cad-viewer-panel.js";
import { QifEditorProvider } from "../src/qif-editor-provider.js";
import {
  StepCompilationService,
  parseScadSourceDirectives,
  parseScadSpoolDirectives,
  resolveSiblingUri,
} from "../src/services/step-compilation-service.js";
import { StepEditorProvider } from "../src/step-editor-provider.js";

interface WorkspaceStubSnapshot {
  textDocuments: typeof vscode.workspace.textDocuments;
  findFiles: typeof vscode.workspace.findFiles;
  openTextDocument: typeof vscode.workspace.openTextDocument;
  fsReadFile: typeof vscode.workspace.fs.readFile;
  fsWriteFile: typeof vscode.workspace.fs.writeFile;
  showTextDocument: typeof vscode.window.showTextDocument;
}

function makeFakeStep(measuredName = "RunoutSpec"): string {
  const rotor = tagPatch(cylinder({ radius: 0.4, height: 0.2 }), {
    portName: "FanTipAcousticLiner",
    portType: "mechanical_flange",
    normal: [-1, 0, 0],
  });
  const asm = assembly("TurbofanAssembly", [part(rotor)]);
  return compileAssemblyToAp242Step(asm, {
    schema: "AP242",
    lengthUnit: "m",
    pmi: {
      datums: [{ label: "A", featureName: "FanFrame_MountFace" }],
      tolerances: [
        {
          id: "C1",
          name: measuredName,
          characteristic: "TOTAL_RUNOUT_TOLERANCE",
          zoneValue: 0.035,
          datumRefs: ["A"],
          featureName: "FanTipAcousticLiner",
        },
      ],
    },
  }).stepText;
}

describe("StepCompilationService + StepEditorProvider (Option A IDE Pipeline)", () => {
  const originalTextDocs = [...vscode.workspace.textDocuments];
  const saved: WorkspaceStubSnapshot = {
    textDocuments: vscode.workspace.textDocuments,
    findFiles: vscode.workspace.findFiles,
    openTextDocument: vscode.workspace.openTextDocument,
    fsReadFile: vscode.workspace.fs.readFile,
    fsWriteFile: vscode.workspace.fs.writeFile,
    showTextDocument: vscode.window.showTextDocument,
  };

  afterEach(() => {
    (vscode.workspace.textDocuments as vscode.TextDocument[]).splice(
      0,
      vscode.workspace.textDocuments.length,
      ...originalTextDocs,
    );
    vscode.workspace.findFiles = saved.findFiles;
    vscode.workspace.openTextDocument = saved.openTextDocument;
    vscode.workspace.fs.readFile = saved.fsReadFile;
    vscode.workspace.fs.writeFile = saved.fsWriteFile;
    vscode.window.showTextDocument = saved.showTextDocument;
  });

  it("parses @spool and source directives cleanly", () => {
    const scad = `
      // @qif_source: ../qa/bracket_mbd.qif
      // @step_output: build/bracket_ap242.step
      // @assembly_name: ActuatorBracket
      // @spool(part = "rotor_a", spool = "n1", axis = [1, 0, 0])
      // @spool(part = "rotor_b", spool = "n2", axis = [0, 3, 4])
    `;
    const dirs = parseScadSourceDirectives(scad);
    assert.strictEqual(dirs.qifSource, "../qa/bracket_mbd.qif");
    assert.strictEqual(dirs.stepOutput, "build/bracket_ap242.step");
    assert.strictEqual(dirs.assemblyName, "ActuatorBracket");

    const spools = parseScadSpoolDirectives(scad);
    assert.strictEqual(spools.length, 2);
    assert.deepStrictEqual(spools[0], { part: "rotor_a", spool: "n1", axis: [1, 0, 0] });
    assert.ok(Math.abs((spools[1]?.axis[1] ?? 0) - 0.6) < 1e-6);
    assert.ok(Math.abs((spools[1]?.axis[2] ?? 0) - 0.8) < 1e-6);

    const scadUri = vscode.Uri.parse("file:///repo/cad/sub/main.scad");
    assert.strictEqual(resolveSiblingUri(scadUri, "../qa/bracket_mbd.qif").path, "/repo/cad/qa/bracket_mbd.qif");
  });

  it("pairs same-stem, distinct-stem single-folder, and explicit-directive SCAD+QIF+STEP workspaces", async () => {
    const encoder = new TextEncoder();
    const files = new Map<string, string>([
      ["file:///ws/same/bracket.scad", "cube([1,1,1]);"],
      ["file:///ws/same/bracket.qif", "QIF 3.0.0\nDATUM A\n"],
      ["file:///ws/same/bracket.step", "ISO-10303-21;\n/* AP242 ModelScript */\nEND-ISO-10303-21;"],
      ["file:///ws/turbine/TurbofanCSG.scad", '// @spool(part="fan_lp", spool="n1", axis=[1,0,0])\ncylinder(r=1,h=1);'],
      ["file:///ws/turbine/TurbofanMBD.qif", "QIF 3.0.0\nDATUM A\n"],
      ["file:///ws/turbine/TurbofanAP242.step", "ISO-10303-21;\n/* AP242 ModelScript */\nEND-ISO-10303-21;"],
      [
        "file:///ws/explicit/custom.scad",
        "// @qif_source: specs.qif\n// @step_output: out_custom.step\n// @assembly_name: CustomAsm\ncube([2,2,2]);",
      ],
      ["file:///ws/explicit/specs.qif", "QIF 3.0.0\n"],
      ["file:///ws/explicit/other.qif", "QIF 3.0.0\n"],
    ]);

    (vscode.workspace.textDocuments as vscode.TextDocument[]).length = 0;
    vscode.workspace.findFiles = async () => Array.from(files.keys()).map((u) => vscode.Uri.parse(u));
    vscode.workspace.fs.readFile = async (uri) => {
      const content = files.get(uri.toString());
      if (content === undefined) throw new Error(`ENOENT: ${uri.toString()}`);
      return encoder.encode(content);
    };

    const service = new StepCompilationService(() => undefined, { registerWatchers: false });
    try {
      // 1. Same-stem match
      const samePair = await service.resolvePairedStepSources(vscode.Uri.parse("file:///ws/same/bracket.scad"));
      assert.strictEqual(samePair.scadUri?.path, "/ws/same/bracket.scad");
      assert.strictEqual(samePair.qifUri?.path, "/ws/same/bracket.qif");
      assert.strictEqual(samePair.stepUri?.path, "/ws/same/bracket.step");

      // 2. Distinct names in same folder (e.g. TurbofanCSG.scad + TurbofanMBD.qif -> TurbofanAP242.step)
      const turbineFromQif = await service.resolvePairedStepSources(
        vscode.Uri.parse("file:///ws/turbine/TurbofanMBD.qif"),
      );
      assert.strictEqual(turbineFromQif.scadUri?.path, "/ws/turbine/TurbofanCSG.scad");
      assert.strictEqual(turbineFromQif.qifUri?.path, "/ws/turbine/TurbofanMBD.qif");
      assert.strictEqual(turbineFromQif.stepUri?.path, "/ws/turbine/TurbofanAP242.step");

      // 3. Explicit directives resolve ambiguity among multiple siblings
      const explicitPair = await service.resolvePairedStepSources(vscode.Uri.parse("file:///ws/explicit/custom.scad"));
      assert.strictEqual(explicitPair.qifUri?.path, "/ws/explicit/specs.qif");
      assert.strictEqual(explicitPair.stepUri?.path, "/ws/explicit/out_custom.step");
      assert.strictEqual(explicitPair.assemblyName, "CustomAsm");

      // Reverse lookup from .step
      const reversePair = await service.resolvePairedStepSources(
        vscode.Uri.parse("file:///ws/turbine/TurbofanAP242.step"),
      );
      assert.strictEqual(reversePair.scadUri?.path, "/ws/turbine/TurbofanCSG.scad");
      assert.strictEqual(reversePair.qifUri?.path, "/ws/turbine/TurbofanMBD.qif");
    } finally {
      service.dispose();
    }
  });

  it("compiles unsaved .scad + .qif via LSP, updates compiled .step, and streams live overlays to StepEditorProvider", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const scadUri = vscode.Uri.parse("file:///proj/TurbofanCSG.scad");
    const qifUri = vscode.Uri.parse("file:///proj/TurbofanMBD.qif");
    const stepUri = vscode.Uri.parse("file:///proj/TurbofanAP242.step");

    const diskFiles = new Map<string, string>([
      [
        scadUri.toString(),
        `// @spool(part = "fan_lp_stage", spool = "n1", axis = [1, 0, 0])\ncylinder(h = 0.2, r = 0.4);`,
      ],
      [
        qifUri.toString(),
        `QIF 3.0.0\nFEATURE F1 Cylinder "FanTipAcousticLiner"\nCHARACTERISTIC C1 TotalRunout "RunoutSpec" zone=0.035 features=[F1]\nACTUAL A1 characteristic=C1 value=0.015 status=PASS\n`,
      ],
      [stepUri.toString(), makeFakeStep("RunoutSpec")],
    ]);

    // Unsaved in-memory QIF buffer updates ACTUAL value to FAIL before saving to disk
    let liveQifText = `QIF 3.0.0\nFEATURE F1 Cylinder "FanTipAcousticLiner"\nCHARACTERISTIC C1 TotalRunout "RunoutSpec" zone=0.035 features=[F1]\nACTUAL A1 characteristic=C1 value=0.052 status=FAIL\n`;

    (vscode.workspace.textDocuments as vscode.TextDocument[]).splice(0, vscode.workspace.textDocuments.length, {
      uri: qifUri,
      getText: () => liveQifText,
    } as any);
    vscode.workspace.findFiles = async () => [scadUri, qifUri, stepUri];
    vscode.workspace.fs.readFile = async (uri) => {
      const val = diskFiles.get(uri.toString());
      if (val === undefined) throw new Error("ENOENT");
      return encoder.encode(val);
    };
    vscode.workspace.fs.writeFile = async (uri, bytes) => {
      diskFiles.set(uri.toString(), decoder.decode(bytes));
    };

    const shownDocs: string[] = [];
    vscode.workspace.openTextDocument = async (uriOrPath: any) => {
      const u = typeof uriOrPath === "string" ? vscode.Uri.parse(uriOrPath) : uriOrPath;
      return { uri: u, getText: () => diskFiles.get(u.toString()) ?? "" } as any;
    };
    vscode.window.showTextDocument = async (doc: any) => {
      shownDocs.push(doc.uri.toString());
      return { document: doc } as any;
    };

    const lspRequests: Array<{ method: string; params: any }> = [];
    const client = {
      sendRequest: async <R = unknown>(method: string, params?: unknown): Promise<R> => {
        lspRequests.push({ method, params });
        if (method === "modelscript/compileStepFromSources") {
          const nextStep = makeFakeStep("RunoutSpec");
          return {
            stepText: nextStep,
            featureAnchors: [],
            spools: [{ part: "fan_lp_stage", spool: "n1", axis: [1, 0, 0] }],
            gdtOverlay: { datums: [], callouts: [] },
            partNames: ["fan_lp_stage"],
          } as R;
        }
        if (method === "modelscript/getStepMeshes") {
          return [
            {
              id: 1,
              name: "fan_lp_stage",
              type: "SOLID",
              vertices: new Float32Array(9),
              normals: new Float32Array(9),
              indices: new Uint32Array([0, 1, 2]),
            },
          ] as R;
        }
        return undefined as R;
      },
      onNotification: () => new vscode.Disposable(() => {}),
    };

    const service = new StepCompilationService(() => client, { registerWatchers: false });
    const provider = new StepEditorProvider(
      { extensionUri: vscode.Uri.parse("file:///ext"), subscriptions: [] } as any,
      client,
      service,
    );

    const postedMessages: any[] = [];
    let receiveHandler: ((msg: any) => Promise<void> | void) | undefined;
    let disposeHandler: (() => void) | undefined;

    const fakePanel: any = {
      webview: {
        cspSource: "vscode-webview://test",
        asWebviewUri: (u: any) => u,
        options: {},
        html: "",
        postMessage: async (msg: any) => {
          postedMessages.push(msg);
          return true;
        },
        onDidReceiveMessage: (fn: any) => {
          receiveHandler = fn;
          return new vscode.Disposable(() => {});
        },
      },
      onDidDispose: (fn: any) => {
        disposeHandler = fn;
        return new vscode.Disposable(() => {});
      },
    };

    const stepDoc: any = {
      uri: stepUri,
      getText: () => diskFiles.get(stepUri.toString()) ?? "",
    };

    try {
      await provider.resolveCustomTextEditor(stepDoc, fakePanel, new vscode.CancellationTokenSource().token);

      // 1. Trigger webview ready -> loads meshes AND extracts live overlay with FAIL status from unsaved QIF
      await receiveHandler?.({ type: "ready" });
      const overlayMsg = postedMessages.find((m) => m.type === "stepOverlay");
      assert.ok(overlayMsg, "Expected initial stepOverlay message");
      assert.strictEqual(overlayMsg.data.compiledFromOptionA, true);
      assert.strictEqual(overlayMsg.data.scadUri, scadUri.toString());
      assert.strictEqual(overlayMsg.data.qifUri, qifUri.toString());
      assert.deepStrictEqual(overlayMsg.data.spools, [{ part: "fan_lp_stage", spool: "n1", axis: [1, 0, 0] }]);
      assert.strictEqual(overlayMsg.data.gdtOverlay.callouts[0]?.status, "FAIL");
      assert.strictEqual(overlayMsg.data.gdtOverlay.callouts[0]?.measured, 0.052);

      // 2. Edit QIF to PASS and trigger immediate source document event -> recompiles + pushes updated overlay
      postedMessages.length = 0;
      liveQifText = liveQifText.replace("value=0.052 status=FAIL", "value=0.011 status=PASS");
      await service.handleSourceDocumentEvent(qifUri, true);
      // Allow microtask queue for async loadMeshes triggered by onDidCompileStep
      await new Promise((r) => setTimeout(r, 10));

      const compileCall = lspRequests.find((r) => r.method === "modelscript/compileStepFromSources");
      assert.ok(compileCall, "Expected modelscript/compileStepFromSources RPC");
      assert.ok(compileCall.params.qifText.includes("value=0.011 status=PASS"));

      const updatedOverlayMsg = postedMessages.find((m) => m.type === "stepOverlay");
      assert.ok(updatedOverlayMsg, "Expected updated stepOverlay pushed to active STEP panel");
      assert.strictEqual(updatedOverlayMsg.data.gdtOverlay.callouts[0]?.status, "PASS");
      assert.strictEqual(updatedOverlayMsg.data.gdtOverlay.callouts[0]?.measured, 0.011);

      // 3. openSource opens paired .scad or .qif cleanly
      await receiveHandler?.({ type: "openSource", role: "scad" });
      assert.strictEqual(shownDocs[0], scadUri.toString());

      // 4. Do NOT emit spurious .step writes for unrelated .scad files without an existing compiled STEP target
      const strayScadUri = vscode.Uri.parse("file:///stray/draft.scad");
      diskFiles.set(strayScadUri.toString(), "cube([1, 1, 1]);");
      const writeCountBefore = diskFiles.size;
      await service.handleSourceDocumentEvent(strayScadUri, true);
      assert.strictEqual(diskFiles.size, writeCountBefore);
      assert.strictEqual(diskFiles.has("file:///stray/draft.step"), false);
    } finally {
      disposeHandler?.();
      service.dispose();
    }
  });

  it("links cross-folder .qif -> .scad -> .mo -> .step via directives and embedded STEP provenance", async () => {
    const scadUri = vscode.Uri.parse("file:///repo/cad/Rotor.scad");
    const qifUri = vscode.Uri.parse("file:///repo/pmi/Inspection.qif");
    const moUri = vscode.Uri.parse("file:///repo/sim/Cycle.mo");
    const stepUri = vscode.Uri.parse("file:///repo/dist/RotorAssembly.step");

    const scadText = [
      '// @spool(part = "fan_rotor", spool = "n1", axis = [1, 0, 0])',
      "cylinder(r = 0.5, h = 0.2);",
    ].join("\n");
    const qifText = [
      "// @scad_source: ../cad/Rotor.scad",
      "// @step_output: ../dist/RotorAssembly.step",
      "// @modelica_source: ../sim/Cycle.mo",
      "QIF 3.0.0",
      'DATUM D1 "A" feature=F_DATUM',
      'FEATURE F_DATUM Plane "FanFrame_MountFace"',
      'FEATURE F1 Cylinder "FanTipAcousticLiner"',
      'CHARACTERISTIC C1 TotalRunout "RunoutSpec" zone=0.035 datums=[A] features=[F1]',
      "ACTUAL A1 characteristic=C1 value=0.018 status=PASS",
    ].join("\n");
    let liveMoText = [
      "model Cycle",
      "  parameter Real n1_rpm = 4120.0;",
      "  parameter Real n2_rpm = 15800.0;",
      "end Cycle;",
    ].join("\n");

    const rotor = tagPatch(cylinder({ radius: 0.5, height: 0.2 }), {
      portName: "FanTipAcousticLiner",
      portType: "mechanical_flange",
      normal: [-1, 0, 0],
    });
    const compiled = compileAssemblyToAp242Step(assembly("RotorAssembly", [part(rotor)]), {
      schema: "AP242",
      lengthUnit: "m",
      pmi: {
        datums: [{ label: "A", featureName: "FanFrame_MountFace" }],
        tolerances: [
          {
            id: "C1",
            name: "RunoutSpec",
            characteristic: "TOTAL_RUNOUT_TOLERANCE",
            zoneValue: 0.035,
            datumRefs: ["A"],
            featureName: "FanTipAcousticLiner",
          },
        ],
      },
      provenance: {
        version: 1,
        generator: "modelscript-cad",
        assemblyName: "RotorAssembly",
        scadSource: "../cad/Rotor.scad",
        qifSource: "../pmi/Inspection.qif",
        modelicaSource: "../sim/Cycle.mo",
        spools: [{ part: "fan_rotor", spool: "n1", axis: [1, 0, 0] }],
        featureAnchors: [
          { name: "FanFrame_MountFace", portType: "datum", anchor: [0.1, 0, 0], normal: [-1, 0, 0] },
          { name: "FanTipAcousticLiner", portType: "mechanical_flange", anchor: [0.25, 0.5, 0], normal: [0, 1, 0] },
        ],
      },
    });

    const files = new Map<string, string>([
      [scadUri.toString(), scadText],
      [qifUri.toString(), qifText],
      [moUri.toString(), liveMoText],
      [stepUri.toString(), compiled.stepText],
    ]);

    (vscode.workspace.textDocuments as vscode.TextDocument[]).length = 0;
    (vscode.workspace.textDocuments as vscode.TextDocument[]).push({
      uri: moUri,
      getText: () => liveMoText,
    } as any);
    vscode.workspace.findFiles = async () => Array.from(files.keys()).map((k) => vscode.Uri.parse(k));
    vscode.workspace.fs.readFile = async (uri) => {
      const val = files.get(uri.toString());
      if (val === undefined) throw new Error(`ENOENT ${uri.toString()}`);
      return Buffer.from(val, "utf8");
    };

    let compileCalls = 0;
    const service = new StepCompilationService(
      () => ({
        sendRequest: (async () => {
          compileCalls++;
          return {};
        }) as any,
      }),
      { registerWatchers: false },
    );

    const prevCurrentPanel = CadViewerPanel.currentPanel;
    const postedToCadViewer: any[] = [];
    CadViewerPanel.currentPanel = {
      sendQifInspectionOverlay: (payload: unknown) => {
        postedToCadViewer.push(payload);
      },
    } as any;

    try {
      // 1. Cross-folder resolution starting from QIF
      const fromQif = await service.resolvePairedStepSources(qifUri);
      assert.strictEqual(fromQif.scadUri?.toString(), scadUri.toString());
      assert.strictEqual(fromQif.modelicaUri?.toString(), moUri.toString());
      assert.strictEqual(fromQif.stepUri?.toString(), stepUri.toString());

      // 2. Embedded STEP provenance resolution + telemetry + spools even from STEP anchor
      const overlay = await service.resolveStepOverlay(stepUri, compiled.stepText);
      assert.strictEqual(overlay.compiledFromOptionA, true);
      assert.strictEqual(overlay.scadUri, scadUri.toString());
      assert.strictEqual(overlay.qifUri, qifUri.toString());
      assert.strictEqual(overlay.modelicaUri, moUri.toString());
      assert.strictEqual(overlay.spools[0]?.part, "fan_rotor");
      assert.strictEqual(overlay.modelicaTelemetry?.n1Rpm, 4120);
      assert.strictEqual(overlay.modelicaTelemetry?.n2Rpm, 15800);

      // 3. Updating `.mo` RPM refreshes overlay via onDidRefreshOverlay without recompiling STEP B-Rep
      const refreshedOverlays: any[] = [];
      service.onDidRefreshOverlay((ev) => refreshedOverlays.push(ev));
      liveMoText = liveMoText.replace("4120.0", "4650.0").replace("15800.0", "17100.0");
      await service.handleSourceDocumentEvent(moUri, true);
      assert.strictEqual(compileCalls, 0);
      assert.strictEqual(refreshedOverlays.length, 1);
      assert.strictEqual(refreshedOverlays[0].modelicaTelemetry?.n1Rpm, 4650);
      assert.strictEqual(refreshedOverlays[0].modelicaTelemetry?.n2Rpm, 17100);

      // 4. QifEditorProvider maps features to real STEP entityId + worldPosition on CadViewerPanel
      const qifProvider = new QifEditorProvider(
        { extensionUri: vscode.Uri.parse("file:///ext"), subscriptions: [] } as any,
        service,
      );
      let qifMsgHandler: ((msg: any) => Promise<void> | void) | undefined;
      const fakeQifPanel: any = {
        webview: {
          cspSource: "vscode-webview://test",
          asWebviewUri: (u: any) => u,
          options: {},
          html: "",
          postMessage: async () => true,
          onDidReceiveMessage: (fn: any) => {
            qifMsgHandler = fn;
            return new vscode.Disposable(() => {});
          },
        },
        onDidDispose: () => new vscode.Disposable(() => {}),
      };
      await qifProvider.resolveCustomTextEditor(
        { uri: qifUri, getText: () => qifText } as any,
        fakeQifPanel,
        new vscode.CancellationTokenSource().token,
      );
      await qifMsgHandler?.({ type: "ready" });
      await new Promise((r) => setTimeout(r, 15));
      const latestOverlay = postedToCadViewer[postedToCadViewer.length - 1];
      assert.ok(latestOverlay, "Expected QifEditorProvider to push QIF_INSPECTION_OVERLAY");
      assert.strictEqual(latestOverlay.stepUri, stepUri.toString());
      const tipFeature = latestOverlay.features?.find((f: any) => f.name === "FanTipAcousticLiner");
      assert.ok(tipFeature?.entityId?.startsWith("#"), `Expected real STEP entityId, got ${tipFeature?.entityId}`);
      assert.deepStrictEqual(tipFeature?.worldPosition, [0.25, 0.5, 0]);
    } finally {
      CadViewerPanel.currentPanel = prevCurrentPanel;
      service.dispose();
    }
  });
});
