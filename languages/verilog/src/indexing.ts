// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IEEE 1364 Verilog modules, ports, nets, registers, parameters, and instantiations
 * (.v, .vh, .vl) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseVerilog } from "./parser/index.js";

export const verilogIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".v") || lower.endsWith(".vh") || lower.endsWith(".vl")) {
      return true;
    }
    if (!text) return false;
    return /\bmodule\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(text) && /\bendmodule\b/.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const design = parseVerilog(ctx.text);
    ctx.setParsedModel(design);

    for (const mod of design.modules) {
      const modId = ctx.addSymbol(
        mod.name,
        "Class",
        null,
        mod.span.startOffset,
        mod.span.endOffset,
        {
          portCount: mod.ports.size,
          netCount: mod.nets.size,
          paramCount: mod.parameters.size,
        },
        {
          ruleName: "ModuleDeclaration",
          namePath: "name",
        },
      );

      for (const [portName, port] of mod.ports) {
        ctx.addSymbol(
          portName,
          "Variable",
          modId,
          port.span.startOffset,
          port.span.endOffset,
          {
            direction: port.direction,
            netKind: port.netKind ?? "wire",
            range: port.range,
          },
          {
            ruleName: "PortDeclaration",
            namePath: "name",
          },
        );
      }

      for (const [netName, net] of mod.nets) {
        if (mod.ports.has(netName)) continue;
        ctx.addSymbol(
          netName,
          "Variable",
          modId,
          net.span.startOffset,
          net.span.endOffset,
          {
            netKind: net.kind,
            range: net.range,
          },
          {
            ruleName: "NetDeclaration",
            namePath: "name",
          },
        );
      }

      for (const [paramName, param] of mod.parameters) {
        ctx.addSymbol(
          paramName,
          "Constant",
          modId,
          param.span.startOffset,
          param.span.endOffset,
          {
            isLocal: param.isLocal,
          },
          {
            ruleName: "ParamDeclaration",
            namePath: "name",
          },
        );
      }
    }
  },
};
