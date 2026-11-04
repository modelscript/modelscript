// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vega-Lite chart profile. Unlike file profiles it has no file to analyze: it *derives* a new `vega-plot`
 * artifact from an attached table (see `AttachProfile.derive`), reusing the same wizard shell, steps and
 * live preview as every other language.
 */

import React, { lazy, Suspense, useMemo, useState } from "react";
import type { TabularColumn } from "../../../../util/tabular-data-parser";
import {
  VEGA_COLOR_SCHEMES,
  VEGA_LITE_TEMPLATES,
  type VegaAggregation,
  type VegaScaleType,
  type VegaTemplateCategory,
  type VegaTemplateId,
  type VegaWizardConfig,
} from "../../vega-wizard-templates";
import { CheckboxField, PillToggleGroup, SelectField, TextField } from "../Primitives";
import type { AttachProfile, WizardStepProps } from "../types";
import {
  buildVegaResult,
  compileVegaSpec,
  isVegaSourceArtifact,
  openVegaDraft,
  selectVegaTable,
  templateMeta,
  validateVegaEncodings,
  type VegaAttachDraft,
} from "./vega-model";

/**
 * The chart renderer is loaded lazily (react-vega is large) and exposed through a mutable holder so tests can
 * substitute a lightweight stand-in.
 */
const LazyVegaViewer = lazy(() => import("../../../artifacts/VegaViewer"));
export const vegaPreviewRenderer: { Chart: React.ComponentType<{ viewConfig: Record<string, unknown> }> } = {
  Chart: LazyVegaViewer as unknown as React.ComponentType<{ viewConfig: Record<string, unknown> }>,
};

const CATEGORY_OPTIONS: Array<{ value: VegaTemplateCategory; label: string }> = [
  { value: "all", label: "All" },
  { value: "trends", label: "Trends & time-series" },
  { value: "correlation", label: "Scatter & fit" },
  { value: "distribution", label: "Distributions" },
  { value: "categorical", label: "Categorical" },
];

function columnLabel(col: TabularColumn): string {
  const badge = col.vegaType === "quantitative" ? "# num" : col.vegaType === "temporal" ? "⏱ time" : "Aa cat";
  return `${col.name} (${badge})`;
}

type StepProps = WizardStepProps<VegaAttachDraft>;

function patchConfig(update: StepProps["update"], patch: Partial<VegaWizardConfig>): void {
  update((prev) => ({ ...prev, config: { ...prev.config, ...patch } }));
}

// ── Step 1: chart template ────────────────────────────────────

const TemplateStep: React.FC<StepProps> = ({ draft, update }) => {
  const [category, setCategory] = useState<VegaTemplateCategory>("all");
  const templates = useMemo(
    () => (category === "all" ? VEGA_LITE_TEMPLATES : VEGA_LITE_TEMPLATES.filter((t) => t.category === category)),
    [category],
  );

  return (
    <>
      {draft.dataset.tables.length > 1 && (
        <SelectField
          label="Select Dataset Table"
          value={draft.dataset.activeTableId}
          onChange={(tableId) => update((prev) => selectVegaTable(prev, tableId))}
        >
          {draft.dataset.tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.rows.length} rows)
            </option>
          ))}
        </SelectField>
      )}

      <PillToggleGroup label="Template category" value={category} options={CATEGORY_OPTIONS} onChange={setCategory} />

      <div
        data-testid="vega-template-gallery"
        role="radiogroup"
        aria-label="Chart template"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
          maxHeight: 200,
          overflowY: "auto",
          padding: 2,
        }}
      >
        {templates.map((tpl) => {
          const selected = draft.config.templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`vega-template-${tpl.id}`}
              onClick={() => patchConfig(update, { templateId: tpl.id as VegaTemplateId })}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                font: "inherit",
                color: "var(--ms-text-1)",
                border: `1px solid ${selected ? "var(--ms-brand)" : "var(--ms-border)"}`,
                background: selected ? "var(--ms-brand-soft)" : "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{tpl.name}</span>
              <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono, monospace)", color: "var(--ms-text-3)" }}>
                {tpl.badge}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ms-text-3)", lineHeight: 1.3 }}>{tpl.description}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

// ── Step 2: data mapping ──────────────────────────────────────

