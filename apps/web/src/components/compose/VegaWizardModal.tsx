// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CodeIcon,
  GraphIcon,
  SlidersIcon,
  SparklesFillIcon,
  TableIcon,
  XIcon,
} from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createArtifactView, getArtifactView } from "../../api";
import {
  loadTabularDatasetFromArtifactView,
  type ParsedTabularDataset,
  type TabularColumn,
} from "../../util/tabular-data-parser";
import VegaViewer from "../artifacts/VegaViewer";
import {
  buildVegaLiteSpec,
  inferInitialWizardConfig,
  VEGA_COLOR_SCHEMES,
  VEGA_LITE_TEMPLATES,
  type VegaAggregation,
  type VegaScaleType,
  type VegaTemplateCategory,
  type VegaTemplateId,
  type VegaWizardConfig,
} from "./vega-wizard-templates";

export interface VegaWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  artifactId: number | null;
  artifactView?: Record<string, unknown> | null | undefined;
  onApplyVisualization: (newArtifactId: number, title: string, createdView?: Record<string, unknown>) => void;
}

const CATEGORY_TABS: Array<{ id: VegaTemplateCategory; label: string }> = [
  { id: "all", label: "All Templates" },
  { id: "trends", label: "Trends & Time-Series" },
  { id: "correlation", label: "Scatter & Fit" },
  { id: "distribution", label: "Distributions" },
  { id: "categorical", label: "Categorical" },
];

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-fg-muted, #8b949e)",
  marginBottom: "4px",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 9px",
  fontSize: "12.5px",
  borderRadius: "6px",
  border: "1px solid var(--color-border-default, #30363d)",
  background: "var(--color-canvas-subtle, #161b22)",
  color: "var(--color-fg-default, #e6edf3)",
  outline: "none",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 9px",
  fontSize: "12.5px",
  borderRadius: "6px",
  border: "1px solid var(--color-border-default, #30363d)",
  background: "var(--color-canvas-subtle, #161b22)",
  color: "var(--color-fg-default, #e6edf3)",
  outline: "none",
  boxSizing: "border-box",
};

function formatColOptionLabel(col: TabularColumn): string {
  const badge = col.vegaType === "quantitative" ? "# num" : col.vegaType === "temporal" ? "⏱ time" : "Aa cat";
  return `${col.name} (${badge})`;
}

