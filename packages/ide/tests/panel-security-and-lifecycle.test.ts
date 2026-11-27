// SPDX-License-Identifier: AGPL-3.0-or-later

import { parsePdb, solveProteinBiophysics } from "@modelscript/pdb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { AcceleratorLatticePanel } from "../src/accelerator-lattice-panel.js";
import { ClimateRasterPanel } from "../src/climate-raster-panel.js";
import { CrystallographyPanel } from "../src/crystallography-panel.js";
import { ElectrophysiologyPanel } from "../src/electrophysiology-panel.js";
import { FitsImageViewerPanel } from "../src/fits-image-panel.js";
import { HepEventViewerPanel } from "../src/hep-event-panel.js";
import { MolstarPanel, renderMolstarHtml } from "../src/molstar-panel.js";
import { NeuralSpikeViewerPanel } from "../src/neural-spike-panel.js";
import { OpticalBenchPanel } from "../src/optical-bench-panel.js";
import { QuantumChemistryPanel } from "../src/quantum-chemistry-panel.js";
import { ReactionCoordinatePanel } from "../src/reaction-coordinate-panel.js";
import { wrapVisualDiffHtml } from "../src/scm-integration.js";
import { SeismicViewerPanel } from "../src/seismic-viewer-panel.js";
import { TokamakEquilibriumPanel } from "../src/tokamak-equilibrium-panel.js";
import { WaterDiffPanel } from "../src/water-diff-panel.js";

const EXTENSION_URI = vscode.Uri.file("/workspace/ext");

const SAMPLE_GEQDSK_FIXTURE = `
EFITD  03/12/2026 #654321  DIII-D Baseline         3    5    5
 1.20000000E+00 1.80000000E+00 1.67000000E+00 1.07000000E+00 0.00000000E+00
 1.72000000E+00 0.00000000E+00 0.00000000E+00 1.20000000E+00 2.15000000E+00
 1.50000000E+06 0.00000000E+00 0.00000000E+00 1.72000000E+00 0.00000000E+00
 0.00000000E+00 0.00000000E+00 1.20000000E+00 0.00000000E+00 0.00000000E+00
 3.59050000E+00 3.59050000E+00 3.59050000E+00 3.59050000E+00 3.59050000E+00
 4.50000000E+04 4.00000000E+04 3.00000000E+04 1.50000000E+04 0.00000000E+00
 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00
 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00
 0.10000000E+00 0.15000000E+00 0.20000000E+00 0.25000000E+00 0.30000000E+00
 0.12000000E+00 0.08000000E+00 0.05000000E+00 0.08000000E+00 0.25000000E+00
 0.15000000E+00 0.05000000E+00 0.00000000E+00 0.05000000E+00 0.20000000E+00
 0.18000000E+00 0.08000000E+00 0.05000000E+00 0.08000000E+00 0.25000000E+00
 0.25000000E+00 0.20000000E+00 0.18000000E+00 0.22000000E+00 0.35000000E+00
 1.15000000E+00 1.30000000E+00 1.70000000E+00 2.50000000E+00 3.80000000E+00
 8 8
 1.15000000E+00 0.00000000E+00 1.45000000E+00 0.65000000E+00
 1.72000000E+00 0.85000000E+00 2.05000000E+00 0.50000000E+00
 2.25000000E+00 0.00000000E+00 2.05000000E+00 -0.50000000E+00
 1.60000000E+00 -0.88000000E+00 1.35000000E+00 -0.65000000E+00
 1.00000000E+00 0.00000000E+00 1.20000000E+00 1.00000000E+00
 1.70000000E+00 1.15000000E+00 2.20000000E+00 1.00000000E+00
 2.40000000E+00 0.00000000E+00 2.20000000E+00 -1.00000000E+00
 1.65000000E+00 -1.15000000E+00 1.20000000E+00 -1.00000000E+00
`;