const MappingStep: React.FC<StepProps> = ({ draft, update }) => {
  const { config, dataset } = draft;
  const meta = templateMeta(config.templateId);
  const columns = dataset.columns;
  const options = (list: TabularColumn[]) =>
    list.map((c) => (
      <option key={c.name} value={c.name}>
        {columnLabel(c)}
      </option>
    ));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
      <SelectField
        id="vega-x-field"
        label={config.templateId === "histogram" ? "Variable to bin (X axis)" : "X axis variable"}
        value={config.xField}
        onChange={(xField) =>
          update((prev) => ({
            ...prev,
            config: {
              ...prev.config,
              xField,
              xTitle: prev.config.xTitle === prev.config.xField ? xField : prev.config.xTitle,
            },
          }))
        }
      >
        {options(columns)}
      </SelectField>

      {config.templateId !== "histogram" && (
        <SelectField
          id="vega-y-field"
          label={config.templateId === "multi-line" ? "Primary Y variable (Y1)" : "Y axis variable"}
          value={config.yField}
          onChange={(yField) =>
            update((prev) => ({
              ...prev,
              config: {
                ...prev.config,
                yField,
                yTitle: prev.config.yTitle === prev.config.yField ? yField : prev.config.yTitle,
              },
            }))
          }
        >
          {options(columns)}
        </SelectField>
      )}

      {meta.supportsY2 && (
        <SelectField
          id="vega-y2-field"
          label="Secondary variable (Y2)"
          value={config.y2Field}
          onChange={(y2Field) => patchConfig(update, { y2Field })}
        >
          <option value="">— None —</option>
          {options(columns)}
        </SelectField>
      )}

      <SelectField
        id="vega-color-field"
        label="Color / group by series"
        value={config.colorField}
        onChange={(colorField) => patchConfig(update, { colorField })}
      >
        <option value="">— None (single series) —</option>
        {options(columns)}
      </SelectField>

      {meta.supportsSize && (
        <SelectField
          id="vega-size-field"
          label="Bubble size variable"
          value={config.sizeField}
          onChange={(sizeField) => patchConfig(update, { sizeField })}
        >
          <option value="">— Fixed point size —</option>
          {options(columns.filter((c) => c.vegaType === "quantitative"))}
        </SelectField>
      )}

      {meta.supportsAggregation && (
        <SelectField
          id="vega-aggregation"
          label="Y aggregation"
          value={config.aggregation}
          onChange={(aggregation) => patchConfig(update, { aggregation: aggregation as VegaAggregation })}
        >
          <option value="none">None (raw values)</option>
          <option value="mean">Mean (average)</option>
          <option value="median">Median</option>
          <option value="sum">Sum</option>
          <option value="min">Minimum</option>
          <option value="max">Maximum</option>
          <option value="count">Count of records</option>
        </SelectField>
      )}

      <SelectField
        id="vega-x-scale"
        label="X scale"
        value={config.xScale}
        onChange={(xScale) => patchConfig(update, { xScale: xScale as VegaScaleType })}
      >
        <option value="linear">Linear</option>
        <option value="log">Logarithmic</option>
        <option value="symlog">SymLog</option>
      </SelectField>

      <SelectField
        id="vega-y-scale"
        label="Y scale"
        value={config.yScale}
        onChange={(yScale) => patchConfig(update, { yScale: yScale as VegaScaleType })}
      >
        <option value="linear">Linear</option>
        <option value="log">Logarithmic</option>
        <option value="symlog">SymLog</option>
      </SelectField>
    </div>
  );
};

// ── Step 3: titles and style ──────────────────────────────────

