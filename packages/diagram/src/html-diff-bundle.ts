// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Standalone Interactive HTML Bundle Serializer for ModelScript Visual PR Diffs.
// Produces a self-contained, single-file HTML report with interactive pan/zoom,
// unified overlay / side-by-side mode switching, property delta inspector, and theme toggling.
// Zero external CDN or internet dependencies.

import { renderPolyglotDiagramToSvg } from "./svg-renderer.js";
import type { VisualDiffData } from "./visual-diff-graph.js";
import { renderVisualDiffToSvg, type VisualDiffSvgOptions } from "./visual-diff-renderer.js";

export interface VisualDiffHtmlOptions extends VisualDiffSvgOptions {
  title?: string;
  repoName?: string;
  baseRef?: string;
  headRef?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Serializes VisualDiffData into a self-contained, zero-dependency interactive HTML bundle.
 */
export function renderVisualDiffToHtml(diffData: VisualDiffData, options: VisualDiffHtmlOptions = {}): string {
  const title = options.title || "ModelScript Visual Model Diff";
  const repoName = options.repoName || "Model Repository";
  const baseRef = options.baseRef || "Base (main)";
  const headRef = options.headRef || "Head (PR Branch)";

  const unifiedSvg = renderVisualDiffToSvg(diffData, { ...options, showStatsBanner: false });
  const baseSvg = diffData.baseDiagram ? renderPolyglotDiagramToSvg(diffData.baseDiagram, options) : "";
  const headSvg = diffData.headDiagram ? renderPolyglotDiagramToSvg(diffData.headDiagram, options) : "";

  // Prepare property change JSON payload for the interactive drawer
  const modifiedDetails = diffData.nodes
    .filter((n) => n.diffStatus === "modified" && n.propertyChanges && n.propertyChanges.length > 0)
    .map((n) => ({
      id: n.id,
      name: n.properties?.values?.name || n.id,
      isBreaking: n.isBreaking,
      changes: n.propertyChanges,
    }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - ${escapeHtml(repoName)}</title>
  <style>
    :root {
      --bg: #090d16;
      --surface: #111827;
      --surface-border: #1f2937;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --accent-added: #22c55e;
      --accent-deleted: #ef4444;
      --accent-modified: #f59e0b;
      --accent-breaking: #dc2626;
      --canvas-bg: #030712;
    }
    body.light {
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --canvas-bg: #f1f5f9;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    
    /* Top Navigation Header */
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--surface-border);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      z-index: 10;
    }
    .header-left { display: flex; align-items: center; gap: 16px; }
    .header-title { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .ref-badge { font-size: 12px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 3px 8px; border-radius: 6px; font-mono: monospace; }
    
    /* Stats Bar */
    .stats-pills { display: flex; gap: 8px; align-items: center; }
    .pill { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; display: flex; align-items: center; gap: 4px; }
    .pill-added { background: rgba(34, 197, 94, 0.15); color: var(--accent-added); border: 1px solid rgba(34, 197, 94, 0.3); }
    .pill-deleted { background: rgba(239, 68, 68, 0.15); color: var(--accent-deleted); border: 1px solid rgba(239, 68, 68, 0.3); }
    .pill-modified { background: rgba(245, 158, 11, 0.15); color: var(--accent-modified); border: 1px solid rgba(245, 158, 11, 0.3); }
    .pill-breaking { background: var(--accent-breaking); color: #ffffff; }

    /* Controls */
    .controls { display: flex; gap: 10px; align-items: center; }
    .btn-group { display: flex; background: var(--surface-border); border-radius: 6px; padding: 2px; }
    .btn { background: none; border: none; color: var(--text-muted); font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: 4px; cursor: pointer; transition: all 0.15s; }
    .btn.active, .btn:hover { background: var(--surface); color: var(--text); }
    .icon-btn { background: var(--surface); border: 1px solid var(--surface-border); color: var(--text); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .icon-btn:hover { background: var(--surface-border); }

    /* Main Canvas Area */
    main { flex: 1; position: relative; overflow: hidden; background: var(--canvas-bg); }
    .viewport { width: 100%; height: 100%; cursor: grab; display: flex; justify-content: center; align-items: center; }
    .viewport:active { cursor: grabbing; }
    .svg-container { transform-origin: 0 0; transition: transform 0.05s ease-out; }
    .svg-container svg { max-width: none; max-height: none; display: block; }

    /* Side-by-Side Dual View */
    .side-by-side-container { display: none; width: 100%; height: 100%; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--surface-border); }
    .pane { position: relative; background: var(--canvas-bg); overflow: hidden; }
    .pane-header { position: absolute; top: 12px; left: 16px; background: var(--surface); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid var(--surface-border); z-index: 5; }

    /* Property Inspector Drawer */
    #property-drawer {
      position: absolute;
      right: -360px;
      top: 0;
      width: 350px;
      height: 100%;
      background: var(--surface);
      border-left: 1px solid var(--surface-border);
      box-shadow: -4px 0 20px rgba(0,0,0,0.4);
      transition: right 0.25s ease;
      display: flex;
      flex-direction: column;
      z-index: 20;
    }
    #property-drawer.open { right: 0; }
    .drawer-header { padding: 16px; border-bottom: 1px solid var(--surface-border); display: flex; justify-content: space-between; align-items: center; }
    .drawer-body { flex: 1; overflow-y: auto; padding: 16px; font-size: 13px; }
    .diff-prop-row { margin-bottom: 12px; padding: 8px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid var(--surface-border); }
    .diff-prop-key { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; }
    .val-old { color: var(--accent-deleted); text-decoration: line-through; }
    .val-new { color: var(--accent-added); font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <div class="header-title">
        <span>⚡ ${escapeHtml(title)}</span>
        <span class="ref-badge">${escapeHtml(baseRef)} ➔ ${escapeHtml(headRef)}</span>
      </div>
      <div class="stats-pills">
        <span class="pill pill-added">+${diffData.stats.addedNodes} Added</span>
        <span class="pill pill-deleted">−${diffData.stats.deletedNodes} Deleted</span>
        <span class="pill pill-modified">~${diffData.stats.modifiedNodes} Modified</span>
        ${diffData.stats.breakingChanges > 0 ? `<span class="pill pill-breaking">⚠ ${diffData.stats.breakingChanges} Breaking</span>` : ""}
      </div>
    </div>
    <div class="controls">
      <div class="btn-group">
        <button id="btn-unified" class="btn active" onclick="setViewMode('unified')">Unified Overlay</button>
        <button id="btn-split" class="btn" onclick="setViewMode('split')">Side-by-Side</button>
      </div>
      <button class="icon-btn" onclick="zoomIn()">➕ Zoom In</button>
      <button class="icon-btn" onclick="zoomOut()">➖ Zoom Out</button>
      <button class="icon-btn" onclick="resetZoom()">⟲ Reset</button>
      <button class="icon-btn" onclick="toggleTheme()">🌓 Theme</button>
      <button class="icon-btn" onclick="copyMarkdownSummary()">📋 Copy Summary</button>
    </div>
  </header>

  <main>
    <!-- Unified Overlay View -->
    <div id="unified-viewport" class="viewport">
      <div id="unified-container" class="svg-container">
        ${unifiedSvg}
      </div>
    </div>

    <!-- Side-by-Side View -->
    <div id="split-viewport" class="side-by-side-container">
      <div class="pane" id="pane-left">
        <div class="pane-header">Base: ${escapeHtml(baseRef)}</div>
        <div class="viewport" id="viewport-left">
          <div class="svg-container" id="container-left">${baseSvg}</div>
        </div>
      </div>
      <div class="pane" id="pane-right">
        <div class="pane-header">Head: ${escapeHtml(headRef)}</div>
        <div class="viewport" id="viewport-right">
          <div class="svg-container" id="container-right">${headSvg}</div>
        </div>
      </div>
    </div>

    <!-- Property Delta Drawer -->
    <div id="property-drawer">
      <div class="drawer-header">
        <strong id="drawer-node-name">Element Properties</strong>
        <button class="btn" onclick="closeDrawer()">✕</button>
      </div>
      <div class="drawer-body" id="drawer-content">
        Select a modified node to inspect property differences.
      </div>
    </div>
  </main>

  <script>
    const modifiedChanges = ${JSON.stringify(modifiedDetails)};
    let currentScale = 1.0;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const uContainer = document.getElementById("unified-container");
    const cLeft = document.getElementById("container-left");
    const cRight = document.getElementById("container-right");

    function updateTransform() {
      const transform = "translate(" + translateX + "px, " + translateY + "px) scale(" + currentScale + ")";
      if (uContainer) uContainer.style.transform = transform;
      if (cLeft) cLeft.style.transform = transform;
      if (cRight) cRight.style.transform = transform;
    }

    function zoomIn() { currentScale = Math.min(currentScale * 1.25, 5); updateTransform(); }
    function zoomOut() { currentScale = Math.max(currentScale / 1.25, 0.2); updateTransform(); }
    function resetZoom() { currentScale = 1.0; translateX = 0; translateY = 0; updateTransform(); }

    function setViewMode(mode) {
      document.getElementById("btn-unified").classList.toggle("active", mode === "unified");
      document.getElementById("btn-split").classList.toggle("active", mode === "split");
      document.getElementById("unified-viewport").style.display = mode === "unified" ? "flex" : "none";
      document.getElementById("split-viewport").style.display = mode === "split" ? "grid" : "none";
    }

    function toggleTheme() { document.body.classList.toggle("light"); }

    function copyMarkdownSummary() {
      const md = "### 🔍 ModelScript SysML v2 Visual Diff Summary\\n" +
        "- **Added Elements**: +${diffData.stats.addedNodes}\\n" +
        "- **Deleted Elements**: −${diffData.stats.deletedNodes}\\n" +
        "- **Modified Elements**: ~${diffData.stats.modifiedNodes}\\n" +
        "- **Breaking Changes**: ${diffData.stats.breakingChanges > 0 ? "⚠️ " + diffData.stats.breakingChanges : "None"}\\n";
      navigator.clipboard.writeText(md).then(() => alert("Summary copied to clipboard!"));
    }

    // Pan interaction
    document.querySelectorAll(".viewport").forEach(vp => {
      vp.addEventListener("mousedown", (e) => {
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
      });
      window.addEventListener("mouseup", () => { isDragging = false; });
      vp.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateTransform();
      });
      vp.addEventListener("wheel", (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        currentScale = Math.max(0.2, Math.min(5, currentScale * factor));
        updateTransform();
      }, { passive: false });
    });

    // Node click inspector
    document.querySelectorAll(".diff-node").forEach((nodeEl, idx) => {
      nodeEl.style.cursor = "pointer";
      nodeEl.addEventListener("click", () => {
        const item = modifiedChanges[idx];
        if (item) {
          document.getElementById("drawer-node-name").innerText = item.name;
          const html = item.changes.map(c => \`
            <div class="diff-prop-row">
              <div class="diff-prop-key">
                <span>\${c.key}</span>
                \${c.isBreaking ? '<span class="pill pill-breaking" style="font-size:9px">BREAKING</span>' : ''}
              </div>
              <div>Old: <span class="val-old">\${JSON.stringify(c.oldValue ?? '')}</span></div>
              <div>New: <span class="val-new">\${JSON.stringify(c.newValue ?? '')}</span></div>
            </div>
          \`).join("");
          document.getElementById("drawer-content").innerHTML = html;
          document.getElementById("property-drawer").classList.add("open");
        }
      });
    });

    function closeDrawer() { document.getElementById("property-drawer").classList.remove("open"); }
  </script>
</body>
</html>`;
}
