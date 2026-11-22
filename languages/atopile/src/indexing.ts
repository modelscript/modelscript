// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — UnifiedWorkspace File Indexer.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseAtopile } from "./parser/atopile-parser.js";

function deriveName(uri: string): string {
  const filename = uri.split("/").pop() ?? "design.ato";
  return filename.replace(/\.ato$/i, "");
}

export function canIndexAtopileFile(uri: string, text = ""): boolean {
  if (/\.ato$/i.test(uri)) return true;
  return /^\s*(?:module|component|interface)\s+[A-Za-z_]\w*(?:\s+from\s+[A-Za-z_]\w*)?\s*:/m.test(text);
}

export function indexAtopileFile(ctx: DslIndexFileContext): void {
  const file = parseAtopile(ctx.text);
  ctx.setParsedModel(file);
  const title = deriveName(ctx.uri);

  const rootId = ctx.addSymbol(
    title,
    "Package",
    null,
    0,
    ctx.text.length,
    { language: "atopile", blockCount: file.blocks.length },
    { ruleName: "atopile_file", namePath: title },
  );

  for (const block of file.blocks) {
    const blockId = ctx.addSymbol(
      block.name,
      "Class",
      rootId,
      block.span.startOffset,
      block.span.endOffset,
      { language: "atopile", kind: block.kind, instanceCount: block.instances.length },
      { ruleName: `atopile_${block.kind}`, namePath: `${title}.${block.name}` },
    );

    for (const inst of block.instances) {
      ctx.addSymbol(
        inst.name,
        "Component",
        blockId,
        inst.span.startOffset,
        inst.span.endOffset,
        { language: "atopile", typeName: inst.typeName },
        { ruleName: "atopile_instance", namePath: `${title}.${block.name}.${inst.name}` },
      );
    }
  }
}
