// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  repeat,
  seq,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { lintPsse } from "./lints/index.js";
import { extractPowerFlowNetlist } from "./netlist/powerflow-netlist.js";
import { parseRaw } from "./parser/raw-parser.js";

/**
 * ModelScript PSS/E RAW (`.raw`) Language Definition.
 *
 * Provides declarative grammar, linear CST queries, pre-flight grid linter,
 * and power flow admittance matrix extraction for transmission base cases.
 */
export const psseLanguage = language({
  name: "psse",
  fileExtensions: [".raw"],
  lsp: {
    fileExtensions: [".raw"],
    icons: {
      light: "./assets/psse/icon-light.png",
      dark: "./assets/psse/icon-dark.png",
    },
  },

  // Surgical writeback for cell and attribute mutations
  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: newValue.trim() };
    }
    return null;
  },

  actions: [
    {
      id: "lint_psse_case",
      title: "Lint PSS/E Base Case",
      description: "Performs pre-flight electrical topology, boundary, and parameter bounds checks.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "psse_lint",
          displayName: "Lint PSS/E Case",
          modelDescription: "Lints PSS/E raw file for missing buses, limits, and topology errors.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseRaw(text);
        return lintPsse(parsed);
      },
    },
    {
      id: "extract_powerflow_netlist",
      title: "Extract Power Flow Netlist & Ybus",
      description: "Extracts nodal admittance matrix (Ybus), power injections, and voltage bounds.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(circuit-board)",
          group: "navigation@1",
        },
        languageModelTool: {
          name: "psse_extract_netlist",
          displayName: "Extract Power Flow Netlist",
          modelDescription: "Computes complex admittance matrix and power injections for PSS/E base case.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return extractPowerFlowNetlist(parsed);
      },
    },
  ],

  primitives: {
    lineComment: "/",
  },

  extras: () => [/[ \t\r]+/],

  rules: {
    SourceFile: ($) =>
      def({
        syntax: repeat(choice($["DataRecord"]!, $["_newline"]!)),
        symbol: () => ({
          kind: "Class",
          name: "PsseCase",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          lint__psseGridValidity: (db: QueryDB, self: SymbolEntry) => {
            const text = db["cstText"](self.startOffset, self.endOffset, self);
            if (!text) return null;
            const parsed = parseRaw(text);
            const diags = lintPsse(parsed);
            if (diags.length === 0) return null;
            return diags.map((d) => ({
              severity: d.severity,
              code: d.code,
              message: d.message,
              startOffset: d.startOffset,
              endOffset: d.endOffset,
            }));
          },
        },
      }),

    DataRecord: ($) =>
      seq(
        field("firstVal", choice($["Number"]!, $["QuotedString"]!, $["Identifier"]!)),
        repeat(seq(",", field("values", choice($["Number"]!, $["QuotedString"]!, $["Identifier"]!)))),
        $["_newline"]!,
      ),

    Number: () => /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/,
    QuotedString: () => /'[^']*'|"[^"]*"/,
    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    _newline: () => /\n/,
  },
});

export default psseLanguage;
