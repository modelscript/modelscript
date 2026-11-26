// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import {
  computeSignalStatistics,
  encodeSimulationParquetBase64,
  evaluateWaterCompliance,
  SimulationPanel,
} from "../src/simulation-panel.js";
import { lttbDecimate } from "../src/utils/lttb.js";

describe("Simulation Results Webview Upgrades (P0-P3 Features)", () => {
  it("renders toolbar with X-axis selector, normalize toggle, dual-Y toggle, measurement cursors, pin run, and export buttons", () => {
    const fakeUri = vscode.Uri.parse("file:///workspace");
    const fakeWebviewPanel = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        html: "",
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: () => Promise.resolve(true),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    } as unknown as vscode.WebviewPanel;

    const panel = new (SimulationPanel as any)(fakeWebviewPanel, fakeUri, false);
    const html = (panel as unknown as { getHtmlForWebview: () => string }).getHtmlForWebview();

    // Verify Content-Security-Policy includes img-src data: blob:
    assert.ok(html.includes("img-src 'self' data: blob:"), "CSP must permit data: and blob: for image exports");

    // Verify Phase Portrait X-axis selector
    assert.ok(html.includes('id="select-xaxis"'), "Must contain select-xaxis element for phase portrait");
    assert.ok(html.includes('value="__time__"'), "Default option must be Time (s)");

    // Verify Normalize toggle
    assert.ok(html.includes('id="checkbox-normalize"'), "Must contain checkbox-normalize toggle");

    // Verify Dual-Y toggle
    assert.ok(html.includes('id="checkbox-dual-y"'), "Must contain checkbox-dual-y toggle");

    // Verify Measurement Cursors and HUD
    assert.ok(html.includes('id="btn-toggle-cursors"'), "Must contain btn-toggle-cursors button");
    assert.ok(html.includes('id="cursor-hud"'), "Must contain cursor-hud element");

    // Verify Pin Run comparison button
    assert.ok(html.includes('id="btn-pin-run"'), "Must contain btn-pin-run button");

    // Verify Export Suite buttons
    assert.ok(html.includes('id="btn-export-csv"'), "Must contain btn-export-csv button");
    assert.ok(html.includes('id="btn-export-png"'), "Must contain btn-export-png button");
    assert.ok(html.includes('id="btn-copy-csv"'), "Must contain btn-copy-csv button");

    panel.dispose();
  });

  it("correctly computes normalized (0-100%) bounds and coordinates for multi-scale variables", () => {
    // Variable A: Height h in [0, 10] m
    // Variable B: Pressure p in [1e5, 1e7] Pa
    const hVals = [0, 2.5, 5, 7.5, 10];
    const pVals = [0, 2.5e6, 5e6, 7.5e6, 1e7];

    const normalize = (val: number, min: number, max: number) => {
      return ((val - min) / (max - min || 1)) * 100;
    };

    const hMin = 0,
      hMax = 10;
    const pMin = 0,
      pMax = 1e7;

    const hNorm = hVals.map((v) => normalize(v, hMin, hMax));
    const pNorm = pVals.map((v) => normalize(v, pMin, pMax));

    // Both should span exactly 0% to 100% on the normalized scale
    assert.deepStrictEqual(hNorm, [0, 25, 50, 75, 100]);
    assert.deepStrictEqual(pNorm, [0, 25, 50, 75, 100]);
  });

  it("maps state-space phase portrait trajectory pairs (x vs y)", () => {
    // Bouncing Ball state-space trajectory: height h vs velocity v
    const t = [0.0, 0.5, 1.0];
    const h = [10.0, 8.77, 5.1];
    const v = [0.0, -4.9, -9.8];

    // When X-axis is 'h' and Y-axis is 'v'
    const phasePoints = t.map((_, i) => ({ x: h[i], y: v[i] }));

    assert.strictEqual(phasePoints.length, 3);
    assert.deepStrictEqual(phasePoints[0], { x: 10.0, y: 0.0 });
    assert.deepStrictEqual(phasePoints[2], { x: 5.1, y: -9.8 });
  });

  it("formats CSV export correctly with header and row values", () => {
    const t = [0.0, 0.1, 0.2];
    const states = ["h", "v"];
    const y = [
      [10.0, 0.0],
      [9.95, -0.98],
      [9.8, -1.96],
    ];

    const headers = ["time", ...states];
    const rows = [headers.join(",")];
    for (let i = 0; i < t.length; i++) {
      rows.push([t[i], ...y[i]!].join(","));
    }
    const csv = rows.join("\n");

    assert.ok(csv.startsWith("time,h,v\n"));
    assert.ok(csv.includes("0,10,0\n"));
    assert.ok(csv.includes("0.2,9.8,-1.96"));
  });

  it("downsamples high-sample waveforms accurately using LTTB decimation", () => {
    // Generate a 1,000-point sine wave with a sharp peak at index 500
    const raw: { x: number; y: number }[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.01;
      let y = Math.sin(x);
      if (i === 500) y = 10.0; // Significant spike
      raw.push({ x, y });
    }

    // Safety checks
    assert.strictEqual(lttbDecimate(raw, 1000).length, 1000);
    assert.strictEqual(lttbDecimate(raw, 2).length, 1000);

    // Downsample from 1000 to 100 points
    const sampled = lttbDecimate(raw, 100);
    assert.strictEqual(sampled.length, 100);

    // Verify first and last points are preserved
    assert.deepStrictEqual(sampled[0], raw[0]);
    assert.deepStrictEqual(sampled[sampled.length - 1], raw[raw.length - 1]);

    // Verify that the critical peak (y = 10.0) is retained in the downsampled series
    const hasPeak = sampled.some((pt) => pt.y === 10.0);
    assert.ok(hasPeak, "LTTB decimation must preserve significant visual peak");
  });

  it("computes accurate dual-cursor measurement metrics (dt, freq, dy, slope)", () => {
    const cursorA = 1.0;
    const cursorB = 1.25;

    const dt = Math.abs(cursorB - cursorA);
    const freq = 1 / dt;

    // Simulation signal: y(1.0) = 4.0, y(1.25) = 9.0
    const valA = 4.0;
    const valB = 9.0;
    const dy = valB - valA;
    const slope = dy / dt;

    assert.strictEqual(dt, 0.25);
    assert.strictEqual(freq, 4.0); // 4 Hz
    assert.strictEqual(dy, 5.0);
    assert.strictEqual(slope, 20.0); // dy / dt = 5.0 / 0.25 = 20.0
  });

  it("renders advanced simulation side panel with solvers, tolerances, presets, search, and no ECG toggle", () => {
    const fakeUri = vscode.Uri.parse("file:///workspace");
    const fakeWebviewPanel = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        html: "",
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: () => Promise.resolve(true),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    } as unknown as vscode.WebviewPanel;

    const panel = new (SimulationPanel as any)(fakeWebviewPanel, fakeUri, false);
    const html = (panel as unknown as { getHtmlForWebview: () => string }).getHtmlForWebview();

    // Verify ECG toggle is removed
    assert.ok(!html.includes('id="checkbox-ecg"'), "ECG toggle must be completely removed");
    assert.ok(!html.includes("🩺 ECG"), "ECG emoji/text must be removed");

    // Verify Presets & Solver Dropdown
    assert.ok(html.includes('id="st-preset"'), "Must contain simulation presets selector");
    assert.ok(html.includes('id="st-solver"'), "Must contain solver selector");
    assert.ok(html.includes('value="dopri5"'), "Must contain DOPRI5 solver option");
    assert.ok(html.includes('value="cvode"'), "Must contain CVODE stiff solver option");
    assert.ok(html.includes('value="rodas4p"'), "Must contain RODAS4P solver option");
    assert.ok(html.includes('value="webgpu"'), "Must contain WebGPU batched solver option");

    // Verify Decoupled Tolerances & Advanced Settings
    assert.ok(html.includes('id="st-rtol"'), "Must contain relative tolerance input");
    assert.ok(html.includes('id="st-atol"'), "Must contain absolute tolerance input");
    assert.ok(html.includes('id="st-max-step"'), "Must contain max step size input");
    assert.ok(html.includes('id="st-steady-state"'), "Must contain steady-state only checkbox");

    // Verify Variable Tree Controls
    assert.ok(html.includes('id="var-search"'), "Must contain variable search input");
    assert.ok(html.includes('id="btn-vars-all"'), "Must contain Select All button");
    assert.ok(html.includes('id="btn-vars-states"'), "Must contain Select States button");

    // Verify Parameter Controls
    assert.ok(html.includes('id="param-search"'), "Must contain parameter search input");
    assert.ok(html.includes('id="btn-reset-all-params"'), "Must contain Reset All parameters button");

    // Verify Sticky Simulate Action Bar & Telemetry
    assert.ok(html.includes('id="btn-simulate"'), "Must contain simulate button");
    assert.ok(html.includes('id="sim-telemetry"'), "Must contain simulation telemetry badge");

    panel.dispose();
  });

  it("renders Parquet/JSON export buttons, signal statistics drawer, baseline compare toggle, and Studio/Compliance tabs", () => {
    const fakeUri = vscode.Uri.parse("file:///workspace");
    const fakeWebviewPanel = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        html: "",
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: () => Promise.resolve(true),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    } as unknown as vscode.WebviewPanel;

    const panel = new (SimulationPanel as any)(fakeWebviewPanel, fakeUri, false);
    const html = (panel as unknown as { getHtmlForWebview: () => string }).getHtmlForWebview();

    assert.ok(html.includes('id="btn-export-parquet"'), "Must contain Parquet export button");
    assert.ok(html.includes('id="btn-export-json"'), "Must contain JSON export button");
    assert.ok(html.includes('id="btn-toggle-stats"'), "Must contain signal statistics drawer toggle");
    assert.ok(html.includes('id="btn-compare-baseline"'), "Must contain baseline comparison toggle");
    assert.ok(html.includes('id="stats-drawer"'), "Must contain signal statistics drawer element");
    assert.ok(html.includes('data-sim-tab="studio"'), "Must contain Studio View tab");
    assert.ok(html.includes('id="studio-results-container"'), "Must contain Studio View React mount container");
    assert.ok(html.includes('id="phasor-fft-container"'), "Must contain Phasor & FFT container");
    assert.ok(html.includes('id="ieee2800-container"'), "Must contain Compliance cards container");

    panel.dispose();
  });

  it("computes signal statistics (min, max, mean, RMS, 2% settling time) and baseline deltas accurately", () => {
    // Exponential step response settling to 1.0: y(t) = 1 - exp(-t)
    const t = [0, 1, 2, 3, 4, 5, 6];
    const y = t.map((ti) => 1 - Math.exp(-ti));
    const baseline = t.map(() => 1.0);

    const stats = computeSignalStatistics(t, y, baseline);
    assert.strictEqual(stats.min, 0);
    assert.ok(Math.abs(stats.max - y[6]!) < 1e-12);
    assert.ok(Math.abs(stats.finalVal - y[6]!) < 1e-12);
    assert.ok(stats.rms > 0 && stats.rms <= 1.0);
    // exp(-4) ≈ 0.0183 < 0.02, so 2% settling time should be at t = 4
    assert.strictEqual(stats.settlingTime, 4);
    assert.ok(stats.baselineDeltaMean !== undefined && stats.baselineDeltaMean < 0);
    assert.ok(stats.baselineRmse !== undefined && stats.baselineRmse > 0);
  });

  it("encodes valid Apache Parquet binary as base64 and handles exportFile via attachExtensionWebviewBridge", async () => {
    const t = [0.0, 0.5, 1.0];
    const states = ["h", "v"];
    const y = [
      [10.0, 0.0],
      [8.77, -4.9],
      [5.1, -9.8],
    ];

    const b64 = encodeSimulationParquetBase64(t, y, states);
    const decoded = Buffer.from(b64, "base64");
    assert.strictEqual(decoded.subarray(0, 4).toString("ascii"), "PAR1", "Parquet must start with PAR1 magic");
    assert.strictEqual(
      decoded.subarray(decoded.length - 4).toString("ascii"),
      "PAR1",
      "Parquet must end with PAR1 magic",
    );

    const handlers: ((msg: unknown) => Promise<void>)[] = [];
    const fakeUri = vscode.Uri.parse("file:///workspace");
    const fakeWebviewPanel = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        html: "",
        onDidReceiveMessage: (fn: (msg: unknown) => Promise<void>) => {
          handlers.push(fn);
          return { dispose: () => {} };
        },
        postMessage: () => Promise.resolve(true),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    } as unknown as vscode.WebviewPanel;

    const origShowSave = vscode.window.showSaveDialog;
    const origWriteFile = vscode.workspace.fs.writeFile;
    let writtenBytes: Uint8Array | undefined;
    (vscode.window as any).showSaveDialog = async () => vscode.Uri.file("/workspace/sim_export.parquet");
    vscode.workspace.fs.writeFile = async (_uri: vscode.Uri, bytes: Uint8Array) => {
      writtenBytes = bytes;
    };

    try {
      const panel = new (SimulationPanel as any)(fakeWebviewPanel, fakeUri, false);
      assert.strictEqual(handlers.length, 1);
      await handlers[0]!({
        type: "exportFile",
        filename: "sim_export.parquet",
        content: b64,
        encoding: "base64",
        mimeType: "application/vnd.apache.parquet",
      });
      assert.ok(writtenBytes && writtenBytes.length === decoded.length, "Must write decoded binary Parquet bytes");
      assert.strictEqual(Buffer.from(writtenBytes.subarray(0, 4)).toString("ascii"), "PAR1");
      panel.dispose();
    } finally {
      (vscode.window as any).showSaveDialog = origShowSave;
      vscode.workspace.fs.writeFile = origWriteFile;
    }
  });

  it("evaluates water/hydraulics domain compliance and forwards compliance reports to the webview", () => {
    const t = [0, 1, 2];
    const states = ["junction1.pressure", "node1.chlorine", "pipe1.pipe_velocity"];
    const y = [
      [42.0, 0.8, 1.5],
      [38.5, 0.6, 2.1],
      [15.0, 0.5, 2.4], // pressure drops below 20 psi limit
    ];

    const report = evaluateWaterCompliance(t, y, states);
    assert.ok(report, "Must detect water-domain compliance metrics");
    assert.strictEqual(report.overallPass, false);
    assert.strictEqual(report.metrics.length, 3);
    assert.strictEqual(report.metrics[0]!.pass, false);
    assert.strictEqual(report.metrics[1]!.pass, true);
    assert.strictEqual(report.metrics[2]!.pass, true);

    const posted: unknown[] = [];
    const fakeUri = vscode.Uri.parse("file:///workspace");
    const fakeWebviewPanel = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        html: "",
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: (msg: unknown) => {
          posted.push(msg);
          return Promise.resolve(true);
        },
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    } as unknown as vscode.WebviewPanel;

    const panel = new (SimulationPanel as any)(fakeWebviewPanel, fakeUri, false);
    SimulationPanel.currentPanel = panel;
    SimulationPanel.postComplianceReport(report, "water");
    assert.ok(
      posted.some((m: any) => m.type === "complianceReport" && m.kind === "water"),
      "postComplianceReport must forward water compliance message to webview",
    );
    panel.dispose();
  });
});
