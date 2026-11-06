// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Keyed Differential DOM Reconciler for Diagram Properties.
 * Updates DOM elements in-place without destroying the subtree, preserving
 * active input focus, text selection ranges, scroll positions, and details fold states.
 */

import { evaluatePropertyPredicate } from "../property-evaluator.js";
import { validatePropertyValue } from "../property-validator.js";
import type {
  ComponentPropertyData,
  PropertyChoiceOption,
  PropertyFieldConfig,
  PropertyGroupConfig,
  PropertyTabConfig,
} from "../protocol.js";
import type { ConflictManager } from "./conflict-manager.js";

export interface PropertiesReconcilerState {
  nodeId: string;
  data: ComponentPropertyData;
  localValues: Record<string, string>;
  activeTabId?: string;
  filterText?: string;
  conflictManager?: ConflictManager;
}

export interface PropertiesReconcilerHandlers {
  onNameChange?: (newName: string) => void;
  onDescriptionChange?: (newDesc: string) => void;
  onFieldChange?: (fieldKey: string, newValue: string) => void;
  onTabChange?: (tabId: string) => void;
  onFilterChange?: (filterText: string) => void;
  onResolveConflict?: (fieldKey: string, resolution: "keep_local" | "accept_remote") => void;
  onClose?: () => void;
  sanitize?: (html: string) => string;
}

// In-memory UI fold memory per component
const componentFoldState = new Map<string, Record<string, boolean>>();

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUnit(unit?: string): string {
  if (!unit) return "";
  if (unit === "Ohm") return "Ω";
  return unit;
}

