// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseSimulink } from "./parser/index.js";
import type { SimulinkBlock, SimulinkModel, SimulinkSystem } from "./types.js";

function indexSimulinkSystem(ctx: DslIndexFileContext, system: SimulinkSystem, parentSymbolId: number): void {
  for (const block of system.blocks.values()) {
    const blockId = ctx.addSymbol(
      block.name,
      "Component",
      parentSymbolId,
      0,
      0,
      {},
      {
        ruleName: "simulink_block",
      },
    );

    if (block.type === "SubSystem" && block.subsystem) {
      indexSimulinkSystem(ctx, block.subsystem, blockId);
    }
  }
}

/**
 * Declarative `UnifiedWorkspace` file indexer for MATLAB Simulink models (`.slx`, `.mdl`).
 */
export function indexSimulinkFile(ctx: DslIndexFileContext): void {
  try {
    const model = parseSimulink(ctx.text, ctx.uri);
    ctx.setParsedModel(model);

    const modelSymbolId = ctx.addSymbol(
      model.name,
      "Class",
      null,
      0,
      0,
      {},
      {
        ruleName: "simulink_model",
      },
    );

    indexSimulinkSystem(ctx, model.rootSystem, modelSymbolId);
  } catch {
    // Return empty index on parse failure
  }
}

/**
 * Finds top-level Simulink blocks matching `blockName` across all models indexed in `workspace`.
 */
export function getSimulinkBlocksByName(workspace: UnifiedWorkspace, blockName: string): SimulinkBlock[] {
  const list: SimulinkBlock[] = [];
  for (const model of workspace.getAllParsedModels<SimulinkModel>().values()) {
    const found = model.rootSystem.blocks.get(blockName);
    if (found) list.push(found);
  }
  return list;
}
