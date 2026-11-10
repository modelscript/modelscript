// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript DIgSILENT PowerFactory Language Definition.
 *
 * Provides declarative grammar, actions, and MCP tools for PowerFactory .dz archives,
 * .pfd project databases, and .dsl simulation models.
 */

import { choice, def, language, repeat, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/dsl";
import { formatPowerFlowReport, formatShortCircuitReport, solvePowerFlow } from "@modelscript/psse";
import { parseDsl } from "./dsl/dsl-parser.js";
import { transpileDslToModelica } from "./dsl/dsl-transpiler.js";
import { lintPowerFactoryModel } from "./lints/index.js";
import { parsePowerFactoryText } from "./parser/powerfactory-parser.js";
import { powerFactoryToModelica } from "./projections/powerfactory-to-modelica.js";
import { powerFactoryToPsse } from "./projections/powerfactory-to-psse.js";
import { executePythonPowerFactoryScript } from "./powerfactory-shim.js";

export const powerFactoryLanguage = language({
  name: "powerfactory",
  fileExtensions: [".dz", ".pfd", ".dsl"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".dz", ".pfd", ".dsl"],
  },

  actions: [
    {
      id: "solve_powerfactory_powerflow",
      title: "Solve AC Power Flow (PowerFactory)",
      description: "Solves steady-state AC Newton-Raphson power flow for a PowerFactory network model.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "powerfactory_solve_powerflow",
          displayName: "Solve PowerFactory AC Power Flow",
          modelDescription: "Solves AC Newton-Raphson power flow for a PowerFactory (.dz/.pfd/XML) grid model.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parsePowerFactoryText(text);
        const { psseCase } = powerFactoryToPsse(model);
        const sol = solvePowerFlow(psseCase);
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, `PowerFactory: ${model.name}`),
        };
      },
    },
    {
      id: "solve_powerfactory_short_circuit",
      title: "Run Short-Circuit Fault Analysis (IEC 60909)",
      description: "Computes symmetrical and asymmetrical short-circuit fault currents across all buses.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(zap)",
          group: "navigation@1",
        },
        languageModelTool: {
          name: "powerfactory_solve_short_circuit",
          displayName: "Solve PowerFactory Short Circuit",
          modelDescription: "Computes IEC 60909 short-circuit fault currents for a PowerFactory grid model.",
        },
      },
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parsePowerFactoryText(text);
        const { psseCase } = powerFactoryToPsse(model);
        const { calculateShortCircuit } = await import("@modelscript/psse");
        const sc = calculateShortCircuit(psseCase);
        return {
          ...sc,
          reportText: formatShortCircuitReport(sc, `PowerFactory: ${model.name}`),
        };
      },
    },
    {
      id: "project_to_modelica",
      title: "Project to OpenIPSL Modelica (.mo)",
      description: "Translates PowerFactory grid model into executable OpenIPSL Modelica code.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parsePowerFactoryText(text);
        return powerFactoryToModelica(model);
      },
    },
    {
      id: "transpile_dsl_modelica",
      title: "Transpile DSL to Modelica",
      description: "Transpiles DIgSILENT Simulation Language (.dsl) model block into Modelica.",
      category: "transform",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const block = parseDsl(text);
        return transpileDslToModelica(block);
      },
    },
    {
      id: "run_powerfactory_script",
      title: "Execute Python powerfactory Script",
      description: "Executes a DIgSILENT Python automation script against an in-memory session.",
      category: "simulate",
      execute: async (
        ctx,
        params: {
          script?: string | undefined;
          documentText?: string | undefined;
          files?: Record<string, string | Uint8Array> | undefined;
        },
      ) => {
        const script = params?.script ?? params?.documentText ?? ctx?.documentText ?? "";
        const session = executePythonPowerFactoryScript(script, params?.files ?? {});
        return {
          messages: session.messages,
          lastPowerFlow: session.lastPowerFlow,
          lastShortCircuit: session.lastShortCircuit,
        };
      },
    },
    {
      id: "lint_powerfactory_case",
      title: "Lint PowerFactory Grid Model",
      description: "Performs pre-flight electrical topology and parameter validation checks.",
      category: "query",
      execute: async (ctx, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const model = parsePowerFactoryText(text);
        return lintPowerFactoryModel(model);
      },
    },
  ],

  primitives: {
    lineComment: "!",
  },

  extras: () => [/[ \t\r\n]+/],

  rules: {
    SourceFile: ($) =>
      def({
        syntax: repeat($["Statement"]!),
        symbol: () => ({
          kind: "Class",
          name: "PowerFactoryDocument",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
        },
      }),

    Statement: ($) => choice($["Identifier"]!, $["Number"]!, $["QuotedString"]!, $["Punct"]!),
    Identifier: () => /[A-Za-z_][A-Za-z0-9_.]*/,
    Number: () => /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/,
    QuotedString: () => /'[^']*'|"[^"]*"/,
    Punct: () => /[:;()[\]=+*<>~#%&$^|\\?-]+/,
  },
});

export default powerFactoryLanguage;
