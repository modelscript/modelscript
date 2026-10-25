// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";
import { PsoutCustomDocument, PsoutEditorProvider } from "../src/psout-editor-provider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/Cigre.psout");

describe("PSCAD PSOUT Binary Waveform Custom Editor Provider Suite", () => {
  it("registers modelscript.psoutViewer viewType", () => {
    assert.equal(PsoutEditorProvider.viewType, "modelscript.psoutViewer");
  });

  it("opens custom document and decodes slotted-page binary structure", async () => {
    assert.ok(fs.existsSync(FIXTURE_PATH), `Fixture must exist at ${FIXTURE_PATH}`);
    const cigreBytes = fs.readFileSync(FIXTURE_PATH);

    // Mock fs.readFile to return Cigre.psout bytes
    const origReadFile = vscode.workspace.fs.readFile;
    vscode.workspace.fs.readFile = async () => new Uint8Array(cigreBytes);

    try {
      const mockContext: any = {
        extensionUri: vscode.Uri.file("/workspace"),
        subscriptions: [],
      };
      const provider = new PsoutEditorProvider(mockContext);
      const uri = vscode.Uri.file("/workspace/Cigre.psout");

      const doc = await provider.openCustomDocument(uri);
      assert.ok(doc instanceof PsoutCustomDocument);
      assert.equal(doc.uri.path, "/workspace/Cigre.psout");

      // Verify header decoded by AssemblyScript kernel
      assert.equal(doc.psoutDoc.header.version, 1);
      assert.equal(doc.psoutDoc.header.pageCount, 552);
      assert.equal(doc.psoutDoc.header.pageSize, 1024);
      assert.equal(doc.psoutDoc.header.guid, "a24e10833dca85f307c9090ea1d6f6aa");

      // Verify traces and sample count
      const run0 = doc.psoutDoc.run(0);
      assert.equal(run0.traces.size, 26, "Cigre.psout contains 26 recorded traces");
      const sim = doc.psoutDoc.toSimulationResult(0);
      assert.equal(sim.time.length, 2001, "Cigre.psout contains 2001 time samples");
    } finally {
      vscode.workspace.fs.readFile = origReadFile;
    }
  });

  it("resolves custom editor, renders UI studio HTML, and posts channel telemetry", async () => {
    const cigreBytes = fs.readFileSync(FIXTURE_PATH);
    const origReadFile = vscode.workspace.fs.readFile;
    const origWriteFile = vscode.workspace.fs.writeFile;
    vscode.workspace.fs.readFile = async () => new Uint8Array(cigreBytes);

    const writtenFiles = new Map<string, Uint8Array>();
    vscode.workspace.fs.writeFile = async (uri: any, content: Uint8Array) => {
      writtenFiles.set(uri.path, content);
    };

    try {
      const mockContext: any = {
        extensionUri: vscode.Uri.file("/workspace"),
        subscriptions: [],
      };
      const provider = new PsoutEditorProvider(mockContext);
      const uri = vscode.Uri.file("/workspace/Cigre.psout");
      const doc = await provider.openCustomDocument(uri);

      const postedMessages: any[] = [];
      let messageHandler: ((msg: any) => Promise<void>) | null = null;

      const mockWebview: any = {
        options: {},
        html: "",
        postMessage: (msg: any) => {
          postedMessages.push(msg);
        },
        onDidReceiveMessage: (handler: any) => {
          messageHandler = handler;
          return { dispose: () => {} };
        },
      };

      const mockPanel: any = {
        webview: mockWebview,
        onDidDispose: () => ({ dispose: () => {} }),
      };

      await provider.resolveCustomEditor(doc, mockPanel, {} as any);

      // Verify HTML content structure
      assert.ok(mockWebview.html.includes("PSCAD PSOUT Waveform Studio"));
      assert.ok(mockWebview.html.includes("badge-filename"));
      assert.ok(mockWebview.html.includes("badge-version"));
      assert.ok(mockWebview.html.includes("badge-pages"));
      assert.ok(mockWebview.html.includes("btn-toggle-cursors"));
      assert.ok(mockWebview.html.includes("btn-toggle-normalized"));
      assert.ok(mockWebview.html.includes("btn-reset-zoom"));
      assert.ok(mockWebview.html.includes("btn-export-csv"));
      assert.ok(mockWebview.html.includes("btn-export-comtrade"));
      assert.ok(mockWebview.html.includes("waveform-canvas"));
      assert.ok(mockWebview.html.includes("hud-metrics"));

      // Verify initial posted data message
      assert.ok(postedMessages.length >= 1, "Must post init message on resolve");
      const initMsg = postedMessages[0];
      assert.equal(initMsg.type, "init");
      assert.equal(initMsg.header.version, 1);
      assert.equal(initMsg.header.pageCount, 552);
      assert.equal(initMsg.time.length, 2001);
      assert.equal(initMsg.channels.length, 26);
      assert.equal(initMsg.channels[0].samples.length, 2001);

      // Test webview 'ready' signal triggers re-posting data
      assert.ok(messageHandler, "Must register messageHandler");
      const handler = messageHandler as (msg: any) => Promise<void>;
      postedMessages.length = 0;
      await handler({ type: "ready" });
      assert.equal(postedMessages.length, 1);
      assert.equal(postedMessages[0].type, "init");

      // Test 'exportCsv' message handler
      await handler({
        type: "exportCsv",
        csv: "Time (s),Ch1\n0.0,10.0\n0.1,12.0",
      });
      assert.ok(writtenFiles.has("/workspace/Cigre.csv"), "Must write export.csv file");
      const csvStr = new TextDecoder().decode(writtenFiles.get("/workspace/Cigre.csv")!);
      assert.ok(csvStr.includes("Time (s),Ch1"));

      // Test 'exportComtrade' message handler
      await handler({ type: "exportComtrade" });
      assert.ok(writtenFiles.has("/workspace/Cigre.cfg"), "Must write IEEE C37.111 COMTRADE .cfg");
      assert.ok(writtenFiles.has("/workspace/Cigre.dat"), "Must write IEEE C37.111 COMTRADE .dat");
      const cfgStr = new TextDecoder().decode(writtenFiles.get("/workspace/Cigre.cfg")!);
      assert.ok(cfgStr.includes("Cigre,MSX_PSOUT,1999"));
    } finally {
      vscode.workspace.fs.readFile = origReadFile;
      vscode.workspace.fs.writeFile = origWriteFile;
    }
  });
});