export function reconcilePropertiesDOM(
  container: HTMLElement,
  state: PropertiesReconcilerState,
  handlers: PropertiesReconcilerHandlers,
): void {
  const { nodeId, data, localValues } = state;
  const folds = componentFoldState.get(nodeId) ?? { info: true, parameters: true, doc: false, revisions: false };
  componentFoldState.set(nodeId, folds);

  container.classList.add("ms-properties-panel");

  // 1. Header & Information Section
  let header = container.querySelector<HTMLDetailsElement>(".ms-prop-header-section");
  if (!header) {
    header = document.createElement("details");
    header.className = "ms-prop-header-section ms-prop-group";
    header.setAttribute("data-section", "info");
    header.innerHTML = `
      <summary class="ms-prop-group-summary d-flex flex-justify-between flex-items-center" style="display:flex;justify-content:space-between;align-items:center;">
        <span>INFORMATION</span>
        <button type="button" class="ms-prop-btn-close" aria-label="Close" style="background:transparent;border:none;cursor:pointer;color:var(--ms-prop-fg-muted);font-size:14px;padding:2px 6px;">✕</button>
      </summary>
      <div class="ms-prop-header-body" style="display:flex;flex-direction:column;padding:8px 16px;gap:12px;">
        <div style="display:flex;flex-direction:row;gap:20px;align-items:stretch;">
          <div class="ms-prop-icon-wrapper" style="width:80px;height:80px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;"></div>
          <div style="display:flex;flex-direction:column;gap:8px;flex:1;justify-content:center;overflow:hidden;">
            <div>
              <div style="font-size:11px;color:var(--ms-prop-fg-muted);">Type</div>
              <div class="ms-prop-type-display" style="word-break:break-all;font-size:12px;padding:2px 0;"></div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--ms-prop-fg-muted);margin-bottom:2px;">Name</div>
              <input type="text" class="ms-prop-input-name" style="width:100%;border-radius:4px;padding:3px 6px;background:var(--ms-prop-input-bg);color:var(--ms-prop-input-fg);border:1px solid var(--ms-prop-input-border);font-size:12px;box-sizing:border-box;" />
            </div>
          </div>
        </div>
        <div class="ms-prop-desc-container" style="display:flex;flex-direction:column;margin-top:4px;"></div>
      </div>
    `;
    container.appendChild(header);

    const closeBtn = header.querySelector(".ms-prop-btn-close");
    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onClose?.();
    });

    header.addEventListener("toggle", () => {
      folds["info"] = (header as HTMLDetailsElement).open;
    });

    const nameInput = header.querySelector<HTMLInputElement>(".ms-prop-input-name");
    nameInput?.addEventListener("change", (e) => {
      const val = (e.target as HTMLInputElement).value.trim();
      if (val && val !== nodeId) {
        handlers.onNameChange?.(val);
      }
    });
  }

  // Update Header contents in-place
  header.open = folds["info"] ?? true;
  const iconWrapper = header.querySelector<HTMLElement>(".ms-prop-icon-wrapper");
  if (iconWrapper && data.iconSvg && iconWrapper.dataset["svgRaw"] !== data.iconSvg) {
    iconWrapper.innerHTML = data.iconSvg;
    iconWrapper.dataset["svgRaw"] = data.iconSvg;
  }
  const typeDisplay = header.querySelector<HTMLElement>(".ms-prop-type-display");
  if (typeDisplay) {
    typeDisplay.textContent = data.localizedClassName || data.className || "";
  }
  const nameInput = header.querySelector<HTMLInputElement>(".ms-prop-input-name");
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = nodeId;
  }

  // Update Description
  const descContainer = header.querySelector<HTMLElement>(".ms-prop-desc-container");
  if (descContainer) {
    if (data.description) {
      let descArea = descContainer.querySelector<HTMLTextAreaElement>(".ms-prop-input-desc");
      if (!descArea) {
        descContainer.innerHTML = `
          <label style="font-size:11px;color:var(--ms-prop-fg-muted);margin-bottom:4px;">Description</label>
          <textarea class="ms-prop-input-desc" rows="3" style="width:100%;border-radius:4px;padding:4px 6px;background:var(--ms-prop-input-bg);color:var(--ms-prop-input-fg);border:1px solid var(--ms-prop-input-border);font-size:12px;box-sizing:border-box;resize:vertical;"></textarea>
        `;
        descArea = descContainer.querySelector<HTMLTextAreaElement>(".ms-prop-input-desc")!;
        descArea.addEventListener("change", (e) => {
          handlers.onDescriptionChange?.((e.target as HTMLTextAreaElement).value);
        });
      }
      if (document.activeElement !== descArea) {
        descArea.value = data.description;
      }
    } else {
      let addBtn = descContainer.querySelector<HTMLButtonElement>(".ms-prop-btn-add-desc");
      if (!addBtn) {
        descContainer.innerHTML = `
          <button type="button" class="ms-prop-btn-add-desc" style="width:100%;border-radius:4px;padding:6px 12px;background:transparent;color:var(--ms-prop-fg-muted);border:1px dashed var(--ms-prop-border);cursor:pointer;font-size:11px;text-align:center;">
            + Add description
          </button>
        `;
        addBtn = descContainer.querySelector<HTMLButtonElement>(".ms-prop-btn-add-desc")!;
        addBtn.addEventListener("click", () => {
          descContainer.innerHTML = `
            <label style="font-size:11px;color:var(--ms-prop-fg-muted);margin-bottom:4px;">Description</label>
            <textarea class="ms-prop-input-desc" rows="3" autoFocus style="width:100%;border-radius:4px;padding:4px 6px;background:var(--ms-prop-input-bg);color:var(--ms-prop-input-fg);border:1px solid var(--ms-prop-input-border);font-size:12px;box-sizing:border-box;resize:vertical;"></textarea>
          `;
          const area = descContainer.querySelector<HTMLTextAreaElement>(".ms-prop-input-desc")!;
          area.focus();
          area.addEventListener("change", (e) => {
            handlers.onDescriptionChange?.((e.target as HTMLTextAreaElement).value);
          });
        });
      }
    }
  }

  // 2. Tabs or Flat Fallback Normalization
  let availableTabs = (data.schema?.tabs || []).filter((t: PropertyTabConfig) =>
    evaluatePropertyPredicate(t.visibleIf, localValues),
  );

  // If no schema tabs, construct a synthetic tab from data.parameters
  if (availableTabs.length === 0 && data.parameters && data.parameters.length > 0) {
    const syntheticFields: PropertyFieldConfig[] = data.parameters.map((p) => ({
      key: p.name,
      label: p.localizedName || p.name,
      kind: p.isBoolean ? "boolean" : "string",
      defaultValue: p.defaultValue,
      description: p.localizedDescription || p.description,
      unit: p.unit,
    }));
    availableTabs = [
      {
        id: "parameters",
        label: "Parameters",
        groups: [
          {
            id: "parameters_group",
            label: "Parameters",
            fields: syntheticFields,
          },
        ],
      },
    ];
  }

  // Filter bar (show when active tab or component has > 4 total fields)
  const totalFieldCount = availableTabs.reduce(
    (acc, t) => acc + (t.groups || []).reduce((gacc, g) => gacc + (g.fields?.length || 0), 0),
    0,
  );

  let filterBar = container.querySelector<HTMLElement>(".ms-prop-filter-bar");
  if (totalFieldCount > 4) {
    if (!filterBar) {
      filterBar = document.createElement("div");
      filterBar.className = "ms-prop-filter-bar";
      filterBar.style.cssText = "padding: 8px 16px 4px 16px; display: flex;";
      filterBar.innerHTML = `
        <input type="text" class="ms-prop-filter-input" placeholder="Filter parameters..." style="width:100%;border-radius:4px;padding:3px 8px;background:var(--ms-prop-input-bg);color:var(--ms-prop-input-fg);border:1px solid var(--ms-prop-input-border);font-size:11px;box-sizing:border-box;" />
      `;
      const fi = filterBar.querySelector<HTMLInputElement>(".ms-prop-filter-input")!;
      fi.addEventListener("input", () => {
        handlers.onFilterChange?.(fi.value);
      });
      container.appendChild(filterBar);
    }
    const fi = filterBar.querySelector<HTMLInputElement>(".ms-prop-filter-input")!;
    if (document.activeElement !== fi && state.filterText !== undefined) {
      fi.value = state.filterText;
    }
  } else if (filterBar) {
    filterBar.remove();
  }

  // Tabs Bar
  let activeTabId = state.activeTabId ?? availableTabs[0]?.id;
  if (!availableTabs.some((t) => t.id === activeTabId)) {
    activeTabId = availableTabs[0]?.id;
  }

  let tabsBar = container.querySelector<HTMLElement>(".ms-prop-tabs-bar");
  if (!tabsBar && availableTabs.length > 0) {
    tabsBar = document.createElement("div");
    tabsBar.className = "ms-prop-tabs-bar";
    container.appendChild(tabsBar);
  }

  if (tabsBar) {
    if (availableTabs.length <= 1) {
      tabsBar.style.display = "none";
    } else {
      tabsBar.style.display = "flex";
      const existingTabBtns = new Map<string, HTMLButtonElement>();
      tabsBar.querySelectorAll<HTMLButtonElement>(".ms-prop-tab-btn").forEach((btn) => {
        const id = btn.getAttribute("data-tab-id");
        if (id) existingTabBtns.set(id, btn);
      });

      for (const tab of availableTabs) {
        let btn = existingTabBtns.get(tab.id);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ms-prop-tab-btn";
          btn.setAttribute("data-tab-id", tab.id);
          btn.addEventListener("click", () => {
            handlers.onTabChange?.(tab.id);
          });
          tabsBar.appendChild(btn);
        }
        btn.textContent = tab.label;
        btn.classList.toggle("active", tab.id === activeTabId);
        existingTabBtns.delete(tab.id);
      }
      for (const removedBtn of existingTabBtns.values()) {
        removedBtn.remove();
      }
    }
  }

  // 3. Groups & Field Rows in Active Tab
  const activeTab = availableTabs.find((t) => t.id === activeTabId) ?? availableTabs[0];
  let groupsContainer = container.querySelector<HTMLElement>(".ms-prop-groups-container");
  if (!groupsContainer) {
    groupsContainer = document.createElement("div");
    groupsContainer.className = "ms-prop-groups-container";
    container.appendChild(groupsContainer);
  }

  if (activeTab) {
    const activeGroups = (activeTab.groups || []).filter((g: PropertyGroupConfig) =>
      evaluatePropertyPredicate(g.visibleIf, localValues),
    );

    const existingGroups = new Map<string, HTMLDetailsElement>();
    groupsContainer.querySelectorAll<HTMLDetailsElement>(".ms-prop-group-details").forEach((el) => {
      const gid = el.getAttribute("data-group-id");
      if (gid) existingGroups.set(gid, el);
    });

    for (const group of activeGroups) {
      let groupEl = existingGroups.get(group.id);
      if (!groupEl) {
        groupEl = document.createElement("details");
        groupEl.className = "ms-prop-group-details ms-prop-group";
        groupEl.setAttribute("data-group-id", group.id);
        const summary = document.createElement("summary");
        summary.className = "ms-prop-group-summary";
        summary.textContent = group.label;
        const fields = document.createElement("div");
        fields.className = "ms-prop-group-fields";
        fields.style.display = "flex";
        fields.style.flexDirection = "column";
        fields.style.paddingBottom = "8px";
        groupEl.appendChild(summary);
        groupEl.appendChild(fields);
        groupEl.addEventListener("toggle", () => {
          folds[group.id] = groupEl!.open;
        });
        groupsContainer.appendChild(groupEl);
      }
      groupEl.open = folds[group.id] ?? true;
      existingGroups.delete(group.id);

      const fieldsContainer = groupEl.querySelector<HTMLElement>(".ms-prop-group-fields")!;
      reconcileFieldRows(fieldsContainer, group.fields || [], state, handlers);
    }

    for (const removedGroup of existingGroups.values()) {
      removedGroup.remove();
    }
  } else {
    groupsContainer.innerHTML = "";
  }

  // 4. Documentation Section (docInfo or documentation.info)
  const docInfo = data.docInfo || data.documentation?.info;
  let docSection = container.querySelector<HTMLDetailsElement>(".ms-prop-doc-section");
  if (docInfo) {
    if (!docSection) {
      docSection = document.createElement("details");
      docSection.className = "ms-prop-doc-section ms-prop-group";
      docSection.innerHTML = `
        <summary class="ms-prop-group-summary">Information</summary>
        <div class="ms-prop-doc-body" style="padding:8px 16px;font-size:12px;line-height:1.5;color:var(--ms-prop-fg);user-select:text;"></div>
      `;
      docSection.addEventListener("toggle", () => {
        folds["doc"] = docSection!.open;
      });
      container.appendChild(docSection);
    }
    docSection.open = folds["doc"] ?? true;
    const docBody = docSection.querySelector<HTMLElement>(".ms-prop-doc-body")!;
    const safeHtml = handlers.sanitize ? handlers.sanitize(docInfo) : docInfo;
    if (docBody.dataset["raw"] !== docInfo) {
      docBody.innerHTML = safeHtml;
      docBody.dataset["raw"] = docInfo;
    }
  } else if (docSection) {
    docSection.remove();
  }

  // 5. Revisions Section (docRevisions or documentation.revisions)
  const docRevisions = data.docRevisions || data.documentation?.revisions;
  let revSection = container.querySelector<HTMLDetailsElement>(".ms-prop-revisions-section");
  if (docRevisions) {
    if (!revSection) {
      revSection = document.createElement("details");
      revSection.className = "ms-prop-revisions-section ms-prop-group";
      revSection.innerHTML = `
        <summary class="ms-prop-group-summary">Revisions</summary>
        <div class="ms-prop-rev-body" style="padding:8px 16px;font-size:12px;line-height:1.5;color:var(--ms-prop-fg);user-select:text;"></div>
      `;
      revSection.addEventListener("toggle", () => {
        folds["revisions"] = revSection!.open;
      });
      container.appendChild(revSection);
    }
    revSection.open = folds["revisions"] ?? false;
    const revBody = revSection.querySelector<HTMLElement>(".ms-prop-rev-body")!;
    const safeRev = handlers.sanitize ? handlers.sanitize(docRevisions) : docRevisions;
    if (revBody.dataset["raw"] !== docRevisions) {
      revBody.innerHTML = safeRev;
      revBody.dataset["raw"] = docRevisions;
    }
  } else if (revSection) {
    revSection.remove();
  }
}

