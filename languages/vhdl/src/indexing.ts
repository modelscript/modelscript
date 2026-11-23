// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/vhdl — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IEEE 1076 VHDL design files (.vhd, .vhdl) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseVhdl } from "./parser/vhdl-parser.js";

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
    const design = parseVhdl(ctx.text);
    ctx.setParsedModel(design);

    for (const pkg of design.packages) {
      ctx.addSymbol(
        pkg.name,
        "Package",
        null,
        pkg.span.startOffset,
        pkg.span.endOffset,
        {
          kind: "package",
          constantCount: pkg.constants.length,
          typeCount: pkg.types.length,
        },
        { ruleName: "PackageDeclaration", namePath: "name" },
      );
    }

    for (const entity of design.entities) {
      const entityId = ctx.addSymbol(
        entity.name,
        "Class",
        null,
        entity.span.startOffset,
        entity.span.endOffset,
        {
          kind: "entity",
          portCount: entity.ports.length,
          genericCount: entity.generics.length,
        },
        { ruleName: "EntityDeclaration", namePath: "name" },
      );

      for (const port of entity.ports) {
        ctx.addSymbol(
          port.name,
          "Variable",
          entityId,
          port.span.startOffset,
          port.span.endOffset,
          {
            kind: "port",
            direction: port.direction,
            type: port.type.name,
            width: port.type.width,
          },
          { ruleName: "PortDeclaration", namePath: "name" },
        );
      }
    }

    for (const arch of design.architectures) {
      const archId = ctx.addSymbol(
        `${arch.entityName}(${arch.name})`,
        "Class",
        null,
        arch.span.startOffset,
        arch.span.endOffset,
        {
          kind: "architecture",
          entityName: arch.entityName,
          archName: arch.name,
          signalCount: arch.signals.length,
          statementCount: arch.statements.length,
        },
        { ruleName: "ArchitectureBody", namePath: "name", aliases: [arch.name] },
      );

      for (const sig of arch.signals) {
        ctx.addSymbol(
          sig.name,
          "Variable",
          archId,
          sig.span.startOffset,
          sig.span.endOffset,
          {
            kind: "signal",
            type: sig.type.name,
            width: sig.type.width,
          },
          { ruleName: "SignalDeclaration", namePath: "name" },
        );
      }
    }
  },
};
