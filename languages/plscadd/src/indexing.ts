// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parsePlsCadd } from "./parser/plscadd-parser.js";

export function canIndexPlsCadd(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".pol") || lower.endsWith(".loa") || lower.endsWith(".plscadd");
}

export function indexPlsCaddDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const model = parsePlsCadd(text);
  ctx.setParsedModel(model);

  const rootName = model.lineName || uri.split("/").pop() || "PlsCaddLine";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    { voltageKv: model.voltageKv, structureCount: model.structures.length, spanCount: model.spans.length },
    { ruleName: "plscadd_line", namePath: rootName },
  );

  for (const s of model.structures) {
    ctx.addSymbol(
      s.id,
      "Component",
      rootId,
      0,
      0,
      { heightM: s.heightM },
      { ruleName: "plscadd_structure", namePath: `${rootName}.${s.id}` },
    );
  }
}
