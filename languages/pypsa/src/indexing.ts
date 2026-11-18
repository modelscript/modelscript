// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parsePypsa } from "./parser/pypsa-parser.js";

export function canIndexPypsa(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".pypsa") || lower.endsWith(".pypsa.json");
}

export function indexPypsaDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const net = parsePypsa(text);
  ctx.setParsedModel(net);

  const rootName = net.name || uri.split("/").pop() || "PyPSA_Network";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    { busCount: net.buses.length, generatorCount: net.generators.length, lineCount: net.lines.length },
    { ruleName: "pypsa_network", namePath: rootName },
  );

  for (const b of net.buses) {
    ctx.addSymbol(
      b.name,
      "Component",
      rootId,
      0,
      0,
      { v_nom: b.v_nom, carrier: b.carrier },
      { ruleName: "pypsa_bus", namePath: `${rootName}.${b.name}` },
    );
  }
}
