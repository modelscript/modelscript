// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure model for the Vega-Lite attach profile: how a tabular artifact becomes a chart draft, how the
 * draft compiles to a spec, and what artifact it produces. No React here, so it is directly unit-testable.
 */

import {
  isTabularDataArtifact,
  loadTabularDatasetFromArtifactView,
  type ParsedTabularDataset,
} from "../../../../util/tabular-data-parser";
import {
  buildVegaLiteSpec,
  inferInitialWizardConfig,
  VEGA_LITE_TEMPLATES,
  type VegaTemplateMeta,
  type VegaWizardConfig,
} from "../../vega-wizard-templates";
import type { AttachAnalysis, AttachBuildResult, AttachEditableView, AttachIssue } from "../types";

export interface VegaAttachDraft {
  dataset: ParsedTabularDataset;
  config: VegaWizardConfig;
  /** Where the raw data came from, carried onto the chart so it stays traceable. */
  sourceUrl?: string | undefined;
}

/** The loose artifact-view shape the tabular parser expects. */
function asSourceView(view: AttachEditableView): Record<string, unknown> {
  return {
    view_type: view.artifact_type,
    artifact_type: view.artifact_type,
    title: view.title,
    view_config: view.view_config,
  };
}

export function isVegaSourceArtifact(view: AttachEditableView): boolean {
  return isTabularDataArtifact(asSourceView(view));
}

export function templateMeta(templateId: string): VegaTemplateMeta {
  return VEGA_LITE_TEMPLATES.find((t) => t.id === templateId) ?? VEGA_LITE_TEMPLATES[0]!;
}

export function compileVegaSpec(draft: VegaAttachDraft): Record<string, unknown> | null {
  if (draft.dataset.rows.length === 0) return null;
  return buildVegaLiteSpec(draft.config, draft.dataset);
}

/** Load the dataset behind an artifact and pick smart defaults (or restore a saved wizard configuration). */
export async function openVegaDraft(view: AttachEditableView): Promise<AttachAnalysis<VegaAttachDraft>> {
  const raw = view.view_config;
  const sourceUrl =
    (typeof raw["sourceUrl"] === "string" && raw["sourceUrl"]) ||
    (typeof raw["url"] === "string" && raw["url"]) ||
    undefined;

  const dataset = await loadTabularDatasetFromArtifactView(asSourceView(view));
  const saved = raw["wizardConfig"];
  const config: VegaWizardConfig = {
    ...inferInitialWizardConfig(dataset),
    ...(saved && typeof saved === "object" ? (saved as Partial<VegaWizardConfig>) : {}),
  };

  const issues: AttachIssue[] = [];
  if (dataset.columns.length === 0) issues.push({ severity: "error", message: "No columns were found in this data." });
  else if (dataset.rows.length === 0) issues.push({ severity: "error", message: "This table has no rows to chart." });

  return {
    draft: { dataset, config, sourceUrl: sourceUrl || undefined },
    chips: [
      { label: dataset.format.toUpperCase() },
      { label: `${dataset.rows.length.toLocaleString()} rows` },
      { label: `${dataset.columns.length} columns` },
    ],
    issues,
  };
}

/** Switch to another table of a multi-table dataset; encodings are re-inferred for it. */
export function selectVegaTable(draft: VegaAttachDraft, tableId: string): VegaAttachDraft {
  const found = draft.dataset.tables.find((t) => t.id === tableId);
  if (!found) return draft;
  const dataset: ParsedTabularDataset = {
    ...draft.dataset,
    activeTableId: found.id,
    columns: found.columns,
    rows: found.rows,
  };
  return { ...draft, dataset, config: inferInitialWizardConfig(dataset) };
}

export function validateVegaEncodings(draft: VegaAttachDraft): AttachIssue[] {
  const issues: AttachIssue[] = [];
  const names = new Set(draft.dataset.columns.map((c) => c.name));
  const { config } = draft;
  if (!config.xField || !names.has(config.xField)) {
    issues.push({ severity: "error", message: "Choose a column for the X axis." });
  }
  if (config.templateId !== "histogram" && (!config.yField || !names.has(config.yField))) {
    issues.push({ severity: "error", message: "Choose a column for the Y axis." });
  }
  if (issues.length === 0 && compileVegaSpec(draft) === null) {
    issues.push({ severity: "error", message: "A chart can't be built from these settings." });
  }
  return issues;
}

export function vegaChartTitle(draft: VegaAttachDraft): string {
  return draft.config.title.trim() || `${draft.dataset.title} Visualization`;
}

/** The new `vega-plot` artifact. The source table artifact is left untouched. */
export function buildVegaResult(draft: VegaAttachDraft): AttachBuildResult {
  const spec = compileVegaSpec(draft);
  if (!spec) throw new Error("A chart can't be built from these settings.");
  const chartTitle = vegaChartTitle(draft);
  const { dataset } = draft;
  return {
    artifact_type: "vega-plot",
    title: `📊 ${chartTitle}`,
    displayTitle: chartTitle,
    view_config: {
      spec,
      data: dataset.rows,
      ...(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {}),
      title: chartTitle,
      format: dataset.format,
      rowCount: dataset.rows.length,
      columnCount: dataset.columns.length,
      columns: dataset.columns.map((c) => c.name),
      wizardConfig: draft.config,
    },
  };
}
