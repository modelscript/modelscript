// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseWorkspaceIndex, type SymbolIndex } from "@modelscript/runtime";
import { parseGensysDeck } from "./parser/deck-parser.js";
import type { GensysModel } from "./types.js";

/**
 * Multi-File Workspace Indexer for GENSYS models.
 * Resolves vehicle bodies, wheelsets, spring-damper couplings, and subsystem inclusions (.sub).
 */
export class GensysWorkspaceIndex extends BaseWorkspaceIndex<GensysModel> {
  public readonly languageName = "gensys";

  public get fileModels(): Map<string, GensysModel> {
    return this.fileDecks;
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    const { addSymbol } = this.createIndexContext(uri);

    const parsedModel = parseGensysDeck(text, uri);
    this.fileDecks.set(uri, parsedModel);

    // Root Vehicle Model Symbol
    const modelName = parsedModel.name || "GensysVehicle";
    const rootId = addSymbol(modelName, "Class", null, 0, text.length, {
      numBodies: parsedModel.bodies.size,
      numWheelsets: parsedModel.wheelsets.size,
      numCouplings: parsedModel.couplings.size,
      subsystems: parsedModel.subsystems,
    });

    for (const [bName, body] of parsedModel.bodies.entries()) {
      addSymbol(bName, "Component", rootId, 0, 0, { type: "body", mass: body.mass, inertia: body.inertia });
    }

    for (const [wName, ws] of parsedModel.wheelsets.entries()) {
      addSymbol(wName, "Component", rootId, 0, 0, { type: "wheelset", gauge: ws.gauge, radius: ws.wheelRadius });
    }

    for (const [sName, s] of parsedModel.couplings.entries()) {
      addSymbol(sName, "Component", rootId, 0, 0, { type: "spring_damper", body1: s.body1, body2: s.body2 });
    }

    return this.getFileIndex(uri)!;
  }

  /**
   * Resolves and deeply merges all referenced child subsystems (sub <name>)
   * into a unified vehicle model assembly across indexed workspace files.
   */
  public resolveSubsystems(mainModel: GensysModel, currentUri?: string): GensysModel {
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

    for (const subName of mainModel.subsystems) {
      // Find matching model across indexed files
      let subModel: GensysModel | undefined;
      for (const [uri, m] of this.fileModels.entries()) {
        if (uri === currentUri) continue;
        const baseName = uri.split("/").pop()?.split(".")[0];
        if (baseName === subName || m.name === subName) {
          subModel = m;
          break;
        }
      }

      if (!subModel) continue;

      // Merge bodies with prefix
      for (const [bName, body] of subModel.bodies.entries()) {
        const prefixedName = `${subName}.${bName}`;
        resolved.bodies.set(prefixedName, {
          ...body,
          name: prefixedName,
        });
      }

      // Merge wheelsets with prefix
      for (const [wName, ws] of subModel.wheelsets.entries()) {
        const prefixedName = `${subName}.${wName}`;
        resolved.wheelsets.set(prefixedName, {
          ...ws,
          name: prefixedName,
        });
      }

      // Merge couplings with prefix, re-binding internal bodies
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
}