function capturePanelHtml(openFn: () => void, disposeFn: () => void): string {
  const originalCreate = vscode.window.createWebviewPanel;
  let capturedPanel: vscode.WebviewPanel | undefined;

  vscode.window.createWebviewPanel = (
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn | { readonly viewColumn: vscode.ViewColumn; readonly preserveFocus?: boolean },
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions,
  ): vscode.WebviewPanel => {
    const panel = originalCreate(viewType, title, showOptions, options);
    capturedPanel = panel;
    return panel;
  };

  try {
    openFn();
  } finally {
    vscode.window.createWebviewPanel = originalCreate;
  }

  const html = capturedPanel?.webview.html ?? "";
  disposeFn();
  return html;
}

async function captureAsyncPanelHtml(
  openFn: () => void,
  getPanel: () => { update(): Promise<void>; dispose(): void } | undefined,
): Promise<string> {
  const originalCreate = vscode.window.createWebviewPanel;
  let capturedPanel: vscode.WebviewPanel | undefined;

  vscode.window.createWebviewPanel = (
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn | { readonly viewColumn: vscode.ViewColumn; readonly preserveFocus?: boolean },
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions,
  ): vscode.WebviewPanel => {
    const panel = originalCreate(viewType, title, showOptions, options);
    capturedPanel = panel;
    return panel;
  };

  try {
    openFn();
    const instance = getPanel();
    assert.ok(instance, "Singleton panel instance should be created");
    await instance.update();
    const html = capturedPanel?.webview.html ?? "";
    instance.dispose();
    return html;
  } finally {
    vscode.window.createWebviewPanel = originalCreate;
  }
}

function assertStrictCspAndNonces(html: string, panelName: string): void {
  assert.ok(
    html.includes('http-equiv="Content-Security-Policy"'),
    `${panelName}: must include Content-Security-Policy meta tag`,
  );
  const cspMatch = html.match(/script-src\s+'nonce-([A-Za-z0-9]+)'/);
  assert.ok(cspMatch && cspMatch[1], `${panelName}: CSP must include script-src 'nonce-...'`);
  const nonce = cspMatch[1];

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of scriptTags) {
    assert.ok(
      tag.includes(`nonce="${nonce}"`),
      `${panelName}: every <script> tag must carry matching nonce="${nonce}", got: ${tag}`,
    );
  }
}

describe("Singleton webview panel disposal lifecycle", () => {
  it("disposes and recreates MolstarPanel without throwing", async () => {
    MolstarPanel.createOrShow(EXTENSION_URI);
    const first = MolstarPanel.currentPanel;
    assert.ok(first, "MolstarPanel.currentPanel should be defined after createOrShow");
    await first.update();

    first.dispose();
    assert.equal(MolstarPanel.currentPanel, undefined, "MolstarPanel.currentPanel must be cleared on dispose");

    MolstarPanel.createOrShow(EXTENSION_URI);
    const second = ((): MolstarPanel | undefined => MolstarPanel.currentPanel)();
    assert.ok(second, "MolstarPanel should be re-created cleanly after dispose");
    assert.notEqual(second, first, "Re-created MolstarPanel should be a new instance");
    await second.update();
    second.dispose();
    assert.equal(MolstarPanel.currentPanel, undefined);
  });

  it("disposes and recreates ReactionCoordinatePanel without throwing", async () => {
    ReactionCoordinatePanel.createOrShow(EXTENSION_URI);
    const first = ReactionCoordinatePanel.currentPanel;
    assert.ok(first, "ReactionCoordinatePanel.currentPanel should be defined after createOrShow");
    await first.update();

    first.dispose();
    assert.equal(
      ReactionCoordinatePanel.currentPanel,
      undefined,
      "ReactionCoordinatePanel.currentPanel must be cleared on dispose",
    );

    ReactionCoordinatePanel.createOrShow(EXTENSION_URI);
    const second = ((): ReactionCoordinatePanel | undefined => ReactionCoordinatePanel.currentPanel)();
    assert.ok(second, "ReactionCoordinatePanel should be re-created cleanly after dispose");
    assert.notEqual(second, first);
    await second.update();
    second.dispose();
    assert.equal(ReactionCoordinatePanel.currentPanel, undefined);
  });

  it("disposes and recreates ElectrophysiologyPanel without throwing", async () => {
    ElectrophysiologyPanel.createOrShow(EXTENSION_URI);
    const first = ElectrophysiologyPanel.currentPanel;
    assert.ok(first, "ElectrophysiologyPanel.currentPanel should be defined after createOrShow");
    await first.update();

    first.dispose();
    assert.equal(
      ElectrophysiologyPanel.currentPanel,
      undefined,
      "ElectrophysiologyPanel.currentPanel must be cleared on dispose",
    );

    ElectrophysiologyPanel.createOrShow(EXTENSION_URI);
    const second = ((): ElectrophysiologyPanel | undefined => ElectrophysiologyPanel.currentPanel)();
    assert.ok(second, "ElectrophysiologyPanel should be re-created cleanly after dispose");
    assert.notEqual(second, first);
    await second.update();
    second.dispose();
    assert.equal(ElectrophysiologyPanel.currentPanel, undefined);
  });
});

