// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `@modelscript/apt` — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes APT (Automatically Programmed Tools, ISO 4342) CNC part programs
 * (`.apt`, `.aptsource`, `.cls`) into `UnifiedWorkspace` (part program root,
 * canonical geometry definitions `POINT`/`LINE`/`CIRCLE`/`PLANE`/`PATERN`,
 * and cutter/spindle setup declarations).
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseAptProgram } from "./parser/apt-parser.js";

const APT_EXTENSIONS = [".apt", ".aptsource", ".cls"];

export const aptIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (APT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
    if (!text) return false;
    return /^\s*(?:PARTNO\b|CUTTER\s*\/|FROM\s*\/|[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:POINT|LINE|CIRCLE|PLANE|PATERN)\s*\/|FINI\s*$)/im.test(
      text,
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseAptProgram(ctx.text);
    ctx.setParsedModel(program);

    const rootId = ctx.addSymbol(
      program.partno,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        units: program.units,
        machin: program.machin,
        geometryCount: program.geometryList.length,
        statementCount: program.statements.length,
        hasFini: program.hasFini,
      },
      {
        ruleName: "Program",
        namePath: "name",
      },
    );

    // Index all canonical geometry definitions (POINT, LINE, CIRCLE, PLANE, PATERN)
    for (const geom of program.geometryList) {
      ctx.addSymbol(
        geom.label,
        "Variable",
        rootId,
        geom.startOffset,
        geom.endOffset,
        {
          geometryKind: geom.geometryKind,
          args: geom.args,
          line: geom.line,
        },
        {
          ruleName: "GeometryDef",
          namePath: "label",
        },
      );
    }

    // Index CUTTER setup declarations
    let cutterIdx = 0;
    for (const stmt of program.statements) {
      if (stmt.stmtKind === "postprocessor" && stmt.keyword === "CUTTER") {
        cutterIdx++;
        ctx.addSymbol(
          `CUTTER_${cutterIdx}`,
          "Constant",
          rootId,
          stmt.startOffset,
          stmt.endOffset,
          {
            diameter: Number(stmt.args[0]),
            line: stmt.line,
          },
          {
            ruleName: "CommandStmt",
            namePath: "keyword",
          },
        );
      }
    }
  },
};
