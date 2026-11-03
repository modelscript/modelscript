// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ParsedTabularDataset, TabularColumn, VegaFieldType } from "../../util/tabular-data-parser";

export type VegaTemplateId =
  | "line"
  | "multi-line"
  | "scatter"
  | "scatter-regression"
  | "area"
  | "bar"
  | "histogram"
  | "boxplot"
  | "heatmap"
  | "errorband"
  | "splom";

export type VegaTemplateCategory = "all" | "trends" | "correlation" | "distribution" | "categorical";

export type VegaAggregation = "none" | "mean" | "sum" | "min" | "max" | "median" | "count";

export type VegaScaleType = "linear" | "log" | "symlog";

export interface VegaTemplateMeta {
  id: VegaTemplateId;
  name: string;
  category: Exclude<VegaTemplateCategory, "all">;
  badge: string;
  description: string;
  supportsY2: boolean;
  supportsSize: boolean;
  supportsAggregation: boolean;
}

export interface VegaWizardConfig {
  templateId: VegaTemplateId;
  title: string;
  subtitle: string;
  xField: string;
  yField: string;
  y2Field: string;
  colorField: string;
  sizeField: string;
  facetField: string;
  xTitle: string;
  yTitle: string;
  aggregation: VegaAggregation;
  xScale: VegaScaleType;
  yScale: VegaScaleType;
  colorScheme: string;
  showPoints: boolean;
  showGrid: boolean;
  interactiveZoom: boolean;
}

export const VEGA_COLOR_SCHEMES: Array<{ id: string; label: string }> = [
  { id: "category10", label: "Category 10 (Default)" },
  { id: "tableau10", label: "Tableau 10" },
  { id: "viridis", label: "Viridis (Scientific)" },
  { id: "plasma", label: "Plasma (Thermal)" },
  { id: "inferno", label: "Inferno" },
  { id: "blues", label: "Engineering Blues" },
  { id: "tealblues", label: "Cyan / Teal" },
  { id: "dark2", label: "High-Contrast Dark2" },
];

export const VEGA_LITE_TEMPLATES: VegaTemplateMeta[] = [
  {
    id: "line",
    name: "Line Trajectory",
    category: "trends",
    badge: "TIME-SERIES",
    description: "Continuous line plot for time-series signals, trajectories, or parameter sweeps.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: true,
  },
  {
    id: "multi-line",
    name: "Dual-Signal Overlay",
    category: "trends",
    badge: "MULTI-TRACE",
    description: "Compare two quantitative variables (Y1 & Y2) simultaneously over a shared X axis.",
    supportsY2: true,
    supportsSize: false,
    supportsAggregation: false,
  },
  {
    id: "area",
    name: "Stacked / Filled Area",
    category: "trends",
    badge: "AREA",
    description: "Filled area chart emphasizing cumulative magnitude or energy over an axis.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: true,
  },
  {
    id: "scatter",
    name: "Scatter / Bubble Plot",
    category: "correlation",
    badge: "CORRELATION",
    description: "2D scatter plot with optional color grouping and bubble size encoding.",
    supportsY2: false,
    supportsSize: true,
    supportsAggregation: false,
  },
  {
    id: "scatter-regression",
    name: "Scatter + Regression Fit",
    category: "correlation",
    badge: "TRENDLINE",
    description: "Scatter plot overlaid with an automatic linear regression trendline.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: false,
  },
  {
    id: "bar",
    name: "Grouped / Stacked Bar",
    category: "categorical",
    badge: "CATEGORICAL",
    description: "Compare categorical buckets or aggregated metrics across groups.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: true,
  },
  {
    id: "histogram",
    name: "Histogram Distribution",
    category: "distribution",
    badge: "DISTRIBUTION",
    description: "Automatically binned frequency histogram showing empirical distribution.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: false,
  },
  {
    id: "boxplot",
    name: "Box & Whisker Plot",
    category: "distribution",
    badge: "QUARTILES",
    description: "Median, interquartile range (IQR), and extrema across categories.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: false,
  },
  {
    id: "heatmap",
    name: "2D Density Heatmap",
    category: "distribution",
    badge: "2D BINNED",
    description: "2D binned rectangular heatmap revealing point density and clusters.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: true,
  },
  {
    id: "errorband",
    name: "Mean + Confidence Band",
    category: "trends",
    badge: "UNCERTAINTY",
    description: "Mean trajectory line with a shaded standard deviation / confidence interval band.",
    supportsY2: false,
    supportsSize: false,
    supportsAggregation: false,
  },
  {
    id: "splom",
    name: "Scatter Matrix (SPLOM)",
    category: "correlation",
    badge: "MULTIVARIATE",
    description: "Pairwise correlation grid across up to 4 quantitative variables.",
    supportsY2: true,
    supportsSize: false,
    supportsAggregation: false,
  },
];

