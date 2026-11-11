// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { parseVerilogA } from "./parser/verilog-a-parser.js";

/**
 * Declarative `UnifiedWorkspace` file indexer for Verilog-A / Verilog-AMS models (`.va`, `.vams`).
 */
export function indexVerilogAFile(ctx: DslIndexFileContext): void {
  const doc = parseVerilogA(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  for (const mod of doc.modules) {
    const modId = ctx.addSymbol(
      mod.name,
      "Class",
      null,
      mod.sourceRange.startOffset,
      mod.sourceRange.endOffset,
      {
        portsCount: mod.ports.length,
        parametersCount: mod.parameters.length,
      },
      {
        ruleName: "verilog_a_module",
        namePath: mod.name,
      },
    );

    for (const port of mod.ports) {
      ctx.addSymbol(
        port.name,
        "Component",
        modId,
        port.sourceRange.startOffset,
        port.sourceRange.endOffset,
        {
          direction: port.direction,
          discipline: port.discipline ?? "electrical",
        },
        {
          ruleName: "verilog_a_port",
          namePath: `${mod.name}.${port.name}`,
        },
      );
    }

    for (const param of mod.parameters) {
      ctx.addSymbol(
        param.name,
        "Constant",
        modId,
        param.sourceRange.startOffset,
        param.sourceRange.endOffset,
        {
          type: param.type,
          defaultValue: param.defaultValue,
        },
        {
          ruleName: "verilog_a_parameter",
          namePath: `${mod.name}.${param.name}`,
        },
      );
    }

    for (const v of mod.variables) {
      ctx.addSymbol(
        v.name,
        "Variable",
        modId,
        v.sourceRange.startOffset,
        v.sourceRange.endOffset,
        {
          type: v.type,
        },
        {
          ruleName: "verilog_a_variable",
          namePath: `${mod.name}.${v.name}`,
        },
      );
    }
  }
}

/**
 * Finds all Verilog-A symbol occurrences matching `name` across documents indexed in `workspace`.
 */
export function findVerilogAReferences(
  workspace: UnifiedWorkspace,
  name: string,
): { uri: string; symbol: SymbolEntry }[] {
  const results: { uri: string; symbol: SymbolEntry }[] = [];
  for (const symbol of workspace.findSymbolsByName(name)) {
    if (symbol.resourceId) {
      results.push({ uri: symbol.resourceId, symbol });
    }
  }
  return results;
}
