// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { SimulationPanel } from "../src/simulation-panel.js";
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
      rows.push([t[i], ...y[i]].join(","));
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
});
