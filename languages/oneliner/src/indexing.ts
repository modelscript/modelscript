// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for ASPEN OneLiner / CAPE Short-Circuit Models.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseOneLiner } from "./parser/oneliner-parser.js";
import type { OneLinerCase } from "./types.js";

export interface OneLinerWorkspaceModel {
  uri: string;
  title: string;
  baseMva: number;
  busCount: number;
  branchCount: number;
  generatorCount: number;
  relayCount: number;
  busIds: string[];
}

export function buildOneLinerSummary(uri: string, c: OneLinerCase): OneLinerWorkspaceModel {
  return {
    uri,
    title: c.title,
    baseMva: c.baseMva,
    busCount: c.busses.length,
    branchCount: c.branches.length,
    generatorCount: c.generators.length,
    relayCount: c.overcurrentRelays.length + c.distanceRelays.length,
    busIds: c.busses.map((b) => b.id),
  };
}

export function indexOneLinerFile(ctx: DslIndexFileContext): void {
  try {
    const c = parseOneLiner(ctx.text);
    const summary = buildOneLinerSummary(ctx.uri, c);
    ctx.setParsedModel(summary);
    ctx.setParsedModel(c, "case");

    const caseName = c.title || "OneLinerCase";
    const rootId = ctx.addSymbol(
      caseName,
      "Class",
      null,
      0,
      ctx.text.length,
      {
        baseMva: c.baseMva,
        busCount: summary.busCount,
        branchCount: summary.branchCount,
        generatorCount: summary.generatorCount,
        relayCount: summary.relayCount,
      },
      { ruleName: "oneliner_case", namePath: caseName },
    );

    for (const bus of c.busses) {
      ctx.addSymbol(
        bus.name || `Bus_${bus.id}`,
        "Component",
        rootId,
        0,
        0,
        { id: bus.id, baseKv: bus.baseKv },
        {
          ruleName: "oneliner_bus",
          namePath: `${caseName}.${bus.name || bus.id}`,
          aliases: [bus.id],
        },
      );
    }

    for (const br of c.branches) {
      ctx.addSymbol(
        br.id,
        "Component",
        rootId,
        0,
        0,
        { bus1: br.bus1, bus2: br.bus2 },
        { ruleName: "oneliner_branch", namePath: `${caseName}.${br.id}` },
      );
    }

    for (const gen of c.generators) {
      ctx.addSymbol(
        gen.id,
        "Component",
        rootId,
        0,
        0,
        { busId: gen.busId, mvaRating: gen.mvaRating },
        { ruleName: "oneliner_generator", namePath: `${caseName}.${gen.id}` },
      );
    }

    for (const relay of c.overcurrentRelays) {
      ctx.addSymbol(
        relay.id,
        "Component",
        rootId,
        0,
        0,
        { kind: "overcurrent", pickupA: relay.pickupA },
        { ruleName: "oneliner_relay", namePath: `${caseName}.${relay.id}` },
      );
    }

    for (const relay of c.distanceRelays) {
      ctx.addSymbol(
        relay.id,
        "Component",
        rootId,
        0,
        0,
        { kind: "distance" },
        { ruleName: "oneliner_relay", namePath: `${caseName}.${relay.id}` },
      );
    }
  } catch {
    // Ignore indexing errors for non-OneLiner files
  }
}

export function getOneLinerModel(workspace: UnifiedWorkspace, uri: string): OneLinerWorkspaceModel | undefined {
  return workspace.getParsedModel<OneLinerWorkspaceModel>(uri);
}

export function getAllOneLinerModels(workspace: UnifiedWorkspace): OneLinerWorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<OneLinerWorkspaceModel>().values());
}

export function getOneLinerCase(workspace: UnifiedWorkspace, uri: string): OneLinerCase | undefined {
  return workspace.getParsedModel<OneLinerCase>(uri, "case");
}
