// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseUsd } from "./parser/index.js";
import type { UsdPrim, UsdStage } from "./types.js";

export interface UsdIndexedFile {
  filePath: string;
  stage: UsdStage;
  primPaths: Set<string>;
}

function emitUsdPrim(ctx: DslIndexFileContext, prim: UsdPrim, parentSymbolId: number | null): void {
  const symId = ctx.addSymbol(
    prim.name,
    prim.typeName === "Xform" ? "Package" : "Class",
    parentSymbolId,
    prim.range?.startOffset ?? 0,
    prim.range?.endOffset ?? 0,
    {
      specifier: prim.specifier,
      typeName: prim.typeName,
      path: prim.path,
      apiSchemas: prim.apiSchemas,
      kind: prim.kind,
    },
    {
      ruleName: "PrimDef",
      namePath: prim.path,
      aliases: [prim.path, `<${prim.path}>`],
    },
  );

  for (const child of prim.children.values()) {
    emitUsdPrim(ctx, child, symId);
  }
}

/**
 * Declarative `UnifiedWorkspace` file indexer for OpenUSD stages (`.usd`, `.usda`, `.usdc`, `.usdz`).
 */
export function indexUsdFile(ctx: DslIndexFileContext): void {
  try {
    const stage = parseUsd(ctx.text);
    ctx.setParsedModel(stage);

    for (const rootPrim of stage.rootPrims) {
      emitUsdPrim(ctx, rootPrim, null);
    }
  } catch {
    // Preserve empty symbol table on parse failure
  }
}

/**
 * Retrieves the parsed `UsdStage` for `filePath` from `workspace`.
 */
export function getUsdStage(workspace: UnifiedWorkspace, filePath: string): UsdStage | undefined {
  return workspace.getParsedModel<UsdStage>(filePath);
}

/**
 * Finds an OpenUSD prim by SdfPath (e.g. `"/IndustrialArm/j1"`) across all stages indexed in `workspace`.
 */
export function findUsdPrim(workspace: UnifiedWorkspace, primPath: string): { filePath: string; prim: UsdPrim } | null {
  for (const [filePath, stage] of workspace.getAllParsedModels<UsdStage>()) {
    const prim = stage.prims.get(primPath);
    if (prim) return { filePath, prim };
  }
  return null;
}
