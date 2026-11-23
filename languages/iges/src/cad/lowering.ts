// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Lowering IGES 5.3 geometry to `@modelscript/cad` Solids & Assemblies.
 */

import {
  assembly,
  box,
  cylinder,
  part,
  polyhedron,
  translate,
  type Assembly,
  type PartEntry,
  type Solid,
} from "@modelscript/cad";
import { parseIges } from "../parser/iges-parser.js";
import type { IgesDocument } from "../types.js";
import { evaluateIgesDocument, type EvaluateIgesOptions, type IgesEvaluationResult } from "./evaluator.js";

export interface IgesCadLoweringOptions extends EvaluateIgesOptions {
  assemblyName?: string;
  /** Default thickness/diameter for wireframe curves lowered to solid proxies (default: 0.005). */
  wireThickness?: number;
}

export interface IgesCadLoweringResult {
  assembly: Assembly;
  solids: Solid[];
  evaluation: IgesEvaluationResult;
  summary: {
    entityCount: number;
    solidCount: number;
    totalCurveLength: number;
    totalSurfaceArea: number;
    hasBRep: boolean;
  };
}

/**
 * Lower an IGES 5.3 document into `@modelscript/cad` `Solid` primitives and an `Assembly`.
 */
export function lowerIgesToCad(
  input: IgesDocument | string,
  options: IgesCadLoweringOptions = {},
): IgesCadLoweringResult {
  const doc = typeof input === "string" ? parseIges(input) : input;
  const evaluation = evaluateIgesDocument(doc, options);
  const wireThickness = options.wireThickness ?? 0.005;

  const solids: Solid[] = [];
  const parts: PartEntry[] = [];
  let hasBRep = false;

  for (const ev of evaluation.entities) {
    const tag = ev.label || `IGES_D${ev.deNumber}_T${ev.entityType}`;

    if (ev.entityType === 186) {
      hasBRep = true;
      if (ev.boundingBox) {
        const dx = Math.max(wireThickness, ev.boundingBox.max[0] - ev.boundingBox.min[0]);
        const dy = Math.max(wireThickness, ev.boundingBox.max[1] - ev.boundingBox.min[1]);
        const dz = Math.max(wireThickness, ev.boundingBox.max[2] - ev.boundingBox.min[2]);
        const cx = 0.5 * (ev.boundingBox.min[0] + ev.boundingBox.max[0]);
        const cy = 0.5 * (ev.boundingBox.min[1] + ev.boundingBox.max[1]);
        const cz = 0.5 * (ev.boundingBox.min[2] + ev.boundingBox.max[2]);
        const solid = translate(box({ width: dx, height: dy, depth: dz, name: tag }), [cx, cy, cz]);
        solids.push(solid);
        parts.push(part(solid, { material: "IGES_BRep" }));
      }
      continue;
    }

    if (ev.mesh && ev.mesh.vertices.length >= 3 && ev.mesh.triangles.length >= 1) {
      const solid = polyhedron({
        name: tag,
        points: ev.mesh.vertices,
        faces: ev.mesh.triangles,
      });
      solids.push(solid);
      parts.push(part(solid, { material: "IGES_Surface" }));
      continue;
    }

    if (ev.entityType === 100 && ev.arc && ev.arc.radius > 0) {
      const solid = translate(
        cylinder({
          name: tag,
          radius: ev.arc.radius,
          height: wireThickness,
          segments: 32,
        }),
        ev.arc.center,
      );
      solids.push(solid);
      parts.push(part(solid, { material: "IGES_Arc" }));
      continue;
    }

    if (ev.boundingBox && (ev.entityType === 110 || ev.entityType === 126 || ev.entityType === 106)) {
      const dx = Math.max(wireThickness, ev.boundingBox.max[0] - ev.boundingBox.min[0]);
      const dy = Math.max(wireThickness, ev.boundingBox.max[1] - ev.boundingBox.min[1]);
      const dz = Math.max(wireThickness, ev.boundingBox.max[2] - ev.boundingBox.min[2]);
      const cx = 0.5 * (ev.boundingBox.min[0] + ev.boundingBox.max[0]);
      const cy = 0.5 * (ev.boundingBox.min[1] + ev.boundingBox.max[1]);
      const cz = 0.5 * (ev.boundingBox.min[2] + ev.boundingBox.max[2]);
      const solid = translate(box({ width: dx, height: dy, depth: dz, name: tag }), [cx, cy, cz]);
      solids.push(solid);
      parts.push(part(solid, { material: "IGES_Curve" }));
    }
  }

  const asmName = options.assemblyName ?? doc.global?.productIdSender ?? doc.global?.fileName ?? "IGES_Assembly";

  return {
    assembly: assembly(asmName || "IGES_Assembly", parts),
    solids,
    evaluation,
    summary: {
      entityCount: doc.entities.length,
      solidCount: solids.length,
      totalCurveLength: evaluation.totalCurveLength,
      totalSurfaceArea: evaluation.totalSurfaceArea,
      hasBRep,
    },
  };
}
