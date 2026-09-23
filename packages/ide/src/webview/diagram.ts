// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import { dropComponentGhost, initGraph, setDiagramOptions, updateParameterText } from "@modelscript/diagram";

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

  if (action.type === "interactiveWrite") {
    vscode.postMessage({ type: "interactiveWrite", ...action });
    return;
  }

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
    onSelect: (id: unknown) => {
      if (!id) {
        document.getElementById("properties-panel")?.classList.remove("open");
      }
    },
    onShowProperties: (nodeId: unknown, cachedProps: unknown, isLoading?: boolean) => {
      showProperties({ id: nodeId, properties: cachedProps, isLoading });
      // We moved showProperties into diagram-core but didn't bring the DOM logic
      vscode.postMessage({ type: "getProperties", componentName: nodeId });
    },
    onUndo: () => vscode.postMessage({ type: "undo" }),
    onRedo: () => vscode.postMessage({ type: "redo" }),
    onMessage: (msg) => vscode.postMessage(msg),
  });
});

// The diagram.ts bridge no longer needs its own message listener.
// All message types (diagramData, loading, stopLoading, startPlacement,
// empty, error, componentProperties, autoLayout, setLanguage) are handled
// by @modelscript/diagram's canonical message handler in index.ts.

const nodeActiveTabMap = new Map<string, string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showProperties(nodeData: any) {
  const panel = document.getElementById("properties-panel");
  const content = document.getElementById("properties-content");
  const title = document.getElementById("properties-title");
  if (!panel || !content || !title) return;

  const props = nodeData.properties;
  const isLoading = nodeData.isLoading === true;
  const expectedTitle = props?.className ? props.className.split(".").pop()?.toUpperCase() : "PROPERTIES";

  // Prevent overwriting the DOM if the user is currently typing in an input field for the same component
  if (
    content.contains(document.activeElement) &&
    (document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA" ||
      document.activeElement?.tagName === "SELECT") &&
    title.textContent === expectedTitle &&
    !isLoading
  ) {
    return;
  }

  title.textContent = expectedTitle as string;

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
    html += loadingSpinner;
  } else if (props) {
    const hasSchemaTabs = props.schema?.tabs && props.schema.tabs.length > 0;

    if (hasSchemaTabs) {
      const availableTabs = props.schema.tabs;
      let activeTabId = nodeActiveTabMap.get(nodeData.id);
      if (!activeTabId || !availableTabs.some((t: any) => t.id === activeTabId)) {
        activeTabId = availableTabs[0].id;
        if (activeTabId) {
          nodeActiveTabMap.set(String(nodeData.id), activeTabId);
        }
      }
      const activeTab = availableTabs.find((t: any) => t.id === activeTabId) || availableTabs[0];

      // Tab navigation bar
      html += `
        <div class="prop-tabs-bar" style="display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); margin-top: 12px; margin-bottom: 12px; overflow-x: auto;">
          ${availableTabs
            .map(
              (t: any) => `
            <button class="prop-tab-btn" data-tab="${t.id}" style="padding: 6px 10px; background: transparent; border: none; border-bottom: 2px solid ${t.id === activeTabId ? "var(--vscode-panelTitle-activeBorder, #007acc)" : "transparent"}; color: ${t.id === activeTabId ? "var(--vscode-panelTitle-activeForeground, #fff)" : "var(--vscode-descriptionForeground, #888)"}; cursor: pointer; font-size: 11px; font-weight: 600; white-space: nowrap;">
              ${t.label}
            </button>
          `,
            )
            .join("")}
        </div>
      `;

      // Active tab groups
      if (activeTab && activeTab.groups) {
        for (const group of activeTab.groups) {
          html += `
            <details open style="margin-bottom: 12px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
              <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground); margin-bottom: 8px;">${group.label}</summary>
              <div style="display: flex; flex-direction: column; gap: 8px;">
          `;
          for (const field of group.fields || []) {
            const val = props.values?.[field.key] ?? field.defaultValue ?? "";
            const escapedVal = escapeHtml(val);
            const escapedDesc = escapeHtml(field.description || "");
            const escapedLabel = escapeHtml(field.label);

            let isDisabled = false;
            if (field.enabledIf && props.values) {
              const cond = field.enabledIf.trim();
              if (cond.startsWith("!")) {
                isDisabled = props.values[cond.slice(1)] === true || props.values[cond.slice(1)] === "true";
              } else {
                isDisabled = props.values[cond] === false || props.values[cond] === "false" || !props.values[cond];
              }
            }

            if (field.kind === "boolean") {
              const isChecked = val === true || val === "true";
              html += `
                <div class="prop-group" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <input type="checkbox" class="prop-checkbox prop-input-property" data-prop="${field.key}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""} />
                </div>
              `;
            } else if (field.kind === "choice" && Array.isArray(field.choices)) {
              html += `
                <div class="prop-group" style="opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <select class="prop-select prop-input-property" data-prop="${field.key}" style="width: 100%; border-radius: 4px; padding: 4px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);" ${isDisabled ? "disabled" : ""}>
                    ${field.choices
                      .map((c: any) => {
                        const cVal = typeof c === "string" ? c : c.value;
                        const cLabel = typeof c === "string" ? c : c.label;
                        return `<option value="${escapeHtml(cVal)}" ${String(cVal) === String(val) ? "selected" : ""}>${escapeHtml(cLabel)}</option>`;
                      })
                      .join("")}
                  </select>
                </div>
              `;
            } else if (field.kind === "codeBlock") {
              html += `
                <div class="prop-group" style="display: flex; flex-direction: column; gap: 4px;">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel}</label>
                  <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4; max-height: 200px; overflow-y: auto;">
                    ${escapedVal}
                  </div>
                </div>
              `;
            } else {
              const escapedUnit = field.unit ? `[${escapeHtml(field.unit)}]` : "";
              html += `
                <div class="prop-group" style="opacity: ${isDisabled ? 0.5 : 1};">
                  <label class="prop-label" title="${escapedDesc}">${escapedLabel} ${escapedUnit}</label>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    <input type="text" class="prop-input prop-input-property" data-prop="${field.key}" value="${escapedVal}" ${field.readOnly ? "readonly" : ""} ${isDisabled ? "disabled" : ""} style="flex: 1;" />
                    ${field.unit ? `<span style="font-size: 11px; color: var(--vscode-descriptionForeground);">${escapeHtml(field.unit)}</span>` : ""}
                  </div>
                </div>
              `;
            }
          }
          html += `
              </div>
            </details>
          `;
        }
      }
    } else {
      // Legacy flat parameters fallback
      if (props.parameters && props.parameters.length > 0) {
        html += `<div style="margin-top:24px; margin-bottom:12px; font-weight:600; text-transform:uppercase; font-size:11px; color:var(--vscode-sideBarTitle-foreground)">Parameters</div>`;
        for (const p of props.parameters as any[]) {
          const escapedValue = escapeHtml(p.value || "");
          const escapedDescParam = escapeHtml(p.description || "");
          const escapedParamName = escapeHtml(p.name);
          const escapedUnit = p.unit ? `[${escapeHtml(p.unit)}]` : "";
          html += `
            <div class="prop-group">
              <label class="prop-label" title="${escapedDescParam}">${escapedParamName} ${escapedUnit}</label>
              <input type="text" class="prop-input prop-input-param prop-input-property" data-param="${escapedParamName}" data-prop="${escapedParamName}" value="${escapedValue}" />
            </div>
          `;
        }
      }

      if (props.docInfo) {
        html += `
          <details open style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
            <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Information</summary>
            <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.4; user-select: text;">
              ${escapeHtml(props.docInfo)}
            </div>
          </details>
        `;
      }

      if (props.docRevisions) {
        html += `
          <details style="margin-top: 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); padding-bottom: 8px;">
            <summary style="cursor: pointer; font-weight: 600; text-transform: uppercase; font-size: 11px; color: var(--vscode-sideBarTitle-foreground);">Revisions</summary>
            <div class="prop-doc-container" style="color: var(--vscode-descriptionForeground); margin-top: 8px; line-height: 1.4; user-select: text;">
              ${escapeHtml(props.docRevisions)}
            </div>
          </details>
        `;
      }
    }

    html += `<style>.prop-doc-container img { max-width: 100%; height: auto; }</style>`;
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

  // Bind tab buttons
  const tabBtns = document.querySelectorAll(".prop-tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tabId = (e.currentTarget as HTMLElement).getAttribute("data-tab");
      if (tabId) {
        nodeActiveTabMap.set(String(nodeData.id), tabId);
        showProperties(nodeData);
      }
    });
  });

  // Bind property inputs (inputs, checkboxes, selects)
  const propInputs = document.querySelectorAll(".prop-input-property");
  const propDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  propInputs.forEach((input) => {
    const isCheckbox = (input as HTMLInputElement).type === "checkbox";
    const isSelect = input.tagName === "SELECT";
    const eventType = isCheckbox || isSelect ? "change" : "input";

    input.addEventListener(eventType, (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const propKey = target.getAttribute("data-prop");
      if (!propKey) return;

      const newValue = isCheckbox ? (target as HTMLInputElement).checked : target.value;
      const prevValue = props?.values?.[propKey];

      if (props?.values) {
        props.values[propKey] = newValue;
      }
      if (props?.parameters) {
        const p = props.parameters.find((param: any) => param.name === propKey);
        if (p) p.value = String(newValue);
      }

      // Optimistically patch diagram SVG text in-place
      updateParameterText(nodeData.id, propKey, String(prevValue ?? ""), String(newValue));

      // Live condition evaluation for enabledIf fields in the current DOM
      const allPropInputs = document.querySelectorAll(".prop-input-property");
      allPropInputs.forEach((otherInput) => {
        const otherKey = otherInput.getAttribute("data-prop");
        for (const tab of props?.schema?.tabs || []) {
          for (const grp of tab.groups || []) {
            const f = grp.fields?.find((field: any) => field.key === otherKey);
            if (f?.enabledIf && props.values) {
              const cond = f.enabledIf.trim();
              let disabled = false;
              if (cond.startsWith("!")) {
                disabled = props.values[cond.slice(1)] === true || props.values[cond.slice(1)] === "true";
              } else {
                disabled = props.values[cond] === false || props.values[cond] === "false" || !props.values[cond];
              }
              const parentGroup = otherInput.closest(".prop-group") as HTMLElement | null;
              if (parentGroup) {
                parentGroup.style.opacity = disabled ? "0.5" : "1";
              }
              if (disabled) {
                otherInput.setAttribute("disabled", "");
              } else {
                otherInput.removeAttribute("disabled");
              }
            }
          }
        }
      });

      // Debounce LSP update action
      const timerKey = `${nodeData.id}:${propKey}`;
      const existing = propDebounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);
      propDebounceTimers.set(
        timerKey,
        setTimeout(() => {
          propDebounceTimers.delete(timerKey);
          enqueueDiagramAction({
            type: "updateProperty",
            name: nodeData.id,
            key: propKey,
            value: newValue,
            previousValue: prevValue,
          });
          enqueueDiagramAction({
            type: "updateParameter",
            name: nodeData.id,
            parameter: propKey,
            value: String(newValue),
          });
        }, 100),
      );
    });
  });
}
