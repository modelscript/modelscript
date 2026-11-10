// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseFlow, parseGeometry } from "./parser/hec-ras-parser.js";
import type { HecRasFlow, HecRasGeometry } from "./types.js";

export interface HecRasWorkspaceModel {
  uri: string;
  projectTitle?: string;
  geometryFiles: Map<string, HecRasGeometry>;
  flowFiles: Map<string, HecRasFlow>;
}

export class HecRasWorkspaceIndex {
  private readonly models = new Map<string, HecRasWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    const isGeom =
      uri.endsWith(".g01") ||
      uri.endsWith(".g02") ||
      uri.endsWith(".rasgeo") ||
      content.includes("Geom Title=") ||
      content.includes("Station Elevation Data=");
    const isFlow =
      uri.endsWith(".u01") ||
      uri.endsWith(".f01") ||
      content.includes("Flow Title=") ||
      content.includes("Boundary for River Reach");

    let model = this.models.get("default");
    if (!model) {
      model = {
        uri: "default",
        geometryFiles: new Map(),
        flowFiles: new Map(),
      };
      this.models.set("default", model);
    }

    if (isGeom) {
      model.geometryFiles.set(uri, parseGeometry(content));
    } else if (isFlow) {
      model.flowFiles.set(uri, parseFlow(content));
    }
  }

  public getModel(uri = "default"): HecRasWorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public clear(): void {
    this.models.clear();
  }
}
