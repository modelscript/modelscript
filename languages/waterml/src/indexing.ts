// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseWaterMl } from "./parser/waterml-parser.js";

export interface WaterMlIndexedModel {
  uri: string;
  docId: string;
  timeSeriesCount: number;
  stationIds: string[];
  observedProperties: string[];
}

export type WaterMlWorkspaceModel = WaterMlIndexedModel;

/**
 * Content predicate for disambiguating OGC WaterML 2.0 / TimeseriesML across shared `.xml` and `.json` extensions.
 */
export function canIndexWaterMlFile(uri: string, text = ""): boolean {
  if (/\.(?:waterml|wml2)$/i.test(uri)) return true;
  return /waterml|wml2:|TimeseriesML|tsml:|"timeSeries"\s*:/i.test(text);
}

/**
 * Declarative `UnifiedWorkspace` file indexer for OGC WaterML 2.0 / TimeseriesML documents.
 */
export function indexWaterMlFile(ctx: DslIndexFileContext): void {
  try {
    const doc = parseWaterMl(ctx.text);
    const stationIds = Array.from(new Set(doc.timeSeriesList.map((ts) => ts.monitoringPoint.stationId)));
    const observedProperties = Array.from(new Set(doc.timeSeriesList.map((ts) => ts.observedProperty)));

    const summary: WaterMlIndexedModel = {
      uri: ctx.uri,
      docId: doc.id,
      timeSeriesCount: doc.timeSeriesList.length,
      stationIds,
      observedProperties,
    };

    ctx.setParsedModel(summary);
    ctx.setParsedModel(doc, "document");

    const rootId = ctx.addSymbol(doc.id || "WaterMlCollection", "Package", null, 0, ctx.text.length, {
      timeSeriesCount: doc.timeSeriesList.length,
      stationIds,
      observedProperties,
    });

    for (const ts of doc.timeSeriesList) {
      ctx.addSymbol(ts.seriesId, "Variable", rootId, 0, 0, {
        stationId: ts.monitoringPoint.stationId,
        observedProperty: ts.observedProperty,
        unit: ts.unit,
        pointCount: ts.points.length,
      });
    }
  } catch {
    // Ignore indexing errors for non-WaterML files
  }
}

/**
 * Retrieves the indexed WaterML metadata summary for `uri` from `workspace`.
 */
export function getWaterMlModel(workspace: UnifiedWorkspace, uri: string): WaterMlIndexedModel | undefined {
  return workspace.getParsedModel<WaterMlIndexedModel>(uri);
}

/**
 * Lists all indexed WaterML metadata summaries across `workspace`.
 */
export function getAllWaterMlModels(workspace: UnifiedWorkspace): WaterMlIndexedModel[] {
  return Array.from(workspace.getAllParsedModels<WaterMlIndexedModel>().values());
}
