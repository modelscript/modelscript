// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseRtdsDraft } from "./parser/rtds-parser.js";

export function canIndexRtds(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".dft") || lower.endsWith(".rtds");
}

export function indexRtdsDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const draft = parseRtdsDraft(text);
  ctx.setParsedModel(draft);

  const rootName = draft.name || uri.split("/").pop() || "RTDS_Case";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    { timeStepSec: draft.timeStepSec, subsystems: draft.subsystems, componentCount: draft.components.length },
    { ruleName: "rtds_draft", namePath: rootName },
  );

  for (const comp of draft.components) {
    ctx.addSymbol(
      comp.name,
      "Component",
      rootId,
      0,
      0,
      { type: comp.type, subsystem: comp.subsystem },
      { ruleName: "rtds_component", namePath: `${rootName}.${comp.name}` },
    );
  }
}
