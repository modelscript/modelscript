// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/vhdl — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IEEE 1076 VHDL design files (.vhd, .vhdl) into UnifiedWorkspace.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type LanguageIndexingConfig,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseVhdl } from "./parser/vhdl-parser.js";

const VHDL_CST_KIND_MAP: Record<string, string> = {
  PackageDeclaration: "Package",
  EntityDeclaration: "Class",
  ArchitectureBody: "Class",
  PortDecl: "Variable",
  SignalDecl: "Variable",
  GenericDecl: "Parameter",
  ConstantDecl: "Constant",
  TypeDecl: "Type",
};

function findCstSpan(
  cstByKey: Map<string, WasmCstIndexedSymbol>,
  cstByName: Map<string, WasmCstIndexedSymbol>,
  kind: string,
  name: string,
): WasmCstIndexedSymbol | undefined {
  const lower = name.toLowerCase();
  return cstByKey.get(`${kind}:${lower}`) ?? cstByName.get(lower);
}

export const vhdlIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".vhd") || lower.endsWith(".vhdl")) {
      return true;
    }
    if (!text) return false;
    return (
      /\bentity\s+[A-Za-z_][A-Za-z0-9_]*\s+is\b/i.test(text) ||
      /\barchitecture\s+[A-Za-z_][A-Za-z0-9_]*\s+of\b/i.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const cstRoot = extractValidWasmCstRoot(ctx.tree);
    const cstSymbols = cstRoot ? indexSymbolsFromWasmCst(cstRoot, ctx.text, { kindMap: VHDL_CST_KIND_MAP }) : null;
    const cstByKey = new Map<string, WasmCstIndexedSymbol>();
    const cstByName = new Map<string, WasmCstIndexedSymbol>();
    if (cstSymbols) {
      for (const sym of cstSymbols) {
        const lower = sym.name.toLowerCase();
        const key = `${sym.kind}:${lower}`;
        if (!cstByKey.has(key)) cstByKey.set(key, sym);
        if (!cstByName.has(lower)) cstByName.set(lower, sym);
      }
    }

    const design = parseVhdl(ctx.text);
    ctx.setParsedModel(design);

    let emittedCount = 0;

    for (const pkg of design.packages) {
      const cst = findCstSpan(cstByKey, cstByName, "Package", pkg.name);
      emittedCount++;
      ctx.addSymbol(
        pkg.name,
        "Package",
        null,
        cst?.startOffset ?? pkg.span.startOffset,
        cst?.endOffset ?? pkg.span.endOffset,
        {
          kind: "package",
          constantCount: pkg.constants.length,
          typeCount: pkg.types.length,
        },
        {
          ruleName: "PackageDeclaration",
          namePath: "name",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );
    }

    for (const entity of design.entities) {
      const cst = findCstSpan(cstByKey, cstByName, "Class", entity.name);
      emittedCount++;
      const entityId = ctx.addSymbol(
        entity.name,
        "Class",
        null,
        cst?.startOffset ?? entity.span.startOffset,
        cst?.endOffset ?? entity.span.endOffset,
        {
          kind: "entity",
          portCount: entity.ports.length,
          genericCount: entity.generics.length,
        },
        {
          ruleName: "EntityDeclaration",
          namePath: "name",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );

      for (const port of entity.ports) {
        const portCst = findCstSpan(cstByKey, cstByName, "Variable", port.name);
        ctx.addSymbol(
          port.name,
          "Variable",
          entityId,
          portCst?.startOffset ?? port.span.startOffset,
          portCst?.endOffset ?? port.span.endOffset,
          {
            kind: "port",
            direction: port.direction,
            type: port.type.name,
            width: port.type.width,
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
    }

    for (const arch of design.architectures) {
      const archCst = findCstSpan(cstByKey, cstByName, "Class", arch.name);
      emittedCount++;
      const archId = ctx.addSymbol(
        `${arch.entityName}(${arch.name})`,
        "Class",
        null,
        archCst?.startOffset ?? arch.span.startOffset,
        archCst?.endOffset ?? arch.span.endOffset,
        {
          kind: "architecture",
          entityName: arch.entityName,
          archName: arch.name,
          signalCount: arch.signals.length,
          statementCount: arch.statements.length,
        },
        {
          ruleName: "ArchitectureBody",
          namePath: "name",
          aliases: [arch.name],
          ...(archCst
            ? {
                nameStartOffset: archCst.nameStartOffset,
                nameEndOffset: archCst.nameEndOffset,
                fieldRanges: { name: { startOffset: archCst.nameStartOffset, endOffset: archCst.nameEndOffset } },
              }
            : {}),
        },
      );

      for (const sig of arch.signals) {
        const sigCst = findCstSpan(cstByKey, cstByName, "Variable", sig.name);
        ctx.addSymbol(
          sig.name,
          "Variable",
          archId,
          sigCst?.startOffset ?? sig.span.startOffset,
          sigCst?.endOffset ?? sig.span.endOffset,
          {
            kind: "signal",
            type: sig.type.name,
            width: sig.type.width,
          },
          {
            ruleName: "SignalDeclaration",
            namePath: "name",
            ...(sigCst
              ? {
                  nameStartOffset: sigCst.nameStartOffset,
                  nameEndOffset: sigCst.nameEndOffset,
                  fieldRanges: { name: { startOffset: sigCst.nameStartOffset, endOffset: sigCst.nameEndOffset } },
                }
              : {}),
          },
        );
      }
    }

    if (emittedCount === 0 && cstSymbols && cstSymbols.length > 0) {
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
