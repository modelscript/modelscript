// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import { dropComponentGhost, initGraph, renderDiagram, setDiagramOptions } from "@modelscript/diagram-core";

// Add global binding for close button
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("properties-close")?.addEventListener("click", () => {
    document.getElementById("properties-panel")?.classList.remove("open");
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.() ?? {
  postMessage() {
    /* noop fallback */
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pendingDiagramActions: any[] = [];
let diagramActionTimer: ReturnType<typeof setTimeout> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function enqueueDiagramAction(action: any) {
  console.log("[diagram.ts] enqueuing diagram action:", action.type, action);
  pendingDiagramActions.push(action);
  if (diagramActionTimer) clearTimeout(diagramActionTimer);

  const isSpatial = ["move", "resize", "rotate", "moveEdge"].includes(action.type);
  const delay = isSpatial ? 200 : 0;

  diagramActionTimer = setTimeout(() => {
    const actions = pendingDiagramActions;
    pendingDiagramActions = [];
    diagramActionTimer = null;
    if (actions.length > 0) {
      console.log("[diagram.ts] posting diagram edits to host:", actions.length);
      vscode.postMessage({ type: "diagramEdit", actions });
    }
  }, delay);
}

// Global initialization
window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("container");
  if (!container) return;

  const isDark =
    document.documentElement.classList.contains("vscode-dark") ||
    document.documentElement.classList.contains("vscode-high-contrast");

  // Hack to handle VS Code Webview drag-and-drop limitations:
  // 1. Move the ghost during native HTML5 dragover (which suppresses mousemove)
  // 2. Drop the component on global mouseup (because native drop is swallowed by VS Code sandbox)
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__movePlacementGhost) {
      const g = initGraph(isDark);
      if (g) {
        const p = g.clientToLocal(e.clientX, e.clientY);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__movePlacementGhost(p.x, p.y);
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getPlacementData = (window as any).__getPlacementData;
    if (getPlacementData) {
      const placementData = getPlacementData();
      if (placementData && placementData.className) {
        const g = initGraph(isDark);
        if (g) {
          const p = g.clientToLocal(e.clientX, e.clientY);
          dropComponentGhost(g, p.x, p.y, placementData.className, placementData.iconSvg, isDark);
          enqueueDiagramAction({
            type: "addComponent",
            className: placementData.className,
            x: p.x,
            y: p.y,
          });
          // Dispatch Escape to clear the placement state inside diagram-core
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        }
      }
    }
  });

  setDiagramOptions({
    container,
    isDark,
    onAction: enqueueDiagramAction,
    onSelect: (id) => {
      if (!id) {
        document.getElementById("properties-panel")?.classList.remove("open");
      }
    },
    onShowProperties: (nodeId, cachedProps, isLoading) => {
      showProperties({ id: nodeId, properties: cachedProps, isLoading });
      // We moved showProperties into diagram-core but didn't bring the DOM logic
      vscode.postMessage({ type: "getProperties", componentName: nodeId });
    },
    onUndo: () => vscode.postMessage({ type: "undo" }),
    onRedo: () => vscode.postMessage({ type: "redo" }),
  });
});

// Expose render mechanism
window.addEventListener("message", (event) => {
  const message = event.data;
  const isDark =
    document.documentElement.classList.contains("vscode-dark") ||
    document.documentElement.classList.contains("vscode-high-contrast");

  if (message.type === "render") {
    renderDiagram(message.data, isDark);
  } else if (message.type === "startPlacement") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__startPlacement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__startPlacement(message);
    }
  } else if (message.type === "properties") {
    showProperties({ id: message.componentName, properties: message.properties });
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showProperties(nodeData: any) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  const title = document.getElementById("properties-title");
  if (!panel || !content || !title) return;

  const props = nodeData.properties;
  const isLoading = nodeData.isLoading === true;
  title.textContent = props?.className ? props.className.split(".").pop()?.toUpperCase() : "PROPERTIES";

  const loadingSpinner = `<div style="display: flex; align-items: center; gap: 8px; padding: 12px 0; color: var(--vscode-descriptionForeground, #888); font-size: 12px;">
    <div style="width: 14px; height: 14px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
    Loading...
  </div>`;

  const iconContent = isLoading
    ? `<div style="width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;">
        <div style="width: 20px; height: 20px; border: 2px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2)); border-top-color: var(--vscode-foreground, #ccc); border-radius: 50%; animation: diagram-spin 0.7s linear infinite;"></div>
       </div>`
    : props?.iconSvg || "";

  let html = `
    <details open style="margin-bottom: 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 16px;">
      <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground); margin-bottom: 8px; list-style: none;">
        INFORMATION
      </summary>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; flex-direction: row; gap: 24px; align-items: stretch;">
          <div class="prop-icon-wrapper" style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; overflow: hidden;">
            ${iconContent}
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; flex: 1; justify-content: center;">
            <div style="padding: 4px 0;">
              <div class="f6 color-fg-muted" style="line-height: 1.2; font-size: 11px; color: var(--vscode-descriptionForeground, #888);">Type</div>
              <div style="word-break: break-all; line-height: 1.2; padding: 4px 0;">
                ${props?.className || ""}
              </div>
            </div>
            <div>
              <div class="f6 color-fg-muted" style="line-height: 1.2; font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 4px;">Name</div>
              <input type="text" class="prop-input" id="prop-input-name" value="${nodeData.id}" style="width: 100%; border-radius: 4px;" />
            </div>
          </div>
        </div>
  `;

  if (props) {
    const escapedDesc = (props.description || "").replace(/"/g, "&quot;");
    if (props.description) {
      html += `
        <div style="display: flex; flex-direction: column; margin-top: 16px;">
          <label class="prop-label" style="opacity: 0.6; margin-bottom: 6px; width: 100%;">Description</label>
          <textarea class="prop-input" id="prop-input-description" style="width: 100%; border-radius: 4px; resize: vertical; padding: 6px; box-sizing: border-box;" rows="4">${escapedDesc}</textarea>
        </div>
      `;
    } else if (!isLoading) {
      html += `
        <div id="prop-desc-container" style="display: flex; justify-content: center; padding: 16px 0;">
          <button id="prop-btn-add-desc" style="width: 100%; border-radius: 8px; padding: 8px 24px; background: transparent; color: var(--vscode-descriptionForeground, #888); border: 1px solid var(--vscode-dropdown-border, #d0d7de); cursor: pointer;">Add description</button>
        </div>
      `;
    }
  }

  html += `
      </div>
    </details>
  `;

  if (isLoading) {
    // Show loading indicator for parameters and docs sections
    html += loadingSpinner;
  } else if (props) {
    if (props.parameters && props.parameters.length > 0) {
      html += `<div style="margin-top:24px; margin-bottom:12px; font-weight:600; text-transform:uppercase; font-size:11px; color:var(--vscode-sideBarTitle-foreground)">Parameters</div>`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of props.parameters as any[]) {
        const escapedValue = (p.value || "").replace(/"/g, "&quot;");
        const escapedDescParam = (p.description || "").replace(/"/g, "&quot;");
        html += `
          <div class="prop-group">
            <label class="prop-label" title="${escapedDescParam}">${p.name} ${p.unit ? `[${p.unit}]` : ""}</label>
            <input type="text" class="prop-input prop-input-param" data-param="${p.name}" value="${escapedValue}" />
          </div>
        `;
      }
    }

    // Add inline style for images inside docs
    html += `<style>.prop-doc-container img { max-width: 100%; height: auto; }</style>`;

    if (props.docInfo) {
      html += `
        <details open style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
          <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Information</summary>
          <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.4; user-select: text;">
            ${props.docInfo}
          </div>
        </details>
      `;
    }

    if (props.docRevisions) {
      html += `
        <details style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
          <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Revisions</summary>
          <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.4; user-select: text;">
            ${props.docRevisions}
          </div>
        </details>
      `;
    }
  }

  content.innerHTML = html;
  panel.classList.add("open");

  // Bind events
  const nameInput = document.getElementById("prop-input-name") as HTMLInputElement;
  if (nameInput) {
    nameInput.addEventListener("change", (e) => {
      const newName = (e.target as HTMLInputElement).value;
      if (newName && newName !== nodeData.id) {
        enqueueDiagramAction({ type: "updateName", oldName: nodeData.id, newName });
        nodeData.id = newName;
        title.textContent = newName;
      }
    });
  }

  const descInput = document.getElementById("prop-input-description") as HTMLInputElement;
  const bindDescInput = (input: HTMLInputElement) => {
    input.addEventListener("change", (e) => {
      const newDesc = (e.target as HTMLInputElement).value;
      if (props && newDesc !== props.description) {
        enqueueDiagramAction({ type: "updateDescription", name: nodeData.id, description: newDesc });
        props.description = newDesc;
      }
    });
  };

  if (descInput) {
    bindDescInput(descInput);
  }

  const addDescBtn = document.getElementById("prop-btn-add-desc");
  if (addDescBtn) {
    addDescBtn.addEventListener("click", () => {
      const container = document.getElementById("prop-desc-container");
      if (container) {
        container.innerHTML = `
          <div style="display: flex; flex-direction: column; width: 100%;">
            <label class="prop-label" style="opacity: 0.6; margin-bottom: 6px; width: 100%;">Description</label>
            <textarea class="prop-input" id="prop-input-description" style="width: 100%; border-radius: 4px; resize: vertical; padding: 6px; box-sizing: border-box;" rows="4"></textarea>
          </div>
        `;
        const newDescInput = document.getElementById("prop-input-description") as HTMLInputElement;
        if (newDescInput) {
          bindDescInput(newDescInput);
          newDescInput.focus();
        }
      }
    });
  }

  const paramInputs = document.querySelectorAll(".prop-input-param");
  paramInputs.forEach((input) => {
    input.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const paramName = target.getAttribute("data-param");
      const newValue = target.value;
      if (paramName) {
        // Send LSP edit
        enqueueDiagramAction({ type: "updateParameter", name: nodeData.id, parameter: paramName, value: newValue });
        // Optimistically update prop model
        if (props?.parameters) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = props.parameters.find((param: any) => param.name === paramName);
          if (p) p.value = newValue;
        }
      }
    });
  });
}