/**
 * Infers sensible initial axes, groupings, and template selection from the dataset's columns.
 */
export function inferInitialWizardConfig(dataset: ParsedTabularDataset): VegaWizardConfig {
  const cols = dataset.columns;
  const quantCols = cols.filter((c) => c.vegaType === "quantitative");
  const temporalCols = cols.filter((c) => c.vegaType === "temporal");
  const nominalCols = cols.filter((c) => c.vegaType === "nominal" || c.vegaType === "ordinal");

  // Prefer time/step/index column for X
  const timeLikeCol =
    temporalCols[0] ||
    quantCols.find((c) => /^(t|time|timestamp|date|step|epoch|index|id|freq|frequency|x)$/i.test(c.name)) ||
    quantCols.find((c) => c.isMonotonic) ||
    quantCols[0] ||
    cols[0];

  const xField = timeLikeCol?.name || "";

  const remainingQuant = quantCols.filter((c) => c.name !== xField);
  const yCol = remainingQuant[0] || quantCols[0] || cols[1] || cols[0];
  const yField = yCol?.name || "";

  const y2Col = remainingQuant[1] || remainingQuant[0];
  const y2Field = y2Col && y2Col.name !== yField ? y2Col.name : "";

  // Pick a low-cardinality categorical column for color if present
  const colorCol = nominalCols.find((c) => c.uniqueCount > 1 && c.uniqueCount <= 20 && c.name !== xField);
  const colorField = colorCol?.name || "";

  // Choose best default template
  let defaultTemplate: VegaTemplateId = "line";
  if (quantCols.length >= 2 && !timeLikeCol?.isMonotonic && temporalCols.length === 0) {
    defaultTemplate = "scatter";
  } else if (quantCols.length === 1 && nominalCols.length >= 1) {
    defaultTemplate = "bar";
  } else if (quantCols.length === 1 && nominalCols.length === 0) {
    defaultTemplate = "histogram";
  }

  const cleanTitle = dataset.title.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());

  return {
    templateId: defaultTemplate,
    title: cleanTitle || "Data Visualization",
    subtitle: `${dataset.rows.length.toLocaleString()} rows · ${dataset.format.toUpperCase()} dataset`,
    xField,
    yField,
    y2Field,
    colorField,
    sizeField: "",
    facetField: "",
    xTitle: xField,
    yTitle: yField,
    aggregation: "none",
    xScale: "linear",
    yScale: "linear",
    colorScheme: "category10",
    showPoints: false,
    showGrid: true,
    interactiveZoom: true,
  };
}

function resolveFieldType(
  field: string,
  columns: TabularColumn[],
  fallback: VegaFieldType = "quantitative",
): VegaFieldType {
  const found = columns.find((c) => c.name === field);
  return found ? found.vegaType : fallback;
}

/**
 * Compiles a `VegaWizardConfig` and `ParsedTabularDataset` into a complete Vega-Lite v5 JSON specification.
 */
