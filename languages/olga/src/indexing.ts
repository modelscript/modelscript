// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Declarative Multi-File Indexing.
 *
 * Indexes OLGA multiphase models (.opi, .olga, .key, .genkey, .inp), resolving
 * flowpaths, pipeline segments, boundary nodes, and external fluid tables (.tab)
 * into UnifiedWorkspace.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseOlga } from "./parser/index.js";
import type { OlgaModel } from "./types.js";

export function indexOlgaFile(ctx: DslIndexFileContext): void {
  const parsedModel = parseOlga(ctx.text);
  ctx.setParsedModel(parsedModel);

  const caseName = parsedModel.title || "OlgaCase";
  const rootId = ctx.addSymbol(
    caseName,
    "Class",
    null,
    0,
    ctx.text.length,
    {
      tableFile: parsedModel.tableFile,
      nFlowpaths: parsedModel.flowpaths.length,
      nNodes: parsedModel.nodes.length,
    },
    {
      ruleName: "olga_case",
      namePath: caseName,
    },
  );

  const addChild = (name: string, kind: string, meta?: Record<string, unknown>) => {
    ctx.addSymbol(name, kind, rootId, 0, 0, meta ?? {}, {
      ruleName: "olga_component",
      namePath: `${caseName}.${name}`,
    });
  };

  for (const fp of parsedModel.flowpaths) {
    addChild(fp.name, "Component", { kind: "flowpath", pipeCount: fp.pipes.length });
    for (const p of fp.pipes) {
      addChild(`${fp.name}.${p.label}`, "Property", {
        kind: "pipe",
        length: p.length,
        diameter: p.diameter,
        elevation: p.elevation,
      });
    }
    for (const v of fp.valves) {
      addChild(`${fp.name}.${v.name}`, "Property", {
        kind: "valve",
        opening: v.opening,
        diameter: v.diameter,
      });
    }
  }

  for (const node of parsedModel.nodes) {
    addChild(node.name, "Port", {
      kind: "node",
      type: node.type,
      flowpath: node.flowpath,
      boundaryPosition: node.boundaryPosition,
    });
  }

  if (parsedModel.tableFile) {
    addChild(parsedModel.tableFile, "Import", {
      kind: "table_file",
      path: parsedModel.tableFile,
    });
  }
}

export function getOlgaModel(workspace: UnifiedWorkspace, uri: string): OlgaModel | undefined {
  return workspace.getParsedModel<OlgaModel>(uri);
}
