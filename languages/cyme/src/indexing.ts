// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseCyme } from "./parser/cyme-parser.js";

export function canIndexCyme(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".sxst") || lower.endsWith(".cyme");
}

export function indexCymeDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const net = parseCyme(text);
  ctx.setParsedModel(net);

  const rootName = net.networkId || uri.split("/").pop() || "CYME_Feeder";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    { nodeCount: net.nodes.length, sectionCount: net.sections.length, loadCount: net.loads.length },
    { ruleName: "cyme_network", namePath: rootName },
  );

  for (const node of net.nodes) {
    ctx.addSymbol(
      node.nodeId,
      "Component",
      rootId,
      0,
      0,
      { nominalKv: node.nominalKv },
      { ruleName: "cyme_node", namePath: `${rootName}.${node.nodeId}` },
    );
  }
}
