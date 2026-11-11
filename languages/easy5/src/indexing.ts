// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseEasy5 } from "./parser/easy5-parser.js";
import type { Easy5Model } from "./types.js";

/**
 * Declarative workspace symbol indexer for EASY5 models (.ez5, .ezm, .ezd, .eas).
 */
export function indexEasy5Document(ctx: DslIndexFileContext): void {
  const model = parseEasy5(ctx.text);
  ctx.setParsedModel(model);

  const modelRootId = ctx.addSymbol(
    model.name,
    "Package",
    null,
    0,
    ctx.text.length,
    {},
    {
      ruleName: "model",
      namePath: model.name,
    },
  );

  for (const [compId, comp] of model.components) {
    const label = `${compId} [${comp.type}]`;
    ctx.addSymbol(
      label,
      "Class",
      modelRootId,
      comp.startOffset ?? 0,
      comp.endOffset ?? 0,
      { id: compId, type: comp.type },
      {
        ruleName: "component",
        namePath: `${model.name}.${compId}`,
        aliases: [compId],
      },
    );
  }
}

export function getEasy5Model(workspace: UnifiedWorkspace, uri: string): Easy5Model | undefined {
  return workspace.getParsedModel<Easy5Model>(uri);
}
