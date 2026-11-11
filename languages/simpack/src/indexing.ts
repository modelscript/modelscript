// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simpack — Declarative UnifiedWorkspace Indexing & Multi-Body Assembly Helpers.
 *
 * Indexes SIMPACK models (.spck, .sim, .mbs) into UnifiedWorkspace and merges sub-assemblies.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseSimDeck } from "./parser/sim-deck-parser.js";
import { parseSpckXml } from "./parser/spck-xml-parser.js";
import type { SimpackModel } from "./types.js";

export const simpackIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".spck") || lower.endsWith(".sim") || lower.endsWith(".mbs")) {
      return true;
    }
    return Boolean(text && text.includes("<simpack_model"));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const isXml = ctx.text.trimStart().startsWith("<");
    const parsedModel = isXml ? parseSpckXml(ctx.text, ctx.uri) : parseSimDeck(ctx.text, ctx.uri);
    ctx.setParsedModel(parsedModel);

    const modelName = parsedModel.name || "SimpackMechanism";
    const rootId = ctx.addSymbol(
      modelName,
      "Class",
      null,
      0,
      ctx.text.length,
      {
        numBodies: parsedModel.bodies.size,
        numMarkers: parsedModel.markers.size,
        numJoints: parsedModel.joints.size,
        numForces: parsedModel.forces.size,
      },
      {
        ruleName: "simpack_model",
        namePath: modelName,
      },
    );

    for (const [bId, body] of parsedModel.bodies.entries()) {
      ctx.addSymbol(
        bId,
        "Component",
        rootId,
        0,
        0,
        { type: "body", mass: body.mass, inertia: body.inertia },
        {
          ruleName: "simpack_element",
          namePath: `${modelName}.${bId}`,
        },
      );
    }

    for (const [mId, marker] of parsedModel.markers.entries()) {
      ctx.addSymbol(
        mId,
        "Component",
        rootId,
        0,
        0,
        { type: "marker", body: marker.bodyId, pos: marker.position },
        {
          ruleName: "simpack_element",
          namePath: `${modelName}.${mId}`,
        },
      );
    }

    for (const [jId, joint] of parsedModel.joints.entries()) {
      ctx.addSymbol(
        jId,
        "Component",
        rootId,
        0,
        0,
        { type: "joint", jointType: joint.type, from: joint.fromMarker, to: joint.toMarker },
        {
          ruleName: "simpack_element",
          namePath: `${modelName}.${jId}`,
        },
      );
    }
  },
};

/**
 * Merges multiple SIMPACK sub-models or sub-assemblies stored in `UnifiedWorkspace` into a unified multibody model.
 */
export function mergeSimpackAssembly(
  workspace: UnifiedWorkspace,
  mainModel: SimpackModel,
  subModelUris: string[],
): SimpackModel {
  const merged: SimpackModel = {
    name: mainModel.name,
    bodies: new Map(mainModel.bodies),
    markers: new Map(mainModel.markers),
    joints: new Map(mainModel.joints),
    forces: new Map(mainModel.forces),
  };

  for (const subUri of subModelUris) {
    const sub = workspace.getParsedModel<SimpackModel>(subUri);
    if (!sub) continue;
    const prefix = sub.name || "sub";

    for (const [id, body] of sub.bodies.entries()) {
      merged.bodies.set(`${prefix}.${id}`, {
        ...body,
        id: `${prefix}.${id}`,
        name: `${prefix}.${body.name}`,
        markerId: `${prefix}.${body.markerId}`,
      });
    }
    for (const [id, marker] of sub.markers.entries()) {
      const bodyId = marker.bodyId === "$inertial" ? "$inertial" : `${prefix}.${marker.bodyId}`;
      merged.markers.set(`${prefix}.${id}`, {
        ...marker,
        id: `${prefix}.${id}`,
        name: `${prefix}.${marker.name}`,
        bodyId,
      });
    }
    for (const [id, joint] of sub.joints.entries()) {
      merged.joints.set(`${prefix}.${id}`, {
        ...joint,
        id: `${prefix}.${id}`,
        name: `${prefix}.${joint.name}`,
        fromMarker: `${prefix}.${joint.fromMarker}`,
        toMarker: `${prefix}.${joint.toMarker}`,
      });
    }
    for (const [id, force] of sub.forces.entries()) {
      merged.forces.set(`${prefix}.${id}`, {
        ...force,
        id: `${prefix}.${id}`,
        name: `${prefix}.${force.name}`,
        markerA: `${prefix}.${force.markerA}`,
        markerB: `${prefix}.${force.markerB}`,
      });
    }
  }

  return merged;
}
