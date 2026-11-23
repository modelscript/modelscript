// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simscript — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes SIMSCRIPT II.5 discrete-event simulation models (.sim, .simscript, .s25)
 * into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSimscript } from "./parser/simscript-parser.js";

export const simscriptIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sim") || lower.endsWith(".simscript") || lower.endsWith(".s25")) {
      return true;
    }
    if (!text) return false;
    return (
      /\bPREAMBLE\b/i.test(text) && /\b(?:START\s+SIMULATION|RESOURCES|PROCESSES|TEMPORARY\s+ENTITIES)\b/i.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseSimscript(ctx.text);
    ctx.setParsedModel(model);

    const modelRootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {},
      {
        ruleName: "program",
        namePath: "name",
      },
    );

    // Preamble entities, processes, resources, event notices
    for (const ent of model.preamble.entities) {
      ctx.addSymbol(
        ent.name,
        "Class",
        modelRootId,
        ent.span.startOffset,
        ent.span.endOffset,
        {
          kind: ent.kind,
          capacity: ent.capacity,
          attributes: ent.attributes,
          ownedSets: ent.ownedSets,
        },
        {
          ruleName: "entity",
          namePath: "name",
        },
      );
    }

    // MAIN block
    if (model.main) {
      ctx.addSymbol(
        "MAIN",
        "Function",
        modelRootId,
        model.main.span.startOffset,
        model.main.span.endOffset,
        { kind: "MAIN" },
        { ruleName: "routine", namePath: "name" },
      );
    }

    // PROCESS / EVENT / ROUTINE blocks
    for (const proc of model.processes.values()) {
      ctx.addSymbol(
        proc.name,
        "Function",
        modelRootId,
        proc.span.startOffset,
        proc.span.endOffset,
        { kind: "PROCESS" },
        { ruleName: "process", namePath: "name" },
      );
    }
    for (const ev of model.events.values()) {
      ctx.addSymbol(
        ev.name,
        "Function",
        modelRootId,
        ev.span.startOffset,
        ev.span.endOffset,
        { kind: "EVENT" },
        { ruleName: "event", namePath: "name" },
      );
    }
    for (const rt of model.routines.values()) {
      ctx.addSymbol(
        rt.name,
        "Function",
        modelRootId,
        rt.span.startOffset,
        rt.span.endOffset,
        { kind: "ROUTINE" },
        { ruleName: "routine", namePath: "name" },
      );
    }
  },
};
