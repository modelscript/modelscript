// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gcode — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes RS-274 / ISO 6983 CNC G-code programs (.nc, .gcode, .gco, .ngc, .tap, .cnc, .mpf)
 * into UnifiedWorkspace (program root, subprograms Oxxxx, tool changes Txx, labeled blocks Nxxxx).
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseGCode } from "./parser/gcode-parser.js";

const GCODE_EXTENSIONS = [".nc", ".gcode", ".gco", ".ngc", ".tap", ".cnc", ".mpf"];

export const gcodeIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (GCODE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
    if (!text) return false;
    return /^\s*(?:%|O\d{1,5}\b|N\d+\s+G\d{1,2}\b|G0?[0123]\b)/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseGCode(ctx.text);
    ctx.setParsedModel(program);

    const rootId = ctx.addSymbol(
      program.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        programNumber: program.programNumber,
        blockCount: program.blocks.length,
        subprogramCount: program.subprograms.size,
      },
      {
        ruleName: "Program",
        namePath: "name",
      },
    );

    // Index subprograms (Oxxxx)
    for (const sub of program.subprograms.values()) {
      ctx.addSymbol(
        sub.name,
        "Function",
        rootId,
        sub.startOffset,
        sub.endOffset,
        {
          programNumber: sub.programNumber,
          blockCount: sub.blocks.length,
        },
        {
          ruleName: "ProgramNumber",
          namePath: "name",
        },
      );
    }

    // Index tool changes (Txx M06)
    for (const block of program.blocks) {
      const tWord = block.words.find((w) => w.letter === "T");
      if (tWord && Number.isFinite(tWord.value)) {
        const toolLabel = `T${Math.round(tWord.value)}`;
        ctx.addSymbol(
          toolLabel,
          "Variable",
          rootId,
          tWord.startOffset,
          tWord.endOffset,
          { toolNumber: Math.round(tWord.value), line: block.line },
          { ruleName: "Word", namePath: "name" },
        );
      }
    }
  },
};