function reconcileFieldRows(
  container: HTMLElement,
  fields: PropertyFieldConfig[],
  state: PropertiesReconcilerState,
  handlers: PropertiesReconcilerHandlers,
): void {
  const { localValues, filterText, conflictManager } = state;
  const q = (filterText ?? "").toLowerCase().trim();

  const visibleFields = fields.filter((fld) => {
    if (!evaluatePropertyPredicate(fld.visibleIf, localValues)) return false;
    if (!q) return true;
    return (
      fld.key.toLowerCase().includes(q) ||
      (fld.label && fld.label.toLowerCase().includes(q)) ||
      (fld.description && fld.description.toLowerCase().includes(q))
    );
  });

  const existingRows = new Map<string, HTMLElement>();
  container.querySelectorAll<HTMLElement>(".ms-prop-row").forEach((el) => {
    const key = el.getAttribute("data-field-key");
    if (key) existingRows.set(key, el);
  });

  for (const field of visibleFields) {
    const localVal = localValues[field.key] ?? String(field.defaultValue ?? "");
    const defaultVal =
      field.defaultValue !== undefined && field.defaultValue !== null ? String(field.defaultValue) : "";
    const isOverridden = localVal !== "" && localVal !== "-" && defaultVal !== "" && localVal !== defaultVal;
    const isEnabled = evaluatePropertyPredicate(field.enabledIf, localValues) && !field.readOnly;
    const validationErr = validatePropertyValue(field, localVal, localValues);
    const conflict = conflictManager?.getConflict(field.key);

    let row = existingRows.get(field.key);
    if (!row) {
      row = document.createElement("div");
      row.className = "ms-prop-row";
      row.setAttribute("data-field-key", field.key);
      row.innerHTML = `
        <div class="ms-prop-row-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
          <div style="display:flex;align-items:center;max-width:calc(100% - 130px);overflow:hidden;">
            <span class="ms-prop-dot-modified" style="display:none;"></span>
            <label class="ms-prop-label" title="${escapeHtml(field.description || "")}">${escapeHtml(field.label || field.key)}</label>
          </div>
          <div class="ms-prop-row-actions" style="display:flex;align-items:center;gap:4px;">
            <button type="button" class="ms-prop-btn-revert" title="Revert to default" style="display:none;">↺</button>
            <div class="ms-prop-input-slot"></div>
          </div>
        </div>
        <div class="ms-prop-conflict-slot"></div>
        <div class="ms-prop-error-slot" style="color:var(--ms-prop-error);font-size:11px;margin-top:2px;display:none;"></div>
        <div class="ms-prop-desc-slot" style="font-size:11px;color:var(--ms-prop-fg-muted);opacity:0.75;margin-top:2px;line-height:1.35;word-break:break-word;"></div>
      `;

      // Mount input widget
      const inputSlot = row.querySelector<HTMLElement>(".ms-prop-input-slot")!;
      mountInputWidget(
        inputSlot,
        field,
        localVal,
        (newVal) => {
          handlers.onFieldChange?.(field.key, newVal);
        },
        handlers.sanitize,
      );

      // Bind revert button
      const revertBtn = row.querySelector<HTMLButtonElement>(".ms-prop-btn-revert")!;
      revertBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.onFieldChange?.(field.key, defaultVal);
      });

      container.appendChild(row);
    }

    // Update row state in place
    row.classList.toggle("disabled", !isEnabled);

    const dot = row.querySelector<HTMLElement>(".ms-prop-dot-modified")!;
    dot.style.display = isOverridden ? "inline-block" : "none";

    const label = row.querySelector<HTMLElement>(".ms-prop-label")!;
    label.classList.toggle("is-modified", isOverridden);

    const revertBtn = row.querySelector<HTMLButtonElement>(".ms-prop-btn-revert")!;
    revertBtn.style.display = isOverridden ? "inline-block" : "none";

    // Update input value without interrupting active typing
    updateInputWidget(row, field, localVal, isEnabled);

    // Update Conflict slot
    const conflictSlot = row.querySelector<HTMLElement>(".ms-prop-conflict-slot")!;
    if (conflict) {
      conflictSlot.innerHTML = `
        <div class="ms-prop-conflict-banner">
          <span>⚡ External change: <strong>${escapeHtml(conflict.remoteValue)}</strong></span>
          <div style="display:flex;gap:4px;">
            <button type="button" class="ms-prop-btn-conflict" data-action="keep">Keep Mine (${escapeHtml(conflict.localValue)})</button>
            <button type="button" class="ms-prop-btn-conflict" data-action="accept">Use ${escapeHtml(conflict.remoteValue)}</button>
          </div>
        </div>
      `;
      conflictSlot.querySelector('[data-action="keep"]')?.addEventListener("click", () => {
        handlers.onResolveConflict?.(field.key, "keep_local");
      });
      conflictSlot.querySelector('[data-action="accept"]')?.addEventListener("click", () => {
        handlers.onResolveConflict?.(field.key, "accept_remote");
      });
      conflictSlot.style.display = "block";
    } else {
      conflictSlot.innerHTML = "";
      conflictSlot.style.display = "none";
    }

    // Update Validation Error slot
    const errorSlot = row.querySelector<HTMLElement>(".ms-prop-error-slot")!;
    if (validationErr) {
      errorSlot.textContent = validationErr;
      errorSlot.style.display = "block";
    } else {
      errorSlot.style.display = "none";
    }

    // Update Description slot with formula formatting
    const descSlot = row.querySelector<HTMLElement>(".ms-prop-desc-slot")!;
    if (field.description && !descSlot.hasChildNodes()) {
      const formulaMatch = field.description.match(/^(.*?)\s*(\([a-zA-Z0-9_]+\s*=\s*[^)]+\))$/);
      if (formulaMatch) {
        descSlot.innerHTML = `${escapeHtml(formulaMatch[1])} <code style="font-size:10px;padding:1px 4px;border-radius:3px;background:rgba(128,128,128,0.15);font-family:var(--ms-prop-font-mono);">${escapeHtml(formulaMatch[2])}</code>`;
      } else {
        descSlot.textContent = field.description;
      }
    }

    existingRows.delete(field.key);
  }

  for (const removedRow of existingRows.values()) {
    removedRow.remove();
  }
}

