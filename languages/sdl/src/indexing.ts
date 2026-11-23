// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sdl — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes ITU-T Z.100 SDL-88 specifications (.sdl, .pr, .sdl88) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSdl } from "./parser/sdl-parser.js";

export const sdlIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sdl") || lower.endsWith(".pr") || lower.endsWith(".sdl88")) {
      return true;
    }
    if (!text) return false;
    return /\bSYSTEM\s+[A-Za-z_][A-Za-z0-9_]*\s*;/i.test(text) && /\bENDSYSTEM\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseSdl(ctx.text);
    ctx.setParsedModel(model);

    const sysRootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      model.span.startOffset,
      model.span.endOffset,
      { kind: "system" },
      { ruleName: "System", namePath: "name" },
    );

    for (const sig of model.signals) {
      ctx.addSymbol(
        sig.name,
        "Event",
        sysRootId,
        sig.startOffset,
        sig.endOffset,
        { kind: "signal", parameterSorts: sig.parameterSorts },
        { ruleName: "SignalDecl", namePath: "name" },
      );
    }

    for (const block of model.blocks) {
      const blockId = ctx.addSymbol(
        block.name,
        "Module",
        sysRootId,
        block.startOffset,
        block.endOffset,
        { kind: "block" },
        { ruleName: "Block", namePath: "name" },
      );

      for (const proc of block.processes) {
        const procId = ctx.addSymbol(
          proc.name,
          "Class",
          blockId,
          proc.startOffset,
          proc.endOffset,
          { kind: "process", initialInstances: proc.initialInstances },
          { ruleName: "Process", namePath: "name" },
        );

        for (const st of proc.states) {
          for (const stName of st.names) {
            if (stName === "*") continue;
            ctx.addSymbol(
              stName,
              "EnumMember",
              procId,
              st.startOffset,
              st.endOffset,
              { kind: "state", process: proc.name },
              { ruleName: "State", namePath: "name" },
            );
          }
        }
      }
    }
  },
};
