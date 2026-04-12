// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Analysis webview renderer — handles BLT incidence matrix and class hierarchy tree views.
// Receives data via postMessage from the extension host (AnalysisPanel).

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
};

(function () {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _vscode = acquireVsCodeApi();

  const contentEl = document.getElementById("content") as HTMLElement;
  const placeholderEl = document.getElementById("placeholder") as HTMLElement;
  const tooltipEl = document.getElementById("tooltip") as HTMLElement;

  // ── Kind → icon mapping ──
  const kindIcons: Record<string, string> = {
    model: "📦",
    block: "🧱",
    connector: "🔌",
    record: "📋",
    type: "🏷️",
    package: "📁",
    function: "⚡",
    class: "📐",
    operator: "🔧",
  };

  // ── BLT Matrix Renderer ──

  interface BltData {
    className: string;
    variables: string[];
    equations: string[];
    algebraicLoops: { variables: string[]; equations: string[] }[];
    equationCount: number;
    unknownCount: number;
  }

  function renderBlt(data: BltData): void {
    placeholderEl.style.display = "none";
    contentEl.innerHTML = "";

    // Stats cards
    const statsHtml = `
    <h2>Equation System — ${escapeHtml(data.className)}</h2>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Equations</div>
        <div class="stat-value">${data.equationCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unknowns</div>
        <div class="stat-value">${data.unknownCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Algebraic Loops</div>
        <div class="stat-value ${data.algebraicLoops.length > 0 ? "warning" : "success"}">${data.algebraicLoops.length > 0 ? data.algebraicLoops.length : "None ✓"}</div>
      </div>
    </div>
  `;

    // Build incidence matrix from equation JSON
    const nEqs = data.equations.length;
    const nVars = data.variables.length;

    // Build a set of loop variables for highlighting
    const loopVarSet = new Set<string>();
    for (const loop of data.algebraicLoops) {
      for (const v of loop.variables) {
        loopVarSet.add(v);
      }
    }

    // Build incidence: for each equation, find which variables it references
    const incidence: boolean[][] = [];
    for (let i = 0; i < nEqs; i++) {
      const row: boolean[] = [];
      const eqText = data.equations[i];
      for (let j = 0; j < nVars; j++) {
        // Simple text containment check for variable name in equation text
        row.push(eqText.includes(`"${data.variables[j]}"`) || eqText.includes(data.variables[j]));
      }
      incidence.push(row);
    }

    // Limit display for very large systems
    const maxDisplay = 50;
    const displayEqs = Math.min(nEqs, maxDisplay);
    const displayVars = Math.min(nVars, maxDisplay);
    const truncated = nEqs > maxDisplay || nVars > maxDisplay;

    // Build table HTML
    let tableHtml = `<div id="blt-container"><div class="matrix-wrapper"><table class="matrix">`;

    // Column headers (variable names)
    tableHtml += "<thead><tr><th></th>";
    for (let j = 0; j < displayVars; j++) {
      const name = truncateName(data.variables[j], 12);
      const full = escapeHtml(data.variables[j]);
      tableHtml += `<th class="col-header" title="${full}">${escapeHtml(name)}</th>`;
    }
    if (truncated) tableHtml += `<th class="col-header">…</th>`;
    tableHtml += "</tr></thead><tbody>";

    // Rows (equations)
    for (let i = 0; i < displayEqs; i++) {
      const eqLabel = `eq${i + 1}`;
      tableHtml += `<tr><th title="${escapeHtml(data.equations[i])}">${eqLabel}</th>`;
      for (let j = 0; j < displayVars; j++) {
        const filled = incidence[i]?.[j] ?? false;
        const isLoop = filled && loopVarSet.has(data.variables[j]);
        const cls = filled ? (isLoop ? "filled loop" : "filled") : "";
        tableHtml += `<td class="${cls}" data-eq="${i}" data-var="${j}"></td>`;
      }
      if (truncated) tableHtml += "<td></td>";
      tableHtml += "</tr>";
    }
    if (truncated) {
      tableHtml += `<tr><th>…</th>`;
      for (let j = 0; j <= displayVars; j++) tableHtml += "<td></td>";
      tableHtml += "</tr>";
    }
    tableHtml += "</tbody></table></div></div>";

    // Algebraic loops detail
    let loopHtml = "";
    if (data.algebraicLoops.length > 0) {
      loopHtml = `<h2 style="margin-top:20px">Algebraic Loops</h2>`;
      for (let i = 0; i < data.algebraicLoops.length; i++) {
        const loop = data.algebraicLoops[i];
        loopHtml += `
        <div class="stat-card" style="margin-bottom:8px">
          <div class="stat-label">Loop ${i + 1} (size ${loop.variables.length})</div>
          <div style="margin-top:4px;font-size:12px">${loop.variables.map((v) => `<code>${escapeHtml(v)}</code>`).join(", ")}</div>
        </div>`;
      }
    }

    contentEl.innerHTML = statsHtml + tableHtml + loopHtml;

    // Tooltip on hover
    const cells = contentEl.querySelectorAll("td[data-eq]");
    cells.forEach((cell) => {
      cell.addEventListener("mouseenter", (e) => {
        const el = e.target as HTMLElement;
        const eqIdx = parseInt(el.getAttribute("data-eq") || "0");
        const varIdx = parseInt(el.getAttribute("data-var") || "0");
        const varName = data.variables[varIdx] || "?";
        const filled = el.classList.contains("filled");
        tooltipEl.innerHTML = `<strong>eq${eqIdx + 1}</strong> × <strong>${escapeHtml(varName)}</strong>${filled ? " — <em>depends</em>" : ""}`;
        tooltipEl.style.display = "block";
        const rect = el.getBoundingClientRect();
        tooltipEl.style.left = `${rect.right + 8}px`;
        tooltipEl.style.top = `${rect.top}px`;
      });
      cell.addEventListener("mouseleave", () => {
        tooltipEl.style.display = "none";
      });
    });
  }

  // ── Class Hierarchy Renderer ──

  interface HierarchyNode {
    name: string;
    kind: string;
    description: string | null;
    children: HierarchyNode[];
  }

  function renderHierarchy(data: HierarchyNode): void {
    placeholderEl.style.display = "none";
    contentEl.innerHTML = "";

    const header = document.createElement("h2");
    header.textContent = `Class Hierarchy — ${data.name}`;
    contentEl.appendChild(header);

    const tree = buildTreeNode(data, true);
    contentEl.appendChild(tree);
  }

  function buildTreeNode(node: HierarchyNode, expanded: boolean): HTMLElement {
    const container = document.createElement("div");
    container.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";

    const hasChildren = node.children.length > 0;

    // Toggle
    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = hasChildren ? (expanded ? "▼" : "▶") : "  ";
    row.appendChild(toggle);

    // Icon
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.textContent = kindIcons[node.kind] || "📐";
    row.appendChild(icon);

    // Name
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = node.name;
    row.appendChild(name);

    // Kind badge
    const kind = document.createElement("span");
    kind.className = "tree-kind";
    kind.textContent = node.kind;
    row.appendChild(kind);

    // Description
    if (node.description) {
      const desc = document.createElement("span");
      desc.className = "tree-desc";
      desc.textContent = ` — ${node.description}`;
      row.appendChild(desc);
    }

    container.appendChild(row);

    // Children
    if (hasChildren) {
      const childContainer = document.createElement("div");
      childContainer.className = "tree-children";
      childContainer.style.display = expanded ? "block" : "none";

      const extendsLabel = document.createElement("div");
      extendsLabel.className = "tree-extends-label";
      extendsLabel.textContent = "extends";
      childContainer.appendChild(extendsLabel);

      for (const child of node.children) {
        childContainer.appendChild(buildTreeNode(child, true));
      }
      container.appendChild(childContainer);

      // Toggle collapse
      toggle.addEventListener("click", () => {
        const visible = childContainer.style.display !== "none";
        childContainer.style.display = visible ? "none" : "block";
        toggle.textContent = visible ? "▶" : "▼";
      });

      row.addEventListener("dblclick", () => {
        const visible = childContainer.style.display !== "none";
        childContainer.style.display = visible ? "none" : "block";
        toggle.textContent = visible ? "▶" : "▼";
      });
    }

    return container;
  }

  // ── Utilities ──

  function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function truncateName(name: string, maxLen: number): string {
    if (name.length <= maxLen) return name;
    // Show last segment of dotted name
    const parts = name.split(".");
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      return last.length <= maxLen ? last : last.substring(0, maxLen - 1) + "…";
    }
    return name.substring(0, maxLen - 1) + "…";
  }

  // ── Component Tree Renderer ──

  interface ComponentNode {
    name: string;
    typeName: string;
    kind: string;
    variability: string | null;
    causality: string | null;
    description: string | null;
    children: ComponentNode[];
  }

  const variabilityIcons: Record<string, string> = {
    parameter: "⚙️",
    constant: "🔒",
    discrete: "🎯",
  };

  function renderComponentTree(data: ComponentNode): void {
    placeholderEl.style.display = "none";
    contentEl.innerHTML = "";

    const header = document.createElement("h2");
    header.textContent = `Component Tree — ${data.name}`;
    contentEl.appendChild(header);

    // Stats
    const totalComponents = countNodes(data) - 1; // exclude root
    const statsDiv = document.createElement("div");
    statsDiv.className = "stats";
    statsDiv.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Components</div>
        <div class="stat-value">${totalComponents}</div>
      </div>
    `;
    contentEl.appendChild(statsDiv);

    const tree = buildComponentNode(data, true);
    contentEl.appendChild(tree);
  }

  function countNodes(node: ComponentNode): number {
    let count = 1;
    for (const child of node.children) {
      count += countNodes(child);
    }
    return count;
  }

  function buildComponentNode(node: ComponentNode, expanded: boolean): HTMLElement {
    const container = document.createElement("div");
    container.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";

    const hasChildren = node.children.length > 0;

    // Toggle
    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = hasChildren ? (expanded ? "▼" : "▶") : "  ";
    row.appendChild(toggle);

    // Kind icon
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    if (node.variability && variabilityIcons[node.variability]) {
      icon.textContent = variabilityIcons[node.variability];
    } else {
      icon.textContent = kindIcons[node.kind] || "📦";
    }
    row.appendChild(icon);

    // Name
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = node.name;
    row.appendChild(name);

    // Type badge
    const typeBadge = document.createElement("span");
    typeBadge.className = "tree-kind";
    typeBadge.textContent = node.typeName;
    row.appendChild(typeBadge);

    // Causality badge
    if (node.causality) {
      const causalityBadge = document.createElement("span");
      causalityBadge.className = "tree-kind";
      causalityBadge.style.background = node.causality === "input" ? "#1a7f37" : "#0550ae";
      causalityBadge.style.color = "#fff";
      causalityBadge.textContent = node.causality;
      row.appendChild(causalityBadge);
    }

    // Description
    if (node.description) {
      const desc = document.createElement("span");
      desc.className = "tree-desc";
      desc.textContent = ` — ${node.description}`;
      row.appendChild(desc);
    }

    container.appendChild(row);

    // Children
    if (hasChildren) {
      const childContainer = document.createElement("div");
      childContainer.className = "tree-children";
      childContainer.style.display = expanded ? "block" : "none";

      for (const child of node.children) {
        childContainer.appendChild(buildComponentNode(child, node.children.length < 20));
      }
      container.appendChild(childContainer);

      toggle.addEventListener("click", () => {
        const visible = childContainer.style.display !== "none";
        childContainer.style.display = visible ? "none" : "block";
        toggle.textContent = visible ? "▶" : "▼";
      });

      row.addEventListener("dblclick", () => {
        const visible = childContainer.style.display !== "none";
        childContainer.style.display = visible ? "none" : "block";
        toggle.textContent = visible ? "▶" : "▼";
      });
    }

    return container;
  }

  // ── Message Handler ──

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "bltData":
        renderBlt(msg.data);
        break;
      case "hierarchyData":
        renderHierarchy(msg.data);
        break;
      case "componentTreeData":
        renderComponentTree(msg.data);
        break;
    }
  });
})(); // end IIFE
