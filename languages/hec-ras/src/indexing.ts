// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseFlow, parseGeometry } from "./parser/hec-ras-parser.js";
import type { HecRasFlow, HecRasGeometry } from "./types.js";

export interface HecRasProjectModels {
  geometryFiles: Map<string, HecRasGeometry>;
  flowFiles: Map<string, HecRasFlow>;
}

export function indexHecRasFile(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const lower = uri.toLowerCase();
  const isGeom =
    lower.endsWith(".g01") ||
    lower.endsWith(".g02") ||
    lower.endsWith(".rasgeo") ||
    text.includes("Geom Title=") ||
    text.includes("Station Elevation Data=");
  const isFlow =
    lower.endsWith(".u01") ||
    lower.endsWith(".f01") ||
    text.includes("Flow Title=") ||
    text.includes("Boundary for River Reach");

  if (isGeom) {
    const geometry = parseGeometry(text);
    ctx.setParsedModel(geometry, "geometry");
    ctx.setParsedModel(geometry);

    const rootId = ctx.addSymbol(geometry.title || "HEC-RAS_Geometry", "Package", null, 0, text.length, {
      version: geometry.version,
    });
    for (const reach of geometry.reaches) {
      ctx.addSymbol(`${reach.river}:${reach.reach}`, "Class", rootId, 0, 0, {
        river: reach.river,
        reach: reach.reach,
      });
    }
    for (const xs of geometry.crossSections) {
      ctx.addSymbol(`RS_${xs.station}`, "Component", rootId, 0, 0, {
        river: xs.river,
        reach: xs.reach,
        station: xs.station,
      });
    }
  } else if (isFlow) {
    const flow = parseFlow(text);
    ctx.setParsedModel(flow, "flow");
    ctx.setParsedModel(flow);

    const rootId = ctx.addSymbol(flow.title || "HEC-RAS_Flow", "Package", null, 0, text.length);
    for (const bc of flow.boundaryConditions) {
      ctx.addSymbol(`${bc.river}:${bc.reach}@${bc.station}`, "Variable", rootId, 0, 0, {
        river: bc.river,
        reach: bc.reach,
        station: bc.station,
        type: bc.type,
      });
    }
  }
}

export function getHecRasProjectModels(workspace: UnifiedWorkspace): HecRasProjectModels {
  return {
    geometryFiles: workspace.getAllParsedModels<HecRasGeometry>("geometry"),
    flowFiles: workspace.getAllParsedModels<HecRasFlow>("flow"),
  };
}