const StyleStep: React.FC<StepProps> = ({ draft, update }) => {
  const { config } = draft;
  const showsPointsToggle =
    config.templateId === "line" || config.templateId === "multi-line" || config.templateId === "area";
  return (
    <>
      <TextField
        id="vega-chart-title"
        label="Chart title"
        value={config.title}
        placeholder="Enter chart title..."
        onChange={(title) => patchConfig(update, { title })}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <TextField
          id="vega-x-title"
          label="X axis label"
          value={config.xTitle}
          placeholder={config.xField}
          onChange={(xTitle) => patchConfig(update, { xTitle })}
        />
        <TextField
          id="vega-y-title"
          label="Y axis label"
          value={config.yTitle}
          placeholder={config.yField}
          onChange={(yTitle) => patchConfig(update, { yTitle })}
        />
      </div>
      <SelectField
        id="vega-color-scheme"
        label="Color palette"
        value={config.colorScheme}
        onChange={(colorScheme) => patchConfig(update, { colorScheme })}
      >
        {VEGA_COLOR_SCHEMES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </SelectField>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <CheckboxField
          label="Enable interactive pan & wheel zoom"
          checked={config.interactiveZoom}
          onChange={(interactiveZoom) => patchConfig(update, { interactiveZoom })}
        />
        <CheckboxField
          label="Show background gridlines"
          checked={config.showGrid}
          onChange={(showGrid) => patchConfig(update, { showGrid })}
        />
        {showsPointsToggle && (
          <CheckboxField
            label="Overlay point markers on line"
            checked={config.showPoints}
            onChange={(showPoints) => patchConfig(update, { showPoints })}
          />
        )}
      </div>
    </>
  );
};

// ── Live preview (shown under every step) ─────────────────────

type PreviewTab = "chart" | "data" | "spec";

const VegaPreview: React.FC<{ draft: VegaAttachDraft }> = ({ draft }) => {
  const [tab, setTab] = useState<PreviewTab>("chart");
  const spec = useMemo(() => compileVegaSpec(draft), [draft]);
  const { dataset, config } = draft;
  const Chart = vegaPreviewRenderer.Chart;

  return (
    <div data-testid="vega-live-preview" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PillToggleGroup<PreviewTab>
        label="Preview"
        value={tab}
        onChange={setTab}
        options={[
          { value: "chart", label: "Live preview" },
          { value: "data", label: `Dataset schema (${dataset.columns.length})` },
          { value: "spec", label: "Vega-Lite JSON" },
        ]}
      />
      <div
        style={{
          minHeight: 240,
          maxHeight: 360,
          overflow: "auto",
          borderRadius: 10,
          border: "1px solid var(--ms-border)",
          padding: 10,
        }}
      >
        {tab === "chart" &&
          (spec ? (
            <Suspense fallback={<span role="status">Rendering chart…</span>}>
              <Chart viewConfig={{ spec, data: dataset.rows, title: config.title || dataset.title }} />
            </Suspense>
          ) : (
            <span style={{ fontSize: 13, color: "var(--ms-text-3)" }}>Pick fields to see a preview.</span>
          ))}
        {tab === "data" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
            {dataset.columns.map((col) => (
              <div
                key={col.name}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--ms-border)", fontSize: 12 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{col.name}</span>
                  <span style={{ color: "var(--ms-brand)", fontFamily: "var(--font-mono, monospace)" }}>
                    {col.vegaType}
                  </span>
                </div>
                {col.min !== undefined && col.max !== undefined && (
                  <div style={{ color: "var(--ms-text-3)", marginTop: 4 }}>
                    Range: [{col.min.toFixed(2)}, {col.max.toFixed(2)}]
                  </div>
                )}
                <div style={{ color: "var(--ms-text-3)", marginTop: 2 }}>{col.uniqueCount} unique values</div>
              </div>
            ))}
          </div>
        )}
        {tab === "spec" && (
          <pre style={{ margin: 0, fontSize: 11.5, fontFamily: "var(--font-mono, monospace)", overflow: "auto" }}>
            {JSON.stringify({ ...(spec ?? {}), data: { values: `[${dataset.rows.length} rows]` } }, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

const noFile = (): never => {
  throw new Error("Charts are created from an attached table, not from a file.");
};

export const vegaAttachProfile: AttachProfile<VegaAttachDraft> = {
  id: "vega",
  label: "Chart",
  // No extensions: this profile never matches a dropped file; it only derives from an existing artifact.
  match: { extensions: [] },
  analyze: async () => noFile(),
  build: async () => noFile(),

  steps: [
    {
      id: "template",
      title: "Pick a chart",
      description: "Choose a Vega-Lite template. You can refine the data mapping and styling next.",
      Component: TemplateStep,
    },
    {
      id: "encodings",
      title: "Map your data",
      description: "Assign columns to axes, color and size.",
      validate: validateVegaEncodings,
      Component: MappingStep,
    },
    {
      id: "style",
      title: "Style & labels",
      Component: StyleStep,
    },
  ],

  Preview: VegaPreview,

  derive: {
    matches: isVegaSourceArtifact,
    open: (view) => openVegaDraft(view),
    build: async (draft) => buildVegaResult(draft),
    submitLabel: "Apply Visualization to Post",
    cancelLabel: "Keep Raw Table Only",
  },
};