describe("Strict CSP and nonces across all 14 scientific webview panels", () => {
  it("enforces CSP meta tag and nonced scripts on async panels", async () => {
    const molstarHtml = await captureAsyncPanelHtml(
      () => MolstarPanel.createOrShow(EXTENSION_URI),
      () => MolstarPanel.currentPanel,
    );
    assertStrictCspAndNonces(molstarHtml, "MolstarPanel");

    const reactionHtml = await captureAsyncPanelHtml(
      () => ReactionCoordinatePanel.createOrShow(EXTENSION_URI),
      () => ReactionCoordinatePanel.currentPanel,
    );
    assertStrictCspAndNonces(reactionHtml, "ReactionCoordinatePanel");

    const electroHtml = await captureAsyncPanelHtml(
      () => ElectrophysiologyPanel.createOrShow(EXTENSION_URI),
      () => ElectrophysiologyPanel.currentPanel,
    );
    assertStrictCspAndNonces(electroHtml, "ElectrophysiologyPanel");
  });

  it("enforces CSP meta tag and nonced scripts on sync panels", () => {
    const syncPanels: { name: string; open: () => void; dispose: () => void }[] = [
      {
        name: "FitsImageViewerPanel",
        open: () => FitsImageViewerPanel.createOrShow(EXTENSION_URI),
        dispose: () => {
          FitsImageViewerPanel.currentPanel?.dispose();
          FitsImageViewerPanel.currentPanel = undefined;
        },
      },
      {
        name: "ClimateRasterPanel",
        open: () => ClimateRasterPanel.createOrShow(EXTENSION_URI),
        dispose: () => ClimateRasterPanel.currentPanel?.dispose(),
      },
      {
        name: "QuantumChemistryPanel",
        open: () => QuantumChemistryPanel.createOrShow(EXTENSION_URI),
        dispose: () => {
          QuantumChemistryPanel.currentPanel?.dispose();
          QuantumChemistryPanel.currentPanel = undefined;
        },
      },
      {
        name: "SeismicViewerPanel",
        open: () => SeismicViewerPanel.createOrShow(EXTENSION_URI),
        dispose: () => SeismicViewerPanel.currentPanel?.dispose(),
      },
      {
        name: "HepEventViewerPanel",
        open: () => HepEventViewerPanel.createOrShow(EXTENSION_URI),
        dispose: () => {
          HepEventViewerPanel.currentPanel?.dispose();
          HepEventViewerPanel.currentPanel = undefined;
        },
      },
      {
        name: "TokamakEquilibriumPanel",
        open: () => {
          const uri = vscode.Uri.file("/workspace/sample.geqdsk");
          const docs = vscode.workspace.textDocuments as vscode.TextDocument[];
          docs.push({
            uri,
            getText: () => SAMPLE_GEQDSK_FIXTURE,
          } as vscode.TextDocument);
          TokamakEquilibriumPanel.createOrShow(EXTENSION_URI, undefined, uri.toString());
        },
        dispose: () => {
          TokamakEquilibriumPanel.currentPanel?.dispose();
          TokamakEquilibriumPanel.currentPanel = undefined;
          (vscode.workspace.textDocuments as vscode.TextDocument[]).length = 0;
        },
      },
      {
        name: "WaterDiffPanel",
        open: () => WaterDiffPanel.createOrShow(EXTENSION_URI),
        dispose: () => WaterDiffPanel.currentPanel?.dispose(),
      },
      {
        name: "NeuralSpikeViewerPanel",
        open: () => NeuralSpikeViewerPanel.createOrShow(EXTENSION_URI),
        dispose: () => {
          NeuralSpikeViewerPanel.currentPanel?.dispose();
          NeuralSpikeViewerPanel.currentPanel = undefined;
        },
      },
      {
        name: "CrystallographyPanel",
        open: () => CrystallographyPanel.createOrShow(EXTENSION_URI),
        dispose: () => CrystallographyPanel.currentPanel?.dispose(),
      },
      {
        name: "AcceleratorLatticePanel",
        open: () => AcceleratorLatticePanel.createOrShow(EXTENSION_URI),
        dispose: () => {
          AcceleratorLatticePanel.currentPanel?.dispose();
          AcceleratorLatticePanel.currentPanel = undefined;
        },
      },
      {
        name: "OpticalBenchPanel",
        open: () => OpticalBenchPanel.createOrShow(EXTENSION_URI),
        dispose: () => {
          OpticalBenchPanel.currentPanel?.dispose();
          OpticalBenchPanel.currentPanel = undefined;
        },
      },
    ];

    for (const entry of syncPanels) {
      const html = capturePanelHtml(entry.open, entry.dispose);
      assertStrictCspAndNonces(html, entry.name);
    }
  });
});

