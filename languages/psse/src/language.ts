// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, def, language, repeat, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/dsl";
import { lintPsse } from "./lints/index.js";
import { extractPowerFlowNetlist, serializePowerFlowNetlist } from "./netlist/powerflow-netlist.js";
import { parseRaw } from "./parser/raw-parser.js";
import { psseToModelica } from "./projections/psse-to-modelica.js";
import { psseToEmtNetlist } from "./projections/psse-to-pscad.js";
import {
  analyzeN1Contingencies,
  calculateShortCircuit,
  formatPowerFlowReport,
  simulatePsseTransient,
  solvePowerFlow,
} from "./solver/ac-powerflow.js";

/**
 * ModelScript PSS/E RAW (`.raw`) & DYR (`.dyr`) Language Definition.
 *
 * Provides declarative grammar, linear CST queries, pre-flight grid linter,
 * AC power flow, multi-machine transient stability simulation, and Ybus netlist extraction.
 */
export const psseLanguage = language({
  name: "psse",
  fileExtensions: [".raw", ".dyr"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".raw", ".dyr"],
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
      id: "simulate_psse_transient",
      title: "Simulate Transient Stability (Multi-Machine)",
      description: "Runs multi-machine electro-mechanical transient stability simulation with fault disturbance.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "psse_simulate_transient",
          displayName: "Simulate PSS/E Transient Stability",
          modelDescription:
            "Simulates multi-machine electro-mechanical rotor angle, frequency, and bus voltage transient response.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined; stopTime?: number | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return simulatePsseTransient(parsed, { stopTime: params?.stopTime });
      },
    },
    {
      id: "solve_powerflow",
      title: "Solve AC Power Flow (Newton-Raphson)",
      description: "Solves steady-state AC power flow equations and generates a full bus & branch flow report.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "psse_solve_powerflow",
          displayName: "Solve PSS/E AC Power Flow",
          modelDescription: "Solves AC Newton-Raphson power flow for a PSS/E base case.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        const sol = solvePowerFlow(parsed);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, caseTitle),
        };
      },
    },
    {
      id: "analyze_n1_contingencies",
      title: "Run N-1 Contingency Security Screening",
      description:
        "Screens single-element line, transformer, and generator outages for thermal overloads and voltage violations.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(shield)",
          group: "navigation@2",
        },
        languageModelTool: {
          name: "psse_analyze_n1_contingencies",
          displayName: "Run PSS/E N-1 Contingency Analysis",
          modelDescription: "Screens N-1 transmission and generator contingencies for thermal and voltage violations.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return analyzeN1Contingencies(parsed);
      },
    },
    {
      id: "solve_short_circuit",
      title: "Run Short-Circuit Fault Analysis (IEC 60909 / ANSI C37)",
      description:
        "Computes symmetrical 3-phase, 1LG, 2L, and 2LG fault currents and short-circuit MVA across all buses.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(zap)",
          group: "navigation@2",
        },
        languageModelTool: {
          name: "psse_solve_short_circuit",
          displayName: "Run PSS/E Short-Circuit Fault Analysis",
          modelDescription: "Computes 3-phase, 1LG, 2L, and 2LG short-circuit fault currents and MVA across all buses.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return calculateShortCircuit(parsed);
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
          group: "navigation@3",
        },
        languageModelTool: {
          name: "psse_extract_netlist",
          displayName: "Extract Power Flow Netlist",
          modelDescription: "Computes complex admittance matrix and power injections for PSS/E base case.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        const netlist = extractPowerFlowNetlist(parsed);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return serializePowerFlowNetlist(netlist, caseTitle);
      },
    },
    {
      id: "lint_psse_case",
      title: "Lint PSS/E Base Case",
      description: "Performs pre-flight electrical topology, boundary, and parameter bounds checks.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@3",
        },
        explorerContextMenu: {
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "psse_lint",
          displayName: "Lint PSS/E Case",
          modelDescription: "Lints PSS/E raw file for missing buses, limits, and topology errors.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseRaw(text);
        return lintPsse(parsed);
      },
    },
    {
      id: "export_psse_modelica",
      title: "Project to Modelica Power Grid (.mo)",
      description: "Translates PSS/E transmission network into an executable Modelica model.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseRaw(text);
        return psseToModelica(parsed);
      },
    },
    {
      id: "export_psse_pscad",
      title: "Export PSCAD / EMT Netlist",
      description: "Projects PSS/E base case to a three-phase electromagnetic transient (EMT) netlist.",
      category: "export",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseRaw(text);
        return psseToEmtNetlist(parsed);
      },
    },
  ],

  primitives: {
    lineComment: "/",
  },

  extras: () => [/[ \t\r\n]+/],

  rules: {
    SourceFile: ($) =>
      def({
        syntax: repeat($["DataRecord"]!),
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

    DataRecord: ($) => choice($["Number"]!, $["QuotedString"]!, $["Identifier"]!, ",", $["SymbolPunct"]!),

    Number: () => /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/,
    QuotedString: () => /'[^']*'|"[^"]*"/,
    Identifier: () => /[A-Za-z_@!][A-Za-z0-9_@!.-]*/,
    SymbolPunct: () => /[:;()[\]=+*<>~#%&$^|\\?-]+/,
  },
});

export default psseLanguage;
