// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for PowerWorld Auxiliary (.aux) Files.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parsePowerWorldAux } from "./parser/powerworld-parser.js";
import type { PowerWorldAuxModel } from "./types.js";

export interface PowerWorldWorkspaceSummary {
  uri: string;
  busCount: number;
  genCount: number;
  loadCount: number;
  branchCount: number;
  contingencyCount: number;
}

export function canIndexPowerWorldAux(uri: string): boolean {
  return uri.toLowerCase().endsWith(".aux");
}

export function buildPowerWorldSummary(uri: string, model: PowerWorldAuxModel): PowerWorldWorkspaceSummary {
  return {
    uri,
    busCount: model.buses.length,
    genCount: model.generators.length,
    loadCount: model.loads.length,
    branchCount: model.branches.length,
    contingencyCount: model.contingencies.length,
  };
}

export function indexPowerWorldAuxDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const model = parsePowerWorldAux(text);
  const summary = buildPowerWorldSummary(uri, model);

  ctx.setParsedModel(summary);
  ctx.setParsedModel(model, "aux");

  const rootName =
    uri
      .split("/")
      .pop()
      ?.replace(/\.aux$/i, "") || "PowerWorldCase";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    summary as unknown as Record<string, unknown>,
    { ruleName: "AuxFile", namePath: rootName },
  );

  for (const bus of model.buses) {
    ctx.addSymbol(
      `Bus_${bus.busNum}`,
      "Component",
      rootId,
      bus.span.startOffset,
      bus.span.endOffset,
      { busNum: bus.busNum, busName: bus.busName, nomVoltKv: bus.nomVoltKv, isSlack: bus.isSlack },
      { ruleName: "DataRow", namePath: `${rootName}.Bus_${bus.busNum}` },
    );
  }
}
