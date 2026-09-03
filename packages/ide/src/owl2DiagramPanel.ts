// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OWL2 Ontology Diagram Viewer — renders an interactive graph visualization
// of OWL2 classes, properties, and their relationships (subsumption, disjointness,
// equivalence, domain/range) using a WebView panel.
//
// This is the "Ontology Diagram" view akin to Protégé's OntoGraf or OWLViz.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export interface OWL2DiagramData {
  nodes: OWL2DiagramNode[];
  edges: OWL2DiagramEdge[];
}

export interface OWL2DiagramNode {
  id: string;
  label: string;
  type: "class" | "objectProperty" | "dataProperty" | "individual";
  isDefinedClass?: boolean;
}

export interface OWL2DiagramEdge {
  source: string;
  target: string;
  label: string;
  type: "subClassOf" | "equivalentTo" | "disjointWith" | "domain" | "range" | "objectProperty" | "inverseOf";
}

export class OWL2DiagramPanel {
  public static currentPanel: OWL2DiagramPanel | undefined;
  private static readonly viewType = "modelscript.owl2Diagram";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _client: LanguageClient;
  private _documentUri: string | undefined;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(client: LanguageClient, documentUri?: string): void {
    const column = vscode.ViewColumn.Beside;

    if (OWL2DiagramPanel.currentPanel) {
      OWL2DiagramPanel.currentPanel._panel.reveal(column);
      if (documentUri) {
        OWL2DiagramPanel.currentPanel._documentUri = documentUri;
        OWL2DiagramPanel.currentPanel.update();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(OWL2DiagramPanel.viewType, "OWL2 Ontology Diagram", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    OWL2DiagramPanel.currentPanel = new OWL2DiagramPanel(panel, client, documentUri);
  }

  private constructor(panel: vscode.WebviewPanel, client: LanguageClient, documentUri?: string) {
    this._panel = panel;
    this._client = client;
    this._documentUri = documentUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => {
        switch (msg.command) {
          case "navigateToIri":
            vscode.commands.executeCommand("modelscript.owl2.goToDeclaration", msg.iri);
            break;
          case "refresh":
            this.update();
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getLoadingHtml();
    this.update();
  }

  public async update(): Promise<void> {
    if (!this._documentUri) return;

    try {
      const data: OWL2DiagramData = await this._client.sendRequest("modelscript/owl2/diagramData", {
        uri: this._documentUri,
      });
      this._panel.webview.html = this.getHtml(data);
    } catch (e) {
      console.error("[owl2-diagram] Error fetching diagram data:", e);
      this._panel.webview.html = this.getErrorHtml(String(e));
    }
  }

  public dispose(): void {
    OWL2DiagramPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { background: #1e1e1e; color: #ccc; font-family: 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top: 3px solid #569cd6;
               border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body><div class="spinner"></div></body>
</html>`;
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { background: #1e1e1e; color: #f48771; font-family: 'Segoe UI', sans-serif;
           padding: 24px; }
  </style>
</head>
<body><h3>⚠ Error loading ontology diagram</h3><pre>${error}</pre></body>
</html>`;
  }

  private getHtml(data: OWL2DiagramData): string {
    const nodesJson = JSON.stringify(data.nodes);
    const edgesJson = JSON.stringify(data.edges);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; color: #e0e0e0; font-family: 'Inter', 'Segoe UI', sans-serif;
           overflow: hidden; height: 100vh; }
    #toolbar { background: #16213e; padding: 8px 16px; display: flex; gap: 8px; align-items: center;
               border-bottom: 1px solid #0f3460; }
    #toolbar button { background: #0f3460; color: #e0e0e0; border: 1px solid #533483; padding: 4px 12px;
                      border-radius: 4px; cursor: pointer; font-size: 12px; }
    #toolbar button:hover { background: #533483; }
    #toolbar .legend { display: flex; gap: 12px; margin-left: auto; font-size: 11px; }
    #toolbar .legend-item { display: flex; align-items: center; gap: 4px; }
    #toolbar .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    #canvas { width: 100%; height: calc(100vh - 42px); }
    svg { width: 100%; height: 100%; }

    /* Node styles */
    .node-class rect { fill: #e74c3c; stroke: #c0392b; rx: 6; ry: 6; }
    .node-class.defined rect { fill: #f39c12; stroke: #e67e22; }
    .node-objectProperty rect { fill: #3498db; stroke: #2980b9; rx: 12; ry: 12; }
    .node-dataProperty rect { fill: #2ecc71; stroke: #27ae60; rx: 4; ry: 4; }
    .node-individual rect { fill: #9b59b6; stroke: #8e44ad; rx: 50%; }
    .node-label { fill: #fff; font-size: 11px; font-weight: 500; text-anchor: middle;
                  dominant-baseline: central; pointer-events: none; }

    /* Edge styles */
    .edge-subClassOf { stroke: #569cd6; stroke-width: 1.5; marker-end: url(#arrowBlue); }
    .edge-equivalentTo { stroke: #f39c12; stroke-width: 1.5; stroke-dasharray: 6,3; }
    .edge-disjointWith { stroke: #e74c3c; stroke-width: 1.5; stroke-dasharray: 3,3; }
    .edge-domain { stroke: #2ecc71; stroke-width: 1; marker-end: url(#arrowGreen); }
    .edge-range { stroke: #e67e22; stroke-width: 1; marker-end: url(#arrowOrange); }
    .edge-objectProperty { stroke: #9b59b6; stroke-width: 1.5; marker-end: url(#arrowPurple); }
    .edge-inverseOf { stroke: #95a5a6; stroke-width: 1; stroke-dasharray: 4,4; }
    .edge-label { fill: #aaa; font-size: 9px; text-anchor: middle; }

    .node-group { cursor: pointer; transition: transform 0.15s ease; }
    .node-group:hover { transform: scale(1.05); }
  </style>
</head>
<body>
  <div id="toolbar">
    <button onclick="resetView()">⟳ Reset</button>
    <button onclick="fitToScreen()">⊞ Fit</button>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#e74c3c"></div>Class</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f39c12"></div>Defined</div>
      <div class="legend-item"><div class="legend-dot" style="background:#3498db"></div>ObjProp</div>
      <div class="legend-item"><div class="legend-dot" style="background:#2ecc71"></div>DataProp</div>
      <div class="legend-item"><div class="legend-dot" style="background:#9b59b6"></div>Individual</div>
    </div>
  </div>
  <div id="canvas"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const nodes = ${nodesJson};
    const edges = ${edgesJson};

    // Simple force-directed layout
    const W = window.innerWidth;
    const H = window.innerHeight - 42;
    const NODE_W = 120;
    const NODE_H = 32;

    // Initialize positions in a circle
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const r = Math.min(W, H) * 0.35;
      n.x = W / 2 + r * Math.cos(angle);
      n.y = H / 2 + r * Math.sin(angle);
      n.vx = 0;
      n.vy = 0;
    });

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Run force simulation
    function simulate(iterations) {
      for (let iter = 0; iter < iterations; iter++) {
        // Repulsion between all nodes
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = 8000 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }
        // Attraction along edges
        for (const e of edges) {
          const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
          if (!a || !b) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 180) * 0.04;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
        // Center gravity
        for (const n of nodes) {
          n.vx += (W / 2 - n.x) * 0.002;
          n.vy += (H / 2 - n.y) * 0.002;
          n.x += n.vx * 0.3;
          n.y += n.vy * 0.3;
          n.vx *= 0.85;
          n.vy *= 0.85;
          // Bounds
          n.x = Math.max(NODE_W / 2 + 10, Math.min(W - NODE_W / 2 - 10, n.x));
          n.y = Math.max(NODE_H / 2 + 50, Math.min(H - NODE_H / 2 - 10, n.y));
        }
      }
    }

    simulate(200);
    render();

    function render() {
      const defs = \`
        <defs>
          <marker id="arrowBlue" viewBox="0 0 10 10" refX="10" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#569cd6"/>
          </marker>
          <marker id="arrowGreen" viewBox="0 0 10 10" refX="10" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2ecc71"/>
          </marker>
          <marker id="arrowOrange" viewBox="0 0 10 10" refX="10" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#e67e22"/>
          </marker>
          <marker id="arrowPurple" viewBox="0 0 10 10" refX="10" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9b59b6"/>
          </marker>
        </defs>\`;

      let edgeSvg = '';
      for (const e of edges) {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        edgeSvg += \`<line x1="\${a.x}" y1="\${a.y}" x2="\${b.x}" y2="\${b.y}" class="edge-\${e.type}"/>\`;
        if (e.label) {
          edgeSvg += \`<text x="\${mx}" y="\${my - 6}" class="edge-label">\${e.label}</text>\`;
        }
      }

      let nodeSvg = '';
      for (const n of nodes) {
        const extra = n.isDefinedClass ? ' defined' : '';
        const shortLabel = n.label.length > 18 ? n.label.slice(0, 16) + '…' : n.label;
        nodeSvg += \`
          <g class="node-group node-\${n.type}\${extra}"
             transform="translate(\${n.x - NODE_W/2}, \${n.y - NODE_H/2})"
             onclick="nodeClick('\${n.id}')">
            <rect width="\${NODE_W}" height="\${NODE_H}" stroke-width="1.5"/>
            <text x="\${NODE_W/2}" y="\${NODE_H/2}" class="node-label">\${shortLabel}</text>
          </g>\`;
      }

      document.getElementById('canvas').innerHTML =
        \`<svg viewBox="0 0 \${W} \${H}">\${defs}\${edgeSvg}\${nodeSvg}</svg>\`;
    }

    function nodeClick(iri) {
      vscode.postMessage({ command: 'navigateToIri', iri });
    }

    function resetView() {
      nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / nodes.length;
        const r = Math.min(W, H) * 0.35;
        n.x = W / 2 + r * Math.cos(angle);
        n.y = H / 2 + r * Math.sin(angle);
        n.vx = 0; n.vy = 0;
      });
      simulate(200);
      render();
    }

    function fitToScreen() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
  }
}
