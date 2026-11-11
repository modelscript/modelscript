// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseAdams } from "./parser/adams-parser.js";
import type { AdamsDataset } from "./types.js";

/**
 * Declarative per-file indexer for MSC Adams multibody models (`.adm`, `.cmd`, `.acf`).
 * Resolves parts, markers, joints, forces, and motions across workspace documents.
 */
export function indexAdamsDocument(ctx: DslIndexFileContext): void {
  const dataset = parseAdams(ctx.text, ctx.uri);
  ctx.setParsedModel<AdamsDataset>(dataset);

  const modelName = dataset.title || "AdamsMechanism";
  const rootId = ctx.addSymbol(
    modelName,
    "Class",
    null,
    0,
    ctx.text.length,
    {
      numParts: dataset.parts.size,
      numMarkers: dataset.markers.size,
      numJoints: dataset.joints.size,
      numForces: dataset.forces.size,
      numMotions: dataset.motions.size,
    },
    {
      ruleName: "adams_dataset",
      namePath: modelName,
    },
  );

  const addChild = (name: string, kind: string, meta?: Record<string, unknown>, startOffset = 0, endOffset = 0) => {
    ctx.addSymbol(name, kind, rootId, startOffset, endOffset, meta ?? {}, {
      ruleName: "adams_element",
      namePath: `${modelName}.${name}`,
    });
  };

  for (const [pId, part] of dataset.parts.entries()) {
    addChild(
      part.name,
      "Variable",
      {
        id: pId,
        isGround: part.isGround,
        mass: part.mass,
        inertia: part.inertia,
      },
      part.range?.startOffset ?? 0,
      part.range?.endOffset ?? 0,
    );
  }

  for (const [mId, marker] of dataset.markers.entries()) {
    addChild(
      marker.name,
      "Field",
      {
        id: mId,
        partId: marker.partId,
        position: marker.position,
        orientation: marker.orientation,
      },
      marker.range?.startOffset ?? 0,
      marker.range?.endOffset ?? 0,
    );
  }

  for (const [jId, joint] of dataset.joints.entries()) {
    addChild(
      joint.name,
      "Method",
      {
        id: jId,
        type: joint.type,
        iMarker: joint.iMarkerId,
        jMarker: joint.jMarkerId,
        dof: joint.dofCount,
      },
      joint.range?.startOffset ?? 0,
      joint.range?.endOffset ?? 0,
    );
  }

  for (const [fId, force] of dataset.forces.entries()) {
    addChild(
      force.name,
      "Property",
      {
        id: fId,
        type: force.type,
        stiffness: force.stiffness,
        damping: force.damping,
      },
      force.range?.startOffset ?? 0,
      force.range?.endOffset ?? 0,
    );
  }

  for (const [motId, mot] of dataset.motions.entries()) {
    addChild(
      mot.name,
      "Event",
      {
        id: motId,
        type: mot.type,
        function: mot.functionExpr,
      },
      mot.range?.startOffset ?? 0,
      mot.range?.endOffset ?? 0,
    );
  }
}

/**
 * Retrieves a parsed `AdamsDataset` from `UnifiedWorkspace` for `uri`.
 */
export function getAdamsDataset(workspace: UnifiedWorkspace, uri: string): AdamsDataset | undefined {
  return workspace.getParsedModel<AdamsDataset>(uri);
}