function mountInputWidget(
  container: HTMLElement,
  field: PropertyFieldConfig,
  initialVal: string,
  onChange: (val: string) => void,
  sanitize?: (html: string) => string,
): void {
  if (field.kind === "boolean") {
    container.innerHTML = `
      <input type="checkbox" class="ms-prop-input" ${initialVal === "true" || initialVal === "1" ? "checked" : ""} style="cursor:pointer;" />
    `;
    const cb = container.querySelector<HTMLInputElement>("input")!;
    cb.addEventListener("change", () => onChange(cb.checked ? "true" : "false"));
  } else if (field.kind === "choice" && Array.isArray(field.choices)) {
    container.innerHTML = `
      <select class="ms-prop-input" style="width:130px;height:24px;background:var(--ms-prop-dropdown-bg);color:var(--ms-prop-dropdown-fg);border:1px solid var(--ms-prop-dropdown-border);border-radius:4px;padding:2px 4px;font-size:12px;">
        ${field.choices
          .map((c: string | PropertyChoiceOption) => {
            const v = typeof c === "string" ? c : c.value;
            const l = typeof c === "string" ? c : c.label;
            return `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`;
          })
          .join("")}
      </select>
    `;
    const sel = container.querySelector<HTMLSelectElement>("select")!;
    sel.value = initialVal;
    sel.addEventListener("change", () => onChange(sel.value));
  } else if (field.kind === "color") {
    container.innerHTML = `
      <input type="color" class="ms-prop-input" value="${escapeHtml(initialVal || "#000000")}" style="width:36px;height:22px;border:1px solid var(--ms-prop-input-border);background:transparent;cursor:pointer;border-radius:4px;padding:2px;" />
    `;
    const col = container.querySelector<HTMLInputElement>("input")!;
    col.addEventListener("change", () => onChange(col.value));
  } else if (field.kind === "html" || field.kind === "codeBlock") {
    const raw = String(initialVal || "");
    const safe = sanitize ? sanitize(raw) : escapeHtml(raw);
    container.innerHTML = `
      <div class="ms-prop-doc-container" style="color:var(--ms-prop-fg);font-size:12px;line-height:1.5;max-height:200px;overflow-y:auto;user-select:text;">${safe}</div>
    `;
  } else {
    const unitFormatted = formatUnit(field.unit);
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="${field.kind === "number" ? "number" : "text"}" class="ms-prop-input" value="${escapeHtml(initialVal)}" style="width:120px;height:22px;border-radius:4px;padding:2px 6px;background:var(--ms-prop-input-bg);color:var(--ms-prop-input-fg);border:1px solid var(--ms-prop-input-border);font-size:12px;box-sizing:border-box;" />
        ${unitFormatted ? `<span style="font-size:11px;color:var(--ms-prop-fg-muted);white-space:nowrap;">${escapeHtml(unitFormatted)}</span>` : ""}
      </div>
    `;
    const inp = container.querySelector<HTMLInputElement>("input")!;
    let debounceTimer: ReturnType<typeof setTimeout>;
    inp.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(inp.value), 120);
    });
    inp.addEventListener("change", () => onChange(inp.value));
  }
}

function updateInputWidget(row: HTMLElement, field: PropertyFieldConfig, currentVal: string, isEnabled: boolean): void {
  const input = row.querySelector<HTMLInputElement | HTMLSelectElement>(".ms-prop-input");
  if (!input) return;

  input.disabled = !isEnabled;

  if (document.activeElement === input) {
    return; // Don't interrupt user typing
  }

  if (field.kind === "boolean") {
    (input as HTMLInputElement).checked = currentVal === "true" || currentVal === "1";
  } else {
    if (input.value !== currentVal) {
      input.value = currentVal;
    }
  }
}
