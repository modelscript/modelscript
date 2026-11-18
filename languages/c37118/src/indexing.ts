// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseC37118 } from "./parser/c37118-parser.js";

export function canIndexC37118(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".c37118") || lower.endsWith(".pmu");
}

export function indexC37118Document(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const config = parseC37118(text);
  ctx.setParsedModel(config);

  const rootName = config.stn || uri.split("/").pop() || "PMU";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    { idcode: config.idcode, fnom: config.fnom, dataRate: config.dataRate },
    { ruleName: "c37118_pmu", namePath: rootName },
  );

  for (const ph of config.phasors) {
    ctx.addSymbol(
      ph.name,
      "Variable",
      rootId,
      0,
      0,
      { type: ph.type, format: ph.format, scaleFactor: ph.scaleFactor },
      { ruleName: "c37118_phasor", namePath: `${rootName}.${ph.name}` },
    );
  }
}
