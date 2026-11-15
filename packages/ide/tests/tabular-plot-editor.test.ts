// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { SimulationPanel } from "../src/simulation-panel.js";
import { TabularCustomDocument, TabularPlotEditorProvider } from "../src/tabular-plot-editor-provider.js";

const SAMPLE_LAS = [
  "~Version Information",
  " VERS.                          2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0",
  " WRAP.                           NO : ONE LINE PER DEPTH STEP",
  "~Well Information",
  " STRT.M                     1000.00 : START DEPTH",
  " STOP.M                     1002.00 : STOP DEPTH",
  " STEP.M                        1.00 : STEP",
  " NULL.                      -999.25 : NULL VALUE",
  " WELL.                 MODEL-TEST-1 : WELL NAME",
  "~Parameter Information",
  " BHT.DEGC                     75.00 : BOTTOM HOLE TEMP",
  "~Curve Information",
  " DEPT.M                             : 1 DEPTH",
  " GR  .GAPI                          : 2 GAMMA RAY",
  " RHOB.G/C3                          : 3 BULK DENSITY",
  " RT  .OHMM                          : 4 RESISTIVITY",
  "~Ascii Log Data",
  " 1000.00   45.2   2.35   12.5",
  " 1001.00  -999.25 2.41   18.0",
  " 1002.00   62.8   2.28   24.3",
].join("\n");

const SAMPLE_CSV = ["time [s],h [m],v [m/s]", "0.0,10.0,0.0", "0.5,8.77,-4.9", "1.0,5.1,-9.8"].join("\n");

const SAMPLE_DEPTH_CSV = ["depth,GR,RHOB", "500.0,32.1,2.45", "500.5,48.9,2.39"].join("\n");

