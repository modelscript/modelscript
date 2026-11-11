// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for Wastewater Treatment Plant Models (`.asm`, `.bsm`, `.wrrf`).
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseAsmPlant } from "./parser/asm-parser.js";
import type { AsmPlantModel } from "./types.js";

export interface AsmWorkspaceModel {
  uri: string;
  plantName: string;
  modelType: string;
  reactorCount: number;
  clarifierCount: number;
  plant: AsmPlantModel;
}

/**
 * Declarative per-file indexer for IWA ASM plant definitions.
 */
export function indexAsmDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  if (text.includes("plant ") || text.includes("bioreactor ") || text.includes("clarifier ")) {
    try {
      const plant = parseAsmPlant(text);
      const model: AsmWorkspaceModel = {
        uri,
        plantName: plant.name,
        modelType: plant.modelType,
        reactorCount: plant.reactors.length,
        clarifierCount: plant.clarifiers.length,
        plant,
      };
      ctx.setParsedModel<AsmWorkspaceModel>(model);

      const rootId = ctx.addSymbol(
        plant.name || "AsmPlant",
        "Class",
        null,
        0,
        text.length,
        {
          modelType: plant.modelType,
          reactorCount: plant.reactors.length,
          clarifierCount: plant.clarifiers.length,
        },
        { ruleName: "asm_plant" },
      );

      for (const reactor of plant.reactors) {
        ctx.addSymbol(
          reactor.name,
          "Component",
          rootId,
          0,
          text.length,
          {
            type: reactor.type,
            volumeM3: reactor.volumeM3,
          },
          { ruleName: "asm_bioreactor" },
        );
      }

      for (const clarifier of plant.clarifiers) {
        ctx.addSymbol(
          clarifier.name,
          "Component",
          rootId,
          0,
          text.length,
          {
            surfaceAreaM2: clarifier.surfaceAreaM2,
            heightM: clarifier.heightM,
          },
          { ruleName: "asm_clarifier" },
        );
      }
    } catch {
      // Ignore parsing errors during indexing
    }
  }
}

/**
 * Retrieves an indexed `AsmWorkspaceModel` from `UnifiedWorkspace` for `uri`.
 */
export function getAsmModel(workspace: UnifiedWorkspace, uri: string): AsmWorkspaceModel | undefined {
  return workspace.getParsedModel<AsmWorkspaceModel>(uri);
}

/**
 * Returns all indexed `AsmWorkspaceModel` entries in `UnifiedWorkspace`.
 */
export function getAllAsmModels(workspace: UnifiedWorkspace): AsmWorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<AsmWorkspaceModel>().values());
}
