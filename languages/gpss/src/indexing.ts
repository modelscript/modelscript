// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `@modelscript/gpss` — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes GPSS discrete-event simulation models (`.gps`, `.gpss`, `.sim`) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseGpss } from "./parser/gpss-parser.js";

export const gpssIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".gps") || lower.endsWith(".gpss")) {
      return true;
    }
    if (!text) return false;
    return /\bGENERATE\b/i.test(text) && /\b(?:TERMINATE|SEIZE|ENTER|START)\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseGpss(ctx.text);
    ctx.setParsedModel(model);

    // Model root symbol
    const modelRootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        blockCount: model.blocks.length,
        facilityCount: model.facilities.size,
        storageCount: model.storages.size,
        queueCount: model.queues.size,
      },
      {
        ruleName: "Program",
        namePath: "name",
      },
    );

    // Facilities
    for (const fac of model.facilities) {
      const stmt = model.blocks.find(
        (b) => (b.opcode === "SEIZE" || b.opcode === "RELEASE") && (b.operands[0] ?? "").toUpperCase() === fac,
      );
      ctx.addSymbol(
        `${fac} [FACILITY]`,
        "Class",
        modelRootId,
        stmt?.startOffset ?? 0,
        stmt?.endOffset ?? 0,
        { entityKind: "facility", name: fac },
        { ruleName: "Statement", namePath: "name", aliases: [fac, `F$${fac}`, `FR$${fac}`] },
      );
    }

    // Storages
    for (const [name, def] of model.storages) {
      ctx.addSymbol(
        `${name} [STORAGE:${def.capacity}]`,
        "Class",
        modelRootId,
        def.startOffset,
        def.endOffset,
        { entityKind: "storage", name, capacity: def.capacity },
        { ruleName: "Statement", namePath: "name", aliases: [name, `S$${name}`, `R$${name}`, `SR$${name}`] },
      );
    }

    // Queues
    for (const q of model.queues) {
      const stmt = model.blocks.find(
        (b) => (b.opcode === "QUEUE" || b.opcode === "DEPART") && (b.operands[0] ?? "").toUpperCase() === q,
      );
      ctx.addSymbol(
        `${q} [QUEUE]`,
        "Component",
        modelRootId,
        stmt?.startOffset ?? 0,
        stmt?.endOffset ?? 0,
        { entityKind: "queue", name: q },
        { ruleName: "Statement", namePath: "name", aliases: [q, `Q$${q}`] },
      );
    }

    // Functions
    for (const [name, fn] of model.functions) {
      ctx.addSymbol(
        `${name} [FUNCTION]`,
        "Function",
        modelRootId,
        fn.startOffset,
        fn.endOffset,
        { entityKind: "function", name, mode: fn.mode, points: fn.points.length },
        { ruleName: "Statement", namePath: "name", aliases: [name, `FN$${name}`] },
      );
    }

    // Labeled blocks
    for (const [label, blockIdx] of model.labels) {
      const blk = model.blocks[blockIdx];
      ctx.addSymbol(
        label,
        "Component",
        modelRootId,
        blk?.startOffset ?? 0,
        blk?.endOffset ?? 0,
        { entityKind: "label", opcode: blk?.opcode },
        { ruleName: "Statement", namePath: "label", aliases: [label] },
      );
    }
  },
};
