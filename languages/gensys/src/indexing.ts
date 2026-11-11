// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseGensysDeck } from "./parser/deck-parser.js";
import type { GensysModel } from "./types.js";

/**
 * Declarative multi-file workspace indexer for GENSYS models (.calc, .run, .sub, .geom, .trax, .wheel).
 */
export function indexGensysDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const parsedModel = parseGensysDeck(text, uri);
  ctx.setParsedModel(parsedModel);

  const modelName = parsedModel.name || "GensysVehicle";
  const rootId = ctx.addSymbol(
    modelName,
    "Class",
    null,
    0,
    text.length,
    {
      numBodies: parsedModel.bodies.size,
      numWheelsets: parsedModel.wheelsets.size,
      numCouplings: parsedModel.couplings.size,
      subsystems: parsedModel.subsystems,
    },
    { ruleName: "Class", namePath: modelName },
  );

  for (const [bName, body] of parsedModel.bodies.entries()) {
    ctx.addSymbol(
      bName,
      "Component",
      rootId,
      0,
      0,
      { type: "body", mass: body.mass, inertia: body.inertia },
      { ruleName: "Component", namePath: `${modelName}.${bName}` },
    );
  }

  for (const [wName, ws] of parsedModel.wheelsets.entries()) {
    ctx.addSymbol(
      wName,
      "Component",
      rootId,
      0,
      0,
      { type: "wheelset", gauge: ws.gauge, radius: ws.wheelRadius },
      { ruleName: "Component", namePath: `${modelName}.${wName}` },
    );
  }

  for (const [sName, s] of parsedModel.couplings.entries()) {
    ctx.addSymbol(
      sName,
      "Component",
      rootId,
      0,
      0,
      { type: "spring_damper", body1: s.body1, body2: s.body2 },
      { ruleName: "Component", namePath: `${modelName}.${sName}` },
    );
  }
}

export function getGensysModel(workspace: UnifiedWorkspace, uri: string): GensysModel | undefined {
  return workspace.getParsedModel<GensysModel>(uri);
}

/**
 * Resolves and deeply merges all referenced child subsystems (`sub <name>`)
 * into a unified vehicle model assembly across indexed workspace files.
 */
export function resolveGensysSubsystems(
  workspace: UnifiedWorkspace,
  mainModel: GensysModel,
  currentUri?: string,
): GensysModel {
  if (!mainModel.subsystems || mainModel.subsystems.length === 0) {
    return mainModel;
  }

  const resolved: GensysModel = {
    name: mainModel.name,
    subsystems: [...mainModel.subsystems],
    bodies: new Map(mainModel.bodies),
    couplings: new Map(mainModel.couplings),
    wheelsets: new Map(mainModel.wheelsets),
  };

  const fileModels = workspace.getAllParsedModels<GensysModel>();

  for (const subName of mainModel.subsystems) {
    let subModel: GensysModel | undefined;
    for (const [uri, m] of fileModels.entries()) {
      if (uri === currentUri) continue;
      const baseName = uri.split("/").pop()?.split(".")[0];
      if (baseName === subName || m.name === subName) {
        subModel = m;
        break;
      }
    }

    if (!subModel) continue;

    for (const [bName, body] of subModel.bodies.entries()) {
      const prefixedName = `${subName}.${bName}`;
      resolved.bodies.set(prefixedName, {
        ...body,
        name: prefixedName,
      });
    }

    for (const [wName, ws] of subModel.wheelsets.entries()) {
      const prefixedName = `${subName}.${wName}`;
      resolved.wheelsets.set(prefixedName, {
        ...ws,
        name: prefixedName,
      });
    }

    for (const [sName, s] of subModel.couplings.entries()) {
      const prefixedName = `${subName}.${sName}`;
      const b1 = s.body1 === "ground" || mainModel.bodies.has(s.body1) ? s.body1 : `${subName}.${s.body1}`;
      const b2 = s.body2 === "ground" || mainModel.bodies.has(s.body2) ? s.body2 : `${subName}.${s.body2}`;

      resolved.couplings.set(prefixedName, {
        ...s,
        name: prefixedName,
        body1: b1,
        body2: b2,
      });
    }
  }

  return resolved;
}

export { resolveGensysSubsystems as resolveSubsystems };
