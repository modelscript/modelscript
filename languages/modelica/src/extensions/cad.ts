// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentDefaultTransform } from "@modelscript/cad";
import {
  createMslGridSurfaceMesh,
  createMslPipeSurfaceMesh,
  createMslRectangleSurfaceMesh,
  createMslShapeMesh,
  createMslTorusMesh,
  extractArenaVisualizers,
  type ExtractedVisualizerComponent,
  type ProceduralMeshPayload,
} from "./visualizers.js";

export {
  createMslGridSurfaceMesh,
  createMslPipeSurfaceMesh,
  createMslRectangleSurfaceMesh,
  createMslShapeMesh,
  createMslTorusMesh,
  extractArenaVisualizers,
  type ExtractedVisualizerComponent,
  type ProceduralMeshPayload,
};

export interface ModelicaCadComponent {
  name: string;
  cad: string;
  dynamicBindings: any[];
  shapeType?: string | undefined;
  defaults?: ComponentDefaultTransform | undefined;
  proceduralMesh?: ProceduralMeshPayload | undefined;
}

/**
 * Extracts CAD components and standard `Modelica.Mechanics.MultiBody.Visualizers`
 * from a Modelica model using linear memory arena flattening.
 */
export function extractModelicaCadComponents(
  sharedContext: any,
  targetClassName: string,
  targetSymbolId?: number,
  uri?: string,
): ModelicaCadComponent[] {
  if (!sharedContext || !targetClassName) return [];

  const arena =
    typeof sharedContext.flattenArena === "function"
      ? sharedContext.flattenArena(targetClassName, targetSymbolId, uri)
      : sharedContext;
  if (!arena) return [];

  const data: ModelicaCadComponent[] = [];
  const seenNames = new Set<string>();

  // 1. Explicit `annotation(CAD(...))` variables
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const cad = arena.getVarCadAnnotation(i);
    if (cad) {
      const varName = arena.getVarName(i);
      const prefix = `${varName}.`;
      const bindings: { property: string; variable: string; value?: number | undefined }[] = [];

      for (let j = 0; j < arena.varCount; j++) {
        if (arena.isVarRemoved(j)) continue;
        const subName = arena.getVarName(j);
        if (subName.startsWith(prefix)) {
          const prop = subName.slice(prefix.length);
          bindings.push({
            property: prop,
            variable: subName,
            value: arena.getVarStartValue(j),
          });
        }
      }

      seenNames.add(varName);
      data.push({
        name: varName,
        cad,
        dynamicBindings: bindings,
      });
    }
  }

  // 2. Standard `Modelica.Mechanics.MultiBody.Visualizers` (`Shape`, `Vector`, `Surface`)
  const visualizers = extractArenaVisualizers(arena);
  for (const vis of visualizers) {
    if (seenNames.has(vis.name)) continue;
    seenNames.add(vis.name);
    data.push({
      name: vis.name,
      cad: vis.cad,
      shapeType: vis.shapeType,
      dynamicBindings: vis.dynamicBindings,
      defaults: vis.defaults,
      proceduralMesh: vis.proceduralMesh,
    });
  }

  return data;
}