describe("Generic TabularPlotEditorProvider (.las & .csv) and SimulationPanel Modes", () => {
  it("exposes expected custom editor viewType", () => {
    assert.equal(TabularPlotEditorProvider.viewType, "modelscript.tabularPlotViewer");
  });

  it("opens a .las document into a canonical depth-indexed IndexedDataset with normalized nulls", async () => {
    const origReadFile = vscode.workspace.fs.readFile;
    vscode.workspace.fs.readFile = async () => new TextEncoder().encode(SAMPLE_LAS);

    try {
      const provider = new TabularPlotEditorProvider({
        extensionUri: vscode.Uri.file("/workspace"),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext);

      const doc = await provider.openCustomDocument(vscode.Uri.file("/workspace/well_a1.las"));
      assert.ok(doc instanceof TabularCustomDocument);
      assert.equal(doc.format, "las");
      assert.equal(doc.parseError, undefined);
      assert.equal(doc.dataset.indexAxis.key, "DEPT");
      assert.equal(doc.dataset.indexAxis.inverted, true);
      assert.deepEqual(doc.dataset.indexValues, [1000, 1001, 1002]);
      assert.equal(doc.dataset.series.length, 3);

      const gr = doc.dataset.series.find((s) => s.name === "GR");
      assert.ok(gr);
      assert.equal(gr.values[0], 45.2);
      assert.ok(Number.isNaN(gr.values[1]!), "LAS sentinel -999.25 must normalize to NaN");
      assert.equal(gr.values[2], 62.8);
    } finally {
      vscode.workspace.fs.readFile = origReadFile;
    }
  });

  it("opens time-indexed and depth-indexed .csv documents into canonical IndexedDatasets", async () => {
    const origReadFile = vscode.workspace.fs.readFile;

    try {
      const provider = new TabularPlotEditorProvider({
        extensionUri: vscode.Uri.file("/workspace"),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext);

      vscode.workspace.fs.readFile = async () => new TextEncoder().encode(SAMPLE_CSV);
      const timeDoc = await provider.openCustomDocument(vscode.Uri.file("/workspace/bounce.csv"));
      assert.equal(timeDoc.format, "csv");
      assert.equal(timeDoc.dataset.indexAxis.key, "time");
      assert.equal(timeDoc.dataset.indexAxis.unit, "s");
      assert.equal(timeDoc.dataset.indexAxis.inverted, false);
      assert.deepEqual(
        timeDoc.dataset.series.map((s) => `${s.name}:${s.unit ?? ""}`),
        ["h:m", "v:m/s"],
      );

      vscode.workspace.fs.readFile = async () => new TextEncoder().encode(SAMPLE_DEPTH_CSV);
      const depthDoc = await provider.openCustomDocument(vscode.Uri.file("/workspace/log_export.csv"));
      assert.equal(depthDoc.dataset.indexAxis.key, "depth");
      assert.equal(depthDoc.dataset.indexAxis.inverted, true);
    } finally {
      vscode.workspace.fs.readFile = origReadFile;
    }
  });

  it("renders Canvas2D studio HTML, posts datasetData, and exports sibling CSV & LAS files", async () => {
    const origReadFile = vscode.workspace.fs.readFile;
    const origWriteFile = vscode.workspace.fs.writeFile;
    vscode.workspace.fs.readFile = async () => new TextEncoder().encode(SAMPLE_LAS);

    const written = new Map<string, string>();
    vscode.workspace.fs.writeFile = async (uri: vscode.Uri, bytes: Uint8Array) => {
      written.set(uri.path, new TextDecoder("utf-8").decode(bytes));
    };

    try {
      const provider = new TabularPlotEditorProvider({
        extensionUri: vscode.Uri.file("/workspace"),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext);
      const doc = await provider.openCustomDocument(vscode.Uri.file("/workspace/logs/well_a1.las"));

      const posted: unknown[] = [];
      const messageHandlers: ((msg: unknown) => Promise<void>)[] = [];
      const mockWebview: any = {
        options: {},
        cspSource: "vscode-webview://unit-test",
        asWebviewUri: (u: vscode.Uri) => u,
        html: "",
        postMessage: (msg: unknown) => {
          posted.push(msg);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (fn: (msg: unknown) => Promise<void>) => {
          messageHandlers.push(fn);
          return { dispose: () => {} };
        },
      };
      const mockPanel: any = {
        webview: mockWebview,
        onDidDispose: () => ({ dispose: () => {} }),
      };

      await provider.resolveCustomEditor(doc, mockPanel, {} as vscode.CancellationToken);

      assert.ok(mockWebview.html.includes("tabular-plot-webview.js"));
      assert.ok(mockWebview.html.includes('data-mode="multitrack"'));
      assert.ok(mockWebview.html.includes('data-mode="crossplot"'));
      assert.ok(mockWebview.html.includes('data-mode="histogram"'));

      assert.equal(posted.length, 1);
      const payload = posted[0] as { type: string; format: string; lasMeta?: { well: unknown[] } };
      assert.equal(payload.type, "datasetData");
      assert.equal(payload.format, "las");
      assert.ok((payload.lasMeta?.well.length ?? 0) >= 3);

      const handleMsg = messageHandlers[0];
      assert.ok(handleMsg);
      await handleMsg({ type: "ready" });
      assert.equal(posted.length, 2);

      await handleMsg({ type: "exportCsv" });
      await handleMsg({ type: "exportLas" });
      const exportedCsv = written.get("/workspace/logs/well_a1.csv");
      const exportedLas = written.get("/workspace/logs/well_a1.las");
      assert.ok(exportedCsv && exportedCsv.includes("DEPT,GR,RHOB,RT"));
      assert.ok(exportedLas && exportedLas.includes("~ASCII") && exportedLas.includes("-999.25"));
    } finally {
      vscode.workspace.fs.readFile = origReadFile;
      vscode.workspace.fs.writeFile = origWriteFile;
    }
  });

  it("includes Overlay, Multi-Track, Crossplot, and Histogram mode tabs in SimulationPanel toolbar", () => {
    const panel = SimulationPanel.createOrShowLiveLocal(vscode.Uri.file("/workspace"));
    const html = (panel as unknown as { panel: { webview: { html: string } } }).panel.webview.html;

    assert.ok(html.includes('id="view-mode-group"'));
    assert.ok(html.includes('data-mode="overlay"'));
    assert.ok(html.includes('data-mode="multitrack"'));
    assert.ok(html.includes('data-mode="crossplot"'));
    assert.ok(html.includes('data-mode="histogram"'));
    assert.ok(html.includes('id="select-cp-x"'));
    assert.ok(html.includes('id="select-cp-y"'));
    assert.ok(html.includes('id="select-cp-color"'));
    assert.ok(html.includes('id="select-hist-var"'));

    panel.dispose();
  });

  it("opens an arbitrary IndexedDataset panel via TabularPlotEditorProvider.createOrShowDataset", async () => {
    const origCreate = vscode.window.createWebviewPanel;
    let capturedTitle = "";
    const posted: unknown[] = [];

    (vscode.window as any).createWebviewPanel = (viewType: string, title: string, showOptions: any, options?: any) => {
      capturedTitle = title;
      const base = origCreate(viewType, title, showOptions, options);
      base.webview.postMessage = async (msg: unknown) => {
        posted.push(msg);
        return true;
      };
      return base;
    };

    try {
      const panel = TabularPlotEditorProvider.createOrShowDataset(
        vscode.Uri.file("/workspace"),
        {
          title: "Well Log A1",
          indexAxis: { key: "DEPT", label: "Depth", unit: "m", inverted: true },
          indexValues: [1000, 1001],
          series: [{ name: "GR", unit: "GAPI", values: [45.2, 62.8] }],
        },
        "file:///workspace/well_a1.las",
        "Plot Well Log",
      );

      assert.equal(capturedTitle, "Plot Well Log");
      assert.ok(panel.webview.html.includes("tabular-plot-webview.js"));
      assert.ok(panel.webview.html.includes('data-mode="multitrack"'));
      assert.ok(panel.webview.html.includes('data-mode="crossplot"'));
      assert.ok(panel.webview.html.includes('data-mode="histogram"'));
      assert.equal(posted.length, 1);
      const payload = posted[0] as { type: string; dataset: { indexAxis: { inverted?: boolean } } };
      assert.equal(payload.type, "datasetData");
      assert.equal(payload.dataset.indexAxis.inverted, true);

      panel.dispose();
    } finally {
      (vscode.window as any).createWebviewPanel = origCreate;
    }
  });
});