describe("XSS and CSP bypass hardening", () => {
  it("escapes </script> and HTML tags in MolstarPanel title and JSON payloads", () => {
    const doc = parsePdb(
      "HEADER    TEST                                    01-JAN-26   1TST\n" +
        "ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C\n" +
        "END\n",
    );
    const biophysics = solveProteinBiophysics(doc);
    doc.title = 'Malicious </title><script>alert(1)</script><img src=x onerror="alert(2)">';
    if (biophysics.caAtoms[0]) {
      biophysics.caAtoms[0].resName = "</script><script>alert(3)</script>";
    }

    const html = renderMolstarHtml(doc, biophysics, "vscode-webview://test");
    assertStrictCspAndNonces(html, "MolstarPanel (XSS payload)");

    assert.ok(!html.includes("<script>alert(1)</script>"), "Unescaped <script> from title must not appear");
    assert.ok(!html.includes('onerror="alert(2)"'), "Unescaped HTML attribute from title must not appear");
    assert.ok(!html.includes("</script><script>alert(3)"), "Unescaped </script> breakout from JSON must not appear");
    assert.ok(html.includes("\\u003c/script\\u003e"), "JSON payload should escape < as \\u003c");
  });

  it("strips untrusted <script> tags in wrapVisualDiffHtml without auto-noncing them", () => {
    const html = wrapVisualDiffHtml('<div>Safe Diff</div><script>alert("xss")</script><script src="evil.js">');
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'), "Must include CSP meta tag");
    assert.ok(html.includes("<div>Safe Diff</div>"), "Should preserve safe HTML content");
    assert.ok(!/<script\b/i.test(html), "Must strip untrusted <script> tags instead of adding a CSP nonce");
    assert.ok(!html.includes('alert("xss")'), "Must remove inline script body");
  });
});
