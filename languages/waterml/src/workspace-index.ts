// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for OGC WaterML 2.0 / TimeseriesML Documents.
 */

import { parseWaterMl } from "./parser/waterml-parser.js";
import type { WaterMlDocument } from "./types.js";

export interface WaterMlWorkspaceModel {
  uri: string;
  docId: string;
  timeSeriesCount: number;
  stationIds: string[];
  observedProperties: string[];
}

export class WaterMlWorkspaceIndex {
  private readonly models = new Map<string, WaterMlWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    try {
      const doc = parseWaterMl(content);
      this.addDocument(uri, doc);
    } catch {
      // Ignore indexing errors for non-WaterML files
    }
  }

  public addDocument(uri: string, doc: WaterMlDocument): void {
    const stationIds = Array.from(new Set(doc.timeSeriesList.map((ts) => ts.monitoringPoint.stationId)));
    const observedProperties = Array.from(new Set(doc.timeSeriesList.map((ts) => ts.observedProperty)));

    this.models.set(uri, {
      uri,
      docId: doc.id,
      timeSeriesCount: doc.timeSeriesList.length,
      stationIds,
      observedProperties,
    });
  }

  public getModel(uri: string): WaterMlWorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public getAllModels(): WaterMlWorkspaceModel[] {
    return Array.from(this.models.values());
  }

  public clear(): void {
    this.models.clear();
  }
}
