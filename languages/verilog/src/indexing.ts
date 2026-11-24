// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IEEE 1364 Verilog modules, ports, nets, registers, parameters, and instantiations
 * (.v, .vh, .vl) into UnifiedWorkspace.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type LanguageIndexingConfig,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseVerilog } from "./parser/index.js";

const VERILOG_CST_KIND_MAP: Record<string, string> = {
  ModuleDeclaration: "Class",
  PortItem: "Variable",
  NetDeclItem: "Variable",
  ParamAssign: "Constant",
  ParamPortItem: "Constant",
};

function findCstSpan(
  cstByKey: Map<string, WasmCstIndexedSymbol>,
  cstByName: Map<string, WasmCstIndexedSymbol>,
  kind: string,
  name: string,
): WasmCstIndexedSymbol | undefined {
  return cstByKey.get(`${kind}:${name}`) ?? cstByName.get(name);
}

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
    const cstRoot = extractValidWasmCstRoot(ctx.tree);
    const cstSymbols = cstRoot ? indexSymbolsFromWasmCst(cstRoot, ctx.text, { kindMap: VERILOG_CST_KIND_MAP }) : null;
    const cstByKey = new Map<string, WasmCstIndexedSymbol>();
    const cstByName = new Map<string, WasmCstIndexedSymbol>();
    if (cstSymbols) {
      for (const sym of cstSymbols) {
        const key = `${sym.kind}:${sym.name}`;
        if (!cstByKey.has(key)) cstByKey.set(key, sym);
        if (!cstByName.has(sym.name)) cstByName.set(sym.name, sym);
      }
    }

    const design = parseVerilog(ctx.text);
    ctx.setParsedModel(design);

    for (const mod of design.modules) {
      const modCst = findCstSpan(cstByKey, cstByName, "Class", mod.name);
      const modId = ctx.addSymbol(
        mod.name,
        "Class",
        null,
        modCst?.startOffset ?? mod.span.startOffset,
        modCst?.endOffset ?? mod.span.endOffset,
        {
          portCount: mod.ports.size,
          netCount: mod.nets.size,
          paramCount: mod.parameters.size,
        },
        {
          ruleName: "ModuleDeclaration",
          namePath: "name",
          ...(modCst
            ? {
                nameStartOffset: modCst.nameStartOffset,
                nameEndOffset: modCst.nameEndOffset,
                fieldRanges: { name: { startOffset: modCst.nameStartOffset, endOffset: modCst.nameEndOffset } },
              }
            : {}),
        },
      );

      for (const [portName, port] of mod.ports) {
        const portCst = findCstSpan(cstByKey, cstByName, "Variable", portName);
        ctx.addSymbol(
          portName,
          "Variable",
          modId,
          portCst?.startOffset ?? port.span.startOffset,
          portCst?.endOffset ?? port.span.endOffset,
          {
            direction: port.direction,
            netKind: port.netKind ?? "wire",
            range: port.range,
          },
          {
            ruleName: "PortDeclaration",
            namePath: "name",
            ...(portCst
              ? {
                  nameStartOffset: portCst.nameStartOffset,
                  nameEndOffset: portCst.nameEndOffset,
                  fieldRanges: { name: { startOffset: portCst.nameStartOffset, endOffset: portCst.nameEndOffset } },
                }
              : {}),
          },
        );
      }

      for (const [netName, net] of mod.nets) {
        if (mod.ports.has(netName)) continue;
        const netCst = findCstSpan(cstByKey, cstByName, "Variable", netName);
        ctx.addSymbol(
          netName,
          "Variable",
          modId,
          netCst?.startOffset ?? net.span.startOffset,
          netCst?.endOffset ?? net.span.endOffset,
          {
            netKind: net.kind,
            range: net.range,
          },
          {
            ruleName: "NetDeclaration",
            namePath: "name",
            ...(netCst
              ? {
                  nameStartOffset: netCst.nameStartOffset,
                  nameEndOffset: netCst.nameEndOffset,
                  fieldRanges: { name: { startOffset: netCst.nameStartOffset, endOffset: netCst.nameEndOffset } },
                }
              : {}),
          },
        );
      }

      for (const [paramName, param] of mod.parameters) {
        const paramCst = findCstSpan(cstByKey, cstByName, "Constant", paramName);
        ctx.addSymbol(
          paramName,
          "Constant",
          modId,
          paramCst?.startOffset ?? param.span.startOffset,
          paramCst?.endOffset ?? param.span.endOffset,
          {
            isLocal: param.isLocal,
          },
          {
            ruleName: "ParamDeclaration",
            namePath: "name",
            ...(paramCst
              ? {
                  nameStartOffset: paramCst.nameStartOffset,
                  nameEndOffset: paramCst.nameEndOffset,
                  fieldRanges: { name: { startOffset: paramCst.nameStartOffset, endOffset: paramCst.nameEndOffset } },
                }
              : {}),
          },
        );
      }
    }

    if (design.modules.length === 0 && cstSymbols && cstSymbols.length > 0) {
      for (const sym of cstSymbols) {
        ctx.addSymbol(
          sym.name,
          sym.kind,
          null,
          sym.startOffset,
          sym.endOffset,
          {},
          {
            nameStartOffset: sym.nameStartOffset,
            nameEndOffset: sym.nameEndOffset,
            fieldRanges: { name: { startOffset: sym.nameStartOffset, endOffset: sym.nameEndOffset } },
          },
        );
      }
    }
  },
};
