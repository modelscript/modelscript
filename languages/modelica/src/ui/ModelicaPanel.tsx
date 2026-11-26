// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelBltView,
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { applyEditsToText, computeComponentInsert, computeParameterEdit } from "../diagram/edits.js";
import {
  buildModelicaDiagramSvg,
  MODELICA_LIBRARY_CATALOG,
  parseModelicaModelForPanel,
  type ModelicaComponentInfo,
  type ModelicaLibraryItem,
} from "./modelica-analysis.js";

type ModelicaTabId = "diagram" | "properties" | "components" | "library" | "blt";

const TAB_ITEMS: { id: ModelicaTabId; label: string }[] = [
  { id: "diagram", label: "Diagram" },
  { id: "properties", label: "Properties" },
  { id: "components", label: "Components" },
  { id: "library", label: "Library" },
  { id: "blt", label: "BLT" },
];

export const ModelicaPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen = false, host }) => {
  const [activeTab, setActiveTab] = useState<ModelicaTabId>("diagram");
  const [canvasThemeOverride, setCanvasThemeOverride] = useState<"light" | "dark" | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [libQuery, setLibQuery] = useState("");
  const [libDomain, setLibDomain] = useState<string>("all");
  const [newModName, setNewModName] = useState("");
  const [newModValue, setNewModValue] = useState("");
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const canvasTheme = canvasThemeOverride ?? colorMode;

  const model = useMemo(() => parseModelicaModelForPanel(code), [code]);

  const effectiveSelected: ModelicaComponentInfo | null = useMemo(() => {
    if (selectedName) {
      const found = model.components.find((c) => c.name === selectedName);
      if (found) return found;
    }
    return model.components[0] ?? null;
  }, [model.components, selectedName]);

  const diagram = useMemo(
    () => buildModelicaDiagramSvg(model, effectiveSelected?.name ?? null, canvasTheme === "dark"),
    [model, effectiveSelected?.name, canvasTheme],
  );

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const paramCount = model.components.filter(
      (c) => c.variability === "parameter" || c.variability === "constant",
    ).length;
    const bltTone: PanelKpiItem["tone"] =
      model.blt.status === "balanced" ? "success" : model.blt.status === "empty" ? "neutral" : "warning";

    return [
      { label: "Class", value: model.className, tone: "info" },
      { label: "Components", value: String(model.components.length), tone: "neutral" },
      { label: "Parameters", value: String(paramCount), tone: "neutral" },
      { label: "Connects", value: String(model.connects.length), tone: "neutral" },
      {
        label: "BLT Balance",
        value:
          model.blt.status === "empty"
            ? `${model.equations.length} eqs`
            : `${model.blt.unknowns.length}v / ${model.blt.equations.length}e`,
        tone: bltTone,
      },
    ];
  }, [model]);

  const domains = useMemo(() => {
    const set = new Set(MODELICA_LIBRARY_CATALOG.map((item) => item.domain));
    return ["all", ...Array.from(set)];
  }, []);

  const filteredLibrary = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    return MODELICA_LIBRARY_CATALOG.filter((item) => {
      if (libDomain !== "all" && item.domain !== libDomain) return false;
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        item.className.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.domain.toLowerCase().includes(q)
      );
    });
  }, [libQuery, libDomain]);

  const handleApplyModifier = (compName: string, paramName: string, paramValue: string) => {
    if (!paramName.trim() || !paramValue.trim()) return;
    if (!host?.onCodeChange) {
      setStatusMessage("Host does not support live code updates.");
      return;
    }
    if (!model.classInstance) {
      setStatusMessage("No active Modelica class found to edit.");
      return;
    }
    const edits = computeParameterEdit(model.classInstance, compName, paramName.trim(), paramValue.trim(), code);
    if (edits.length === 0) {
      setStatusMessage(`Could not compute edit for ${compName}.${paramName}`);
      return;
    }
    const nextCode = applyEditsToText(code, edits);
    host.onCodeChange(nextCode);
    setStatusMessage(`Updated ${compName}(${paramName.trim()} = ${paramValue.trim()})`);
  };

  const handleInsertLibraryItem = (item: ModelicaLibraryItem) => {
    if (!host?.onCodeChange) {
      setStatusMessage("Host does not support inserting components.");
      return;
    }
    const existingNames = new Set(model.components.map((c) => c.name));
    let idx = 1;
    let candidate = `${item.defaultPrefix}${idx}`;
    while (existingNames.has(candidate)) {
      idx++;
      candidate = `${item.defaultPrefix}${idx}`;
    }

    const offsetIdx = model.components.length;
    const x = -60 + (offsetIdx % 4) * 40;
    const y = 40 - Math.floor(offsetIdx / 4) * 40;

    if (model.classInstance) {
      const edits = computeComponentInsert(model.classInstance, item.className, candidate, x, y, code);
      if (edits.length > 0) {
        let nextCode = applyEditsToText(code, edits);
        if (item.defaultParams) {
          nextCode = nextCode.replace(
            `${item.className} ${candidate} `,
            `${item.className} ${candidate}(${item.defaultParams}) `,
          );
        }
        host.onCodeChange(nextCode);
        setSelectedName(candidate);
        setStatusMessage(`Inserted ${candidate} (${item.label})`);
        return;
      }
    }

    // Fallback insertion before equation/end if classInstance wasn't parsed
    const declLine = `  ${item.className} ${candidate}${item.defaultParams ? `(${item.defaultParams})` : ""};\n`;
    const eqPos = code.search(/^\s*equation\b/m);
    const endPos = code.search(/^\s*end\s+[a-zA-Z_]/m);
    const insertAt = eqPos !== -1 ? eqPos : endPos !== -1 ? endPos : code.length;
    const nextCode = `${code.slice(0, insertAt)}${declLine}${code.slice(insertAt)}`;
    host.onCodeChange(nextCode);
    setSelectedName(candidate);
    setStatusMessage(`Inserted ${candidate} (${item.label})`);
  };

  const handleDiagramClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const group = target?.closest?.("[data-component]") as HTMLElement | null;
    const compName = group?.getAttribute("data-component");
    if (compName) {
      setSelectedName(compName);
    }
  };

  const handleRevealComponent = (comp: ModelicaComponentInfo) => {
    setSelectedName(comp.name);
    host?.onRevealLine?.(comp.startLine);
  };

  return (
    <PanelShell colorMode={colorMode} mode={mode} isFullScreen={isFullScreen} data-testid="modelica-studio-panel">
      <PanelToolbar
        title={model.className}
        subtitle={`${model.classKind} · Modelica Studio`}
        badge={{
          label:
            model.blt.status === "balanced" ? "Balanced" : model.blt.status === "empty" ? "Modelica" : model.blt.status,
          tone: model.blt.status === "balanced" ? "success" : model.blt.status === "empty" ? "info" : "warning",
        }}
        actions={
          effectiveSelected ? (
            <PanelButton
              variant="default"
              onClick={() => handleRevealComponent(effectiveSelected)}
              title={`Jump to ${effectiveSelected.name} (line ${effectiveSelected.startLine})`}
            >
              Go to {effectiveSelected.name} (L{effectiveSelected.startLine})
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<ModelicaTabId> tabs={TAB_ITEMS} activeTab={activeTab} onSelect={setActiveTab} />

      {statusMessage && (
        <div
          style={{
            padding: "4px 10px",
            fontSize: 11,
            color: "var(--ms-accent, #3b82f6)",
            borderBottom: "1px solid var(--ms-border, #2a2d3a)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: 11,
              opacity: 0.8,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: DIAGRAM */}
      {activeTab === "diagram" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} onClick={handleDiagramClick}>
          <div
            style={{
              padding: "4px 10px",
              fontSize: 11,
              color: "var(--ms-text-muted, #94a3b8)",
              borderBottom: "1px solid var(--ms-border, #2a2d3a)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              {diagram.usedNativeAnnotations
                ? "Native Modelica Placement / Icon Annotations"
                : "Auto-layout Schematic View (click a block to inspect properties)"}
            </span>
            {effectiveSelected && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span>
                  Selected: <strong>{effectiveSelected.name}</strong> ({effectiveSelected.typeName})
                </span>
                <PanelButton
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab("properties");
                  }}
                  style={{ padding: "1px 6px", fontSize: 10.5 }}
                >
                  Edit Properties
                </PanelButton>
              </span>
            )}
          </div>
          <PanelSvgStage
            svg={diagram.svg}
            canvasTheme={canvasTheme}
            onToggleCanvasTheme={() =>
              setCanvasThemeOverride((prev) => ((prev ?? colorMode) === "dark" ? "light" : "dark"))
            }
            onRevealLine={host?.onRevealLine}
          />
        </div>
      )}

      {/* TAB 2: PROPERTIES SHEET */}
      {activeTab === "properties" && (
        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--ms-text-muted, #94a3b8)" }}>Component:</label>
            <select
              value={effectiveSelected?.name ?? ""}
              onChange={(e) => setSelectedName(e.target.value || null)}
              style={{
                flex: 1,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--ms-border, #2a2d3a)",
                background: "var(--ms-surface-2, #161b22)",
                color: "var(--ms-text, #e2e8f0)",
                fontSize: 12,
              }}
            >
              {model.components.length === 0 && <option value="">(No components declared)</option>}
              {model.components.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} : {c.typeName}
                </option>
              ))}
            </select>
          </div>

          {effectiveSelected ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr",
                  gap: "6px 10px",
                  fontSize: 12,
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid var(--ms-border, #2a2d3a)",
                  background: "var(--ms-surface-2, #161b22)",
                }}
              >
                <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Type</span>
                <code style={{ fontFamily: "ui-monospace, monospace" }}>{effectiveSelected.typeName}</code>

                <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Variability</span>
                <span>{effectiveSelected.variability}</span>

                <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Causality</span>
                <span>{effectiveSelected.causality}</span>

                <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Location</span>
                <span>Line {effectiveSelected.startLine}</span>

                {effectiveSelected.description && (
                  <>
                    <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Description</span>
                    <span>{effectiveSelected.description}</span>
                  </>
                )}

                {effectiveSelected.bindingValue && (
                  <>
                    <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Binding</span>
                    <code style={{ fontFamily: "ui-monospace, monospace" }}>{effectiveSelected.bindingValue}</code>
                  </>
                )}

                {effectiveSelected.origin && (
                  <>
                    <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}>Placement</span>
                    <code style={{ fontFamily: "ui-monospace, monospace" }}>
                      origin = &#123;{effectiveSelected.origin[0]}, {effectiveSelected.origin[1]}&#125;
                    </code>
                  </>
                )}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    marginBottom: 6,
                    color: "var(--ms-text-muted, #94a3b8)",
                  }}
                >
                  Modifiers ({effectiveSelected.modifiers.length})
                </div>
                {effectiveSelected.modifiers.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ms-text-muted, #94a3b8)" }}>
                    No explicit modifiers. Add one below.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {effectiveSelected.modifiers.map((mod) => {
                      const key = `${effectiveSelected.name}.${mod.name}`;
                      const draftVal = editingValues[key] ?? mod.value;
                      return (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <code style={{ minWidth: 90, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                            {mod.name}
                          </code>
                          <input
                            type="text"
                            value={draftVal}
                            onChange={(e) => setEditingValues((prev) => ({ ...prev, [key]: e.target.value }))}
                            style={{
                              flex: 1,
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "1px solid var(--ms-border, #2a2d3a)",
                              background: "var(--ms-surface-2, #161b22)",
                              color: "var(--ms-text, #e2e8f0)",
                              fontSize: 12,
                              fontFamily: "ui-monospace, monospace",
                            }}
                          />
                          <PanelButton
                            variant="primary"
                            onClick={() => handleApplyModifier(effectiveSelected.name, mod.name, draftVal)}
                          >
                            Apply
                          </PanelButton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div
                style={{
                  paddingTop: 8,
                  borderTop: "1px solid var(--ms-border, #2a2d3a)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <input
                  type="text"
                  placeholder="param (e.g. R or start)"
                  value={newModName}
                  onChange={(e) => setNewModName(e.target.value)}
                  style={{
                    width: 140,
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--ms-border, #2a2d3a)",
                    background: "var(--ms-surface-2, #161b22)",
                    color: "var(--ms-text, #e2e8f0)",
                    fontSize: 12,
                  }}
                />
                <input
                  type="text"
                  placeholder="value (e.g. 100)"
                  value={newModValue}
                  onChange={(e) => setNewModValue(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--ms-border, #2a2d3a)",
                    background: "var(--ms-surface-2, #161b22)",
                    color: "var(--ms-text, #e2e8f0)",
                    fontSize: 12,
                  }}
                />
                <PanelButton
                  variant="primary"
                  onClick={() => {
                    handleApplyModifier(effectiveSelected.name, newModName, newModValue);
                    setNewModName("");
                    setNewModValue("");
                  }}
                >
                  Add
                </PanelButton>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ms-text-muted, #94a3b8)" }}>
              Declare a component or insert one from the Library tab to edit its properties.
            </div>
          )}
        </div>
      )}

      {/* TAB 3: COMPONENTS OUTLINE */}
      {activeTab === "components" && (
        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                marginBottom: 6,
                color: "var(--ms-text-muted, #94a3b8)",
              }}
            >
              Class Hierarchy
            </div>
            <div style={{ fontSize: 12 }}>
              <strong>{model.classKind}</strong> {model.className}
              {model.description && (
                <span style={{ color: "var(--ms-text-muted, #94a3b8)" }}> — &ldquo;{model.description}&rdquo;</span>
              )}
            </div>
            {model.extendsList.length > 0 && (
              <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {model.extendsList.map((ext) => (
                  <button
                    key={`${ext.baseClass}:${ext.line}`}
                    type="button"
                    onClick={() => host?.onRevealLine?.(ext.line)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--ms-border, #2a2d3a)",
                      background: "var(--ms-surface-2, #161b22)",
                      color: "var(--ms-text, #e2e8f0)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    extends {ext.baseClass} (L{ext.line})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 240,
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--ms-border)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <PanelDataGrid
              rows={model.components}
              columns={
                [
                  { key: "name", label: "Name", sortValue: (c) => c.name, render: (c) => <strong>{c.name}</strong> },
                  {
                    key: "typeName",
                    label: "Type",
                    mono: true,
                    sortValue: (c) => c.typeName,
                    render: (c) => c.typeName,
                  },
                  { key: "variability", label: "Kind", sortValue: (c) => c.variability, render: (c) => c.variability },
                  {
                    key: "value",
                    label: "Value / Mods",
                    mono: true,
                    sortValue: (c) =>
                      c.bindingValue ??
                      (c.modifiers.length > 0 ? c.modifiers.map((m) => `${m.name}=${m.value}`).join(", ") : ""),
                    render: (c) =>
                      c.bindingValue ??
                      (c.modifiers.length > 0 ? c.modifiers.map((m) => `${m.name}=${m.value}`).join(", ") : "—"),
                  },
                  {
                    key: "startLine",
                    label: "Line",
                    align: "right",
                    mono: true,
                    sortValue: (c) => c.startLine,
                    render: (c) => `L${c.startLine}`,
                  },
                ] as PanelDataGridColumn<ModelicaComponentInfo>[]
              }
              rowKey={(c) => c.name}
              searchPlaceholder="Filter components & variables by name, type, or kind…"
              onRowClick={handleRevealComponent}
              emptyMessage="No Modelica components or variables declared."
            />
          </div>

          {model.connects.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  marginBottom: 6,
                  color: "var(--ms-text-muted, #94a3b8)",
                }}
              >
                Connections ({model.connects.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {model.connects.map((conn, idx) => (
                  <button
                    key={`${conn.source}-${conn.target}-${idx}`}
                    type="button"
                    onClick={() => host?.onRevealLine?.(conn.startLine)}
                    style={{
                      textAlign: "left",
                      padding: "5px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--ms-border, #2a2d3a)",
                      background: "var(--ms-surface-2, #161b22)",
                      color: "var(--ms-text, #e2e8f0)",
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    connect({conn.source}, {conn.target}) <span style={{ opacity: 0.6 }}>— L{conn.startLine}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIBRARY BROWSER */}
      {activeTab === "library" && (
        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="Search MSL components (Resistor, Inertia, PID...)"
              value={libQuery}
              onChange={(e) => setLibQuery(e.target.value)}
              style={{
                flex: 1,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--ms-border, #2a2d3a)",
                background: "var(--ms-surface-2, #161b22)",
                color: "var(--ms-text, #e2e8f0)",
                fontSize: 12,
              }}
            />
            <select
              value={libDomain}
              onChange={(e) => setLibDomain(e.target.value)}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--ms-border, #2a2d3a)",
                background: "var(--ms-surface-2, #161b22)",
                color: "var(--ms-text, #e2e8f0)",
                fontSize: 12,
              }}
            >
              {domains.map((d) => (
                <option key={d} value={d}>
                  {d === "all" ? "All Domains" : d}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {filteredLibrary.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  border: "1px solid var(--ms-border, #2a2d3a)",
                  borderLeft: `3px solid ${item.color}`,
                  background: "var(--ms-surface-2, #161b22)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 12.5 }}>{item.label}</strong>
                  <PanelButton variant="primary" onClick={() => handleInsertLibraryItem(item)}>
                    Insert
                  </PanelButton>
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    fontFamily: "ui-monospace, monospace",
                    color: "var(--ms-text-muted, #94a3b8)",
                  }}
                >
                  {item.domain}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ms-text-muted, #94a3b8)" }}>{item.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: BLT STRUCTURAL ANALYSIS */}
      {activeTab === "blt" && (
        <PanelBltView
          data={model.blt}
          onRevealLine={(line) => host?.onRevealLine?.(line)}
          emptyHint="No scalar equations detected in this class. Add scalar variables and an equation section (e.g. der(x) = -x;) to view the BLT incidence matrix and block ordering."
        />
      )}
    </PanelShell>
  );
};

export default ModelicaPanel;