export function buildVegaLiteSpec(config: VegaWizardConfig, dataset: ParsedTabularDataset): Record<string, unknown> {
  const cols = dataset.columns;
  const xType = resolveFieldType(config.xField, cols, "quantitative");
  const yType = resolveFieldType(config.yField, cols, "quantitative");
  const colorType = config.colorField ? resolveFieldType(config.colorField, cols, "nominal") : undefined;
  const sizeType = config.sizeField ? resolveFieldType(config.sizeField, cols, "quantitative") : undefined;

  const baseSpec: Record<string, unknown> = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    width: "container",
    height: 320,
    background: "transparent",
    ...(config.title.trim()
      ? {
          title: {
            text: config.title.trim(),
            ...(config.subtitle.trim() ? { subtitle: config.subtitle.trim() } : {}),
            anchor: "start",
            fontSize: 14,
            subtitleFontSize: 11.5,
          },
        }
      : {}),
    data: {
      values: dataset.rows,
    },
  };

  const xScaleObj = xType === "quantitative" && config.xScale !== "linear" ? { scale: { type: config.xScale } } : {};
  const yScaleObj = yType === "quantitative" && config.yScale !== "linear" ? { scale: { type: config.yScale } } : {};

  const xAxisObj = {
    axis: {
      grid: config.showGrid,
      ...(config.xTitle.trim() ? { title: config.xTitle.trim() } : {}),
    },
  };
  const yAxisObj = {
    axis: {
      grid: config.showGrid,
      ...(config.yTitle.trim() ? { title: config.yTitle.trim() } : {}),
    },
  };

  const colorEncoding = config.colorField
    ? {
        color: {
          field: config.colorField,
          type: colorType,
          scale: { scheme: config.colorScheme },
        },
      }
    : {};

  const sizeEncoding =
    config.sizeField && config.templateId === "scatter"
      ? {
          size: {
            field: config.sizeField,
            type: sizeType,
          },
        }
      : {};

  const facetEncoding = config.facetField
    ? {
        facet: {
          field: config.facetField,
          type: resolveFieldType(config.facetField, cols, "nominal"),
          columns: 2,
        },
      }
    : {};

  const aggOp = config.aggregation !== "none" ? config.aggregation : undefined;

  const zoomParams = config.interactiveZoom
    ? {
        params: [{ name: "grid_zoom", select: "interval", bind: "scales" }],
      }
    : {};

  const tooltipFields: Array<Record<string, unknown>> = [];
  if (config.xField) tooltipFields.push({ field: config.xField, type: xType });
  if (config.yField) tooltipFields.push({ field: config.yField, type: yType, ...(aggOp ? { aggregate: aggOp } : {}) });
  if (config.y2Field && config.templateId === "multi-line") {
    tooltipFields.push({ field: config.y2Field, type: resolveFieldType(config.y2Field, cols, "quantitative") });
  }
  if (config.colorField) tooltipFields.push({ field: config.colorField, type: colorType });
  if (config.sizeField) tooltipFields.push({ field: config.sizeField, type: sizeType });

  switch (config.templateId) {
    case "multi-line": {
      const foldFields = [config.yField, config.y2Field].filter(Boolean);
      return {
        ...baseSpec,
        ...zoomParams,
        transform: [
          {
            fold: foldFields,
            as: ["Signal", "Value"],
          },
        ],
        mark: {
          type: "line",
          point: config.showPoints,
          strokeWidth: 2,
          tooltip: true,
        },
        encoding: {
          x: {
            field: config.xField,
            type: xType,
            ...xScaleObj,
            ...xAxisObj,
          },
          y: {
            field: "Value",
            type: "quantitative",
            ...yScaleObj,
            ...yAxisObj,
          },
          color: {
            field: "Signal",
            type: "nominal",
            scale: { scheme: config.colorScheme },
          },
          tooltip: [
            { field: config.xField, type: xType },
            { field: "Signal", type: "nominal" },
            { field: "Value", type: "quantitative" },
          ],
        },
      };
    }

    case "scatter-regression": {
      return {
        ...baseSpec,
        layer: [
          {
            ...zoomParams,
            mark: {
              type: "point",
              filled: true,
              opacity: 0.75,
              size: 64,
              tooltip: true,
            },
            encoding: {
              x: { field: config.xField, type: xType, ...xScaleObj, ...xAxisObj },
              y: { field: config.yField, type: yType, ...yScaleObj, ...yAxisObj },
              ...colorEncoding,
              tooltip: tooltipFields,
            },
          },
          {
            mark: {
              type: "line",
              color: "#f97316",
              strokeDash: [6, 4],
              strokeWidth: 2.2,
            },
            transform: [
              {
                regression: config.yField,
                on: config.xField,
                ...(config.colorField ? { groupby: [config.colorField] } : {}),
              },
            ],
            encoding: {
              x: { field: config.xField, type: "quantitative" },
              y: { field: config.yField, type: "quantitative" },
              ...(config.colorField ? colorEncoding : {}),
            },
          },
        ],
      };
    }

    case "histogram": {
      const targetField = config.xField || config.yField;
      return {
        ...baseSpec,
        mark: {
          type: "bar",
          cornerRadiusTopLeft: 3,
          cornerRadiusTopRight: 3,
          tooltip: true,
        },
        encoding: {
          x: {
            field: targetField,
            type: "quantitative",
            bin: { maxbins: 25 },
            ...xAxisObj,
          },
          y: {
            aggregate: "count",
            type: "quantitative",
            axis: {
              grid: config.showGrid,
              title: config.yTitle.trim() && config.yTitle !== config.yField ? config.yTitle.trim() : "Count",
            },
          },
          ...colorEncoding,
        },
      };
    }

    case "boxplot": {
      const categoryField = config.colorField || config.xField;
      const valueField = config.yField || config.xField;
      return {
        ...baseSpec,
        mark: {
          type: "boxplot",
          extent: "min-max",
          size: 32,
        },
        encoding: {
          x: {
            field: categoryField,
            type: resolveFieldType(categoryField, cols, "nominal"),
            ...xAxisObj,
          },
          y: {
            field: valueField,
            type: "quantitative",
            ...yScaleObj,
            ...yAxisObj,
          },
          ...colorEncoding,
        },
      };
    }

    case "heatmap": {
      return {
        ...baseSpec,
        mark: {
          type: "rect",
          tooltip: true,
        },
        encoding: {
          x: {
            field: config.xField,
            type: xType,
            ...(xType === "quantitative" ? { bin: { maxbins: 24 } } : {}),
            ...xAxisObj,
          },
          y: {
            field: config.yField,
            type: yType,
            ...(yType === "quantitative" ? { bin: { maxbins: 24 } } : {}),
            ...yAxisObj,
          },
          color: {
            ...(aggOp && aggOp !== "count" && config.colorField
              ? { aggregate: aggOp, field: config.colorField, type: "quantitative" }
              : { aggregate: "count", type: "quantitative" }),
            scale: { scheme: config.colorScheme === "category10" ? "viridis" : config.colorScheme },
          },
        },
      };
    }

    case "errorband": {
      return {
        ...baseSpec,
        layer: [
          {
            mark: {
              type: "errorband",
              extent: "stdev",
              opacity: 0.25,
            },
            encoding: {
              x: { field: config.xField, type: xType, ...xAxisObj },
              y: { field: config.yField, type: "quantitative", ...yAxisObj },
              ...colorEncoding,
            },
          },
          {
            mark: {
              type: "line",
              strokeWidth: 2,
              point: config.showPoints,
            },
            encoding: {
              x: { field: config.xField, type: xType },
              y: { field: config.yField, type: "quantitative", aggregate: "mean" },
              ...colorEncoding,
            },
          },
        ],
      };
    }

    case "splom": {
      const quantNames = cols
        .filter((c) => c.vegaType === "quantitative")
        .map((c) => c.name)
        .slice(0, 3);
      const repeatFields =
        quantNames.length >= 2
          ? quantNames
          : [config.xField, config.yField, config.y2Field].filter(Boolean).slice(0, 3);
      return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        background: "transparent",
        ...(config.title.trim() ? { title: config.title.trim() } : {}),
        data: { values: dataset.rows },
        repeat: {
          row: repeatFields,
          column: repeatFields,
        },
        spec: {
          width: 115,
          height: 115,
          mark: {
            type: "point",
            filled: true,
            opacity: 0.7,
            size: 28,
          },
          encoding: {
            x: { field: { repeat: "column" }, type: "quantitative" },
            y: { field: { repeat: "row" }, type: "quantitative" },
            ...colorEncoding,
          },
        },
      };
    }

    case "area":
    case "bar":
    case "scatter":
    case "line":
    default: {
      const markType =
        config.templateId === "area"
          ? "area"
          : config.templateId === "bar"
            ? "bar"
            : config.templateId === "scatter"
              ? "point"
              : "line";

      return {
        ...baseSpec,
        ...zoomParams,
        mark: {
          type: markType,
          ...(markType === "line" ? { strokeWidth: 2, point: config.showPoints } : {}),
          ...(markType === "area" ? { line: true, opacity: 0.35, point: config.showPoints } : {}),
          ...(markType === "point" ? { filled: true, size: 64, opacity: 0.85 } : {}),
          ...(markType === "bar" ? { cornerRadiusTopLeft: 3, cornerRadiusTopRight: 3 } : {}),
          tooltip: true,
        },
        encoding: {
          x: {
            field: config.xField,
            type: xType,
            ...xScaleObj,
            ...xAxisObj,
          },
          y: {
            ...(aggOp === "count"
              ? { aggregate: "count", type: "quantitative" }
              : {
                  field: config.yField,
                  type: yType,
                  ...(aggOp ? { aggregate: aggOp } : {}),
                  ...yScaleObj,
                }),
            ...yAxisObj,
          },
          ...colorEncoding,
          ...sizeEncoding,
          ...facetEncoding,
          tooltip: tooltipFields,
        },
      };
    }
  }
}