export const VegaWizardModal: React.FC<VegaWizardModalProps> = ({
  isOpen,
  onClose,
  artifactId,
  artifactView: initialArtifactView,
  onApplyVisualization,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<ParsedTabularDataset | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [config, setConfig] = useState<VegaWizardConfig | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<VegaTemplateCategory>("all");
  const [previewTab, setPreviewTab] = useState<"chart" | "data" | "spec">("chart");

  useEffect(() => {
    if (!isOpen || artifactId === null) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let viewObj = initialArtifactView;
        if (!viewObj) {
          const res = (await getArtifactView(artifactId!)) as Record<string, unknown>;
          viewObj =
            (res?.artifactView as Record<string, unknown> | undefined) ||
            (res?.artifact_view as Record<string, unknown> | undefined) ||
            res;
        }
        if (cancelled || !viewObj) return;

        let rawConfigObj: Record<string, unknown> = {};
        if (typeof viewObj.view_config === "string") {
          try {
            rawConfigObj = JSON.parse(viewObj.view_config) as Record<string, unknown>;
          } catch {
            rawConfigObj = {};
          }
        } else if (viewObj.view_config && typeof viewObj.view_config === "object") {
          rawConfigObj = viewObj.view_config as Record<string, unknown>;
        }

        const resolvedUrl =
          (typeof rawConfigObj.sourceUrl === "string" && rawConfigObj.sourceUrl) ||
          (typeof rawConfigObj.url === "string" && rawConfigObj.url) ||
          undefined;
        setSourceUrl(resolvedUrl);

        const parsed = await loadTabularDatasetFromArtifactView(viewObj);
        if (cancelled) return;
        setDataset(parsed);

        if (rawConfigObj.wizardConfig && typeof rawConfigObj.wizardConfig === "object") {
          setConfig({
            ...inferInitialWizardConfig(parsed),
            ...(rawConfigObj.wizardConfig as Partial<VegaWizardConfig>),
          });
        } else {
          setConfig(inferInitialWizardConfig(parsed));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to parse tabular dataset");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, artifactId, initialArtifactView]);

  const handleSelectTable = (tableId: string) => {
    if (!dataset) return;
    const found = dataset.tables.find((t) => t.id === tableId);
    if (!found) return;
    const updatedDataset: ParsedTabularDataset = {
      ...dataset,
      activeTableId: found.id,
      columns: found.columns,
      rows: found.rows,
    };
    setDataset(updatedDataset);
    setConfig(inferInitialWizardConfig(updatedDataset));
  };

  const activeTemplateMeta = useMemo(() => {
    const id = config?.templateId || "line";
    return VEGA_LITE_TEMPLATES.find((t) => t.id === id) || VEGA_LITE_TEMPLATES[0]!;
  }, [config?.templateId]);

  const filteredTemplates = useMemo(() => {
    if (categoryFilter === "all") return VEGA_LITE_TEMPLATES;
    return VEGA_LITE_TEMPLATES.filter((t) => t.category === categoryFilter);
  }, [categoryFilter]);

  const compiledSpec = useMemo(() => {
    if (!config || !dataset || dataset.rows.length === 0) return null;
    return buildVegaLiteSpec(config, dataset);
  }, [config, dataset]);

  const handleTemplateSelect = (templateId: VegaTemplateId) => {
    if (!config) return;
    setConfig({
      ...config,
      templateId,
    });
  };

  const handleApply = async () => {
    if (!config || !dataset || !compiledSpec) return;
    setSaving(true);
    try {
      const chartTitle = config.title.trim() || `${dataset.title} Visualization`;
      const viewConfigPayload = {
        spec: compiledSpec,
        data: dataset.rows,
        ...(sourceUrl ? { sourceUrl } : {}),
        title: chartTitle,
        format: dataset.format,
        rowCount: dataset.rows.length,
        columnCount: dataset.columns.length,
        columns: dataset.columns.map((c) => c.name),
        wizardConfig: config,
      };

      const created = await createArtifactView({
        artifact_type: "vega-plot",
        title: `📊 ${chartTitle}`,
        view_config: JSON.stringify(viewConfigPayload),
      });

      onApplyVisualization(created.id, chartTitle, {
        ...created,
        view_type: "vega-plot",
        artifact_type: "vega-plot",
        title: `📊 ${chartTitle}`,
        view_config: viewConfigPayload,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save Vega-Lite visualization");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vega-Lite Visualization Wizard"
      data-testid="vega-wizard-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(3, 7, 18, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "1120px",
          maxHeight: "90vh",
          backgroundColor: "var(--color-canvas-default, #0d1117)",
          border: "1px solid var(--color-border-default, #30363d)",
          borderRadius: "14px",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.65)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--color-fg-default, #e6edf3)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid var(--color-border-default, #30363d)",
            background: "var(--color-canvas-subtle, #161b22)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                background: "rgba(168, 85, 247, 0.16)",
                color: "#c084fc",
                border: "1px solid rgba(168, 85, 247, 0.35)",
              }}
            >
              <GraphIcon size={16} />
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 700, fontSize: "15px" }}>Vega-Lite Visualization Wizard</span>
                {dataset && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "2px 7px",
                      borderRadius: "999px",
                      background: "rgba(6, 182, 212, 0.14)",
                      color: "#22d3ee",
                      border: "1px solid rgba(6, 182, 212, 0.3)",
                      fontWeight: 600,
                    }}
                  >
                    {dataset.format.toUpperCase()} · {dataset.rows.length.toLocaleString()} rows ·{" "}
                    {dataset.columns.length} cols
                  </span>
                )}
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)", marginTop: "2px" }}>
                Pick a Vega-Lite template from the gallery and customize axes, encodings, and labels
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Vega-Lite Wizard"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-fg-muted, #8b949e)",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "6px",
            }}
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div
            style={{
              padding: "64px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
            }}
          >
            <Spinner size="medium" />
            <span style={{ fontSize: "13px", color: "var(--color-fg-muted, #8b949e)" }}>
              Analyzing dataset schema and preparing templates...
            </span>
          </div>
        ) : error ? (
          <div style={{ padding: "32px 24px", color: "var(--color-danger-fg, #f85149)", fontSize: "13.5px" }}>
            {error}
          </div>
        ) : dataset && config ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
            {/* Template Gallery Strip */}
            <div
              style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--color-border-default, #30363d)",
                background: "rgba(13, 17, 23, 0.65)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "10px",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  {CATEGORY_TABS.map((cat) => {
                    const active = categoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategoryFilter(cat.id)}
                        style={{
                          padding: "4px 10px",
                          fontSize: "11.5px",
                          fontWeight: active ? 600 : 500,
                          borderRadius: "999px",
                          border: active
                            ? "1px solid rgba(168, 85, 247, 0.5)"
                            : "1px solid var(--color-border-default, #30363d)",
                          background: active ? "rgba(168, 85, 247, 0.18)" : "transparent",
                          color: active ? "#e9d5ff" : "var(--color-fg-muted, #8b949e)",
                          cursor: "pointer",
                        }}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>

                {dataset.tables.length > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11.5px", color: "var(--color-fg-muted, #8b949e)", fontWeight: 600 }}>
                      Dataset Table / Group:
                    </span>
                    <select
                      aria-label="Select Dataset Table"
                      value={dataset.activeTableId}
                      onChange={(e) => handleSelectTable(e.target.value)}
                      style={{ ...selectStyle, width: "auto", padding: "4px 8px", fontSize: "12px" }}
                    >
                      {dataset.tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.rows.length} rows)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div
                data-testid="vega-template-gallery"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))",
                  gap: "8px",
                  maxHeight: "148px",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {filteredTemplates.map((tpl) => {
                  const selected = config.templateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      data-testid={`vega-template-${tpl.id}`}
                      onClick={() => handleTemplateSelect(tpl.id)}
                      style={{
                        textAlign: "left",
                        padding: "9px 11px",
                        borderRadius: "8px",
                        border: selected ? "1.5px solid #a855f7" : "1px solid var(--color-border-default, #30363d)",
                        background: selected ? "rgba(168, 85, 247, 0.14)" : "var(--color-canvas-subtle, #161b22)",
                        color: "var(--color-fg-default, #e6edf3)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        transition: "border-color 0.12s ease, background 0.12s ease",
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{tpl.name}</span>
                        {selected && <CheckIcon size={13} fill="#c084fc" />}
                      </div>
                      <span
                        style={{
                          fontSize: "9.5px",
                          fontFamily: "var(--font-mono, monospace)",
                          color: selected ? "#c084fc" : "#22d3ee",
                          fontWeight: 600,
                        }}
                      >
                        {tpl.badge}
                      </span>
                      <span
                        style={{
                          fontSize: "10.5px",
                          color: "var(--color-fg-muted, #8b949e)",
                          lineHeight: 1.3,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {tpl.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Split Customizer + Live Preview */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "320px minmax(0, 1fr)",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {/* Left Sidebar: Customization Controls */}
              <div
                style={{
                  borderRight: "1px solid var(--color-border-default, #30363d)",
                  padding: "16px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  background: "rgba(22, 27, 34, 0.45)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 700 }}>
                  <SlidersIcon size={14} />
                  <span>Encoding & Axis Mapping</span>
                </div>

                {/* X Axis */}
                <div>
                  <label htmlFor="vega-x-field" style={labelStyle}>
                    {config.templateId === "histogram" ? "Variable to Bin (X Axis)" : "X Axis Variable"}
                  </label>
                  <select
                    id="vega-x-field"
                    value={config.xField}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        xField: e.target.value,
                        xTitle: config.xTitle === config.xField ? e.target.value : config.xTitle,
                      })
                    }
                    style={selectStyle}
                  >
                    {dataset.columns.map((col) => (
                      <option key={col.name} value={col.name}>
                        {formatColOptionLabel(col)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Y Axis */}
                {config.templateId !== "histogram" && (
                  <div>
                    <label htmlFor="vega-y-field" style={labelStyle}>
                      {config.templateId === "multi-line" ? "Primary Y Variable (Y1)" : "Y Axis Variable"}
                    </label>
                    <select
                      id="vega-y-field"
                      value={config.yField}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          yField: e.target.value,
                          yTitle: config.yTitle === config.yField ? e.target.value : config.yTitle,
                        })
                      }
                      style={selectStyle}
                    >
                      {dataset.columns.map((col) => (
                        <option key={col.name} value={col.name}>
                          {formatColOptionLabel(col)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Secondary Y Axis for Multi-Line */}
                {activeTemplateMeta.supportsY2 && (
                  <div>
                    <label htmlFor="vega-y2-field" style={labelStyle}>
                      Secondary Variable (Y2)
                    </label>
                    <select
                      id="vega-y2-field"
                      value={config.y2Field}
                      onChange={(e) => setConfig({ ...config, y2Field: e.target.value })}
                      style={selectStyle}
                    >
                      <option value="">— None —</option>
                      {dataset.columns.map((col) => (
                        <option key={col.name} value={col.name}>
                          {formatColOptionLabel(col)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Color / Group By */}
                <div>
                  <label htmlFor="vega-color-field" style={labelStyle}>
                    Color / Group By Series
                  </label>
                  <select
                    id="vega-color-field"
                    value={config.colorField}
                    onChange={(e) => setConfig({ ...config, colorField: e.target.value })}
                    style={selectStyle}
                  >
                    <option value="">— None (Single Series) —</option>
                    {dataset.columns.map((col) => (
                      <option key={col.name} value={col.name}>
                        {formatColOptionLabel(col)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Size Encoding (for Scatter/Bubble) */}
                {activeTemplateMeta.supportsSize && (
                  <div>
                    <label htmlFor="vega-size-field" style={labelStyle}>
                      Bubble Size Variable
                    </label>
                    <select
                      id="vega-size-field"
                      value={config.sizeField}
                      onChange={(e) => setConfig({ ...config, sizeField: e.target.value })}
                      style={selectStyle}
                    >
                      <option value="">— Fixed Point Size —</option>
                      {dataset.columns
                        .filter((c) => c.vegaType === "quantitative")
                        .map((col) => (
                          <option key={col.name} value={col.name}>
                            {formatColOptionLabel(col)}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Aggregation & Scales */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {activeTemplateMeta.supportsAggregation && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor="vega-aggregation" style={labelStyle}>
                        Y Aggregation
                      </label>
                      <select
                        id="vega-aggregation"
                        value={config.aggregation}
                        onChange={(e) => setConfig({ ...config, aggregation: e.target.value as VegaAggregation })}
                        style={selectStyle}
                      >
                        <option value="none">None (Raw Values)</option>
                        <option value="mean">Mean (Average)</option>
                        <option value="median">Median</option>
                        <option value="sum">Sum</option>
                        <option value="min">Minimum</option>
                        <option value="max">Maximum</option>
                        <option value="count">Count of Records</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label htmlFor="vega-x-scale" style={labelStyle}>
                      X Scale
                    </label>
                    <select
                      id="vega-x-scale"
                      value={config.xScale}
                      onChange={(e) => setConfig({ ...config, xScale: e.target.value as VegaScaleType })}
                      style={selectStyle}
                    >
                      <option value="linear">Linear</option>
                      <option value="log">Logarithmic</option>
                      <option value="symlog">SymLog</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="vega-y-scale" style={labelStyle}>
                      Y Scale
                    </label>
                    <select
                      id="vega-y-scale"
                      value={config.yScale}
                      onChange={(e) => setConfig({ ...config, yScale: e.target.value as VegaScaleType })}
                      style={selectStyle}
                    >
                      <option value="linear">Linear</option>
                      <option value="log">Logarithmic</option>
                      <option value="symlog">SymLog</option>
                    </select>
                  </div>
                </div>

                <hr
                  style={{
                    border: "none",
                    borderTop: "1px solid var(--color-border-default, #30363d)",
                    margin: "2px 0",
                  }}
                />

                {/* Titles & Styling */}
                <div>
                  <label htmlFor="vega-chart-title" style={labelStyle}>
                    Chart Title
                  </label>
                  <input
                    id="vega-chart-title"
                    type="text"
                    value={config.title}
                    onChange={(e) => setConfig({ ...config, title: e.target.value })}
                    placeholder="Enter chart title..."
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <label htmlFor="vega-x-title" style={labelStyle}>
                      X Axis Label
                    </label>
                    <input
                      id="vega-x-title"
                      type="text"
                      value={config.xTitle}
                      onChange={(e) => setConfig({ ...config, xTitle: e.target.value })}
                      placeholder={config.xField}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="vega-y-title" style={labelStyle}>
                      Y Axis Label
                    </label>
                    <input
                      id="vega-y-title"
                      type="text"
                      value={config.yTitle}
                      onChange={(e) => setConfig({ ...config, yTitle: e.target.value })}
                      placeholder={config.yField}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="vega-color-scheme" style={labelStyle}>
                    Color Palette
                  </label>
                  <select
                    id="vega-color-scheme"
                    value={config.colorScheme}
                    onChange={(e) => setConfig({ ...config, colorScheme: e.target.value })}
                    style={selectStyle}
                  >
                    {VEGA_COLOR_SCHEMES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={config.interactiveZoom}
                      onChange={(e) => setConfig({ ...config, interactiveZoom: e.target.checked })}
                    />
                    <span>Enable interactive pan & wheel zoom</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={config.showGrid}
                      onChange={(e) => setConfig({ ...config, showGrid: e.target.checked })}
                    />
                    <span>Show background gridlines</span>
                  </label>
                  {(config.templateId === "line" ||
                    config.templateId === "multi-line" ||
                    config.templateId === "area") && (
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={config.showPoints}
                        onChange={(e) => setConfig({ ...config, showPoints: e.target.checked })}
                      />
                      <span>Overlay point markers on line</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Right Pane: Live Preview / Data Inspector / Spec */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                  background: "var(--color-canvas-default, #0d1117)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 16px",
                    borderBottom: "1px solid var(--color-border-default, #30363d)",
                    background: "rgba(22, 27, 34, 0.6)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {(
                      [
                        { id: "chart", label: "Live Preview", icon: GraphIcon },
                        { id: "data", label: `Dataset Schema (${dataset.columns.length})`, icon: TableIcon },
                        { id: "spec", label: "Vega-Lite JSON", icon: CodeIcon },
                      ] as const
                    ).map((t) => {
                      const Icon = t.icon;
                      const active = previewTab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setPreviewTab(t.id)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "5px 10px",
                            fontSize: "11.5px",
                            fontWeight: active ? 600 : 500,
                            borderRadius: "6px",
                            border: "none",
                            background: active ? "rgba(168, 85, 247, 0.2)" : "transparent",
                            color: active ? "#d8b4fe" : "var(--color-fg-muted, #8b949e)",
                            cursor: "pointer",
                          }}
                        >
                          <Icon size={12} />
                          <span>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ flex: 1, padding: "16px", overflow: "auto", minHeight: "360px" }}>
                  {previewTab === "chart" && compiledSpec ? (
                    <VegaViewer
                      viewConfig={{
                        spec: compiledSpec,
                        data: dataset.rows,
                        title: config.title || dataset.title,
                      }}
                    />
                  ) : previewTab === "data" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                          gap: "8px",
                        }}
                      >
                        {dataset.columns.map((col) => (
                          <div
                            key={col.name}
                            style={{
                              padding: "8px 10px",
                              borderRadius: "8px",
                              border: "1px solid var(--color-border-default, #30363d)",
                              background: "var(--color-canvas-subtle, #161b22)",
                              fontSize: "11.5px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                              <span>{col.name}</span>
                              <span style={{ color: "#22d3ee", fontFamily: "var(--font-mono, monospace)" }}>
                                {col.vegaType}
                              </span>
                            </div>
                            {col.min !== undefined && col.max !== undefined && (
                              <div style={{ color: "var(--color-fg-muted, #8b949e)", marginTop: "4px" }}>
                                Range: [{col.min.toFixed(2)}, {col.max.toFixed(2)}]
                              </div>
                            )}
                            <div style={{ color: "var(--color-fg-muted, #8b949e)", marginTop: "2px" }}>
                              {col.uniqueCount} unique values
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        padding: "12px",
                        borderRadius: "8px",
                        background: "var(--color-canvas-subtle, #161b22)",
                        border: "1px solid var(--color-border-default, #30363d)",
                        fontSize: "11.5px",
                        fontFamily: "var(--font-mono, monospace)",
                        overflow: "auto",
                        maxHeight: "380px",
                      }}
                    >
                      {JSON.stringify({ ...compiledSpec, data: { values: `[${dataset.rows.length} rows]` } }, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border-default, #30363d)",
            background: "var(--color-canvas-subtle, #161b22)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 14px",
              fontSize: "12.5px",
              fontWeight: 500,
              borderRadius: "8px",
              border: "1px solid var(--color-border-default, #30363d)",
              background: "transparent",
              color: "var(--color-fg-muted, #8b949e)",
              cursor: "pointer",
            }}
          >
            Keep Raw Table Only
          </button>

          <button
            type="button"
            data-testid="vega-wizard-apply-btn"
            disabled={saving || loading || !compiledSpec}
            onClick={() => void handleApply()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 18px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "8px",
              border: "1px solid rgba(168, 85, 247, 0.5)",
              background: "linear-gradient(135deg, #9333ea 0%, #6366f1 100%)",
              color: "#ffffff",
              cursor: saving || loading ? "wait" : "pointer",
              opacity: saving || loading || !compiledSpec ? 0.65 : 1,
            }}
          >
            <SparklesFillIcon size={13} />
            <span>{saving ? "Creating Visualization..." : "Apply Visualization to Post"}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
};

export default VegaWizardModal;
