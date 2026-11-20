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
import { executePythonPowerFactoryScript } from "./powerfactory-shim.js";
import { powerFactoryToModelica } from "./projections/powerfactory-to-modelica.js";
import { powerFactoryToPsse } from "./projections/powerfactory-to-psse.js";
import { powerfactoryPolyglotConfig } from "./tgg/index.js";

export const powerFactoryLanguage = language({
  polyglot: powerfactoryPolyglotConfig,
  name: "powerfactory",
  fileExtensions: [".dz", ".pfd", ".dsl"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".dz", ".pfd", ".dsl"],
  },
  ui: {
    panels: [
      {
        id: "powerfactoryEditor",
        viewType: "modelscript.powerfactoryEditor",
        title: "DIgSILENT PowerFactory Grid Studio",
        shortTitle: "PowerFactory",
        selector: ["*.dz", "*.pfd", "*.dsl"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/PowerFactoryPanel.tsx",
        artifactViewTypes: ["powerfactory", "pfd"],
      },
    ],
    toolbarButtons: [
      {
        id: "solvePowerfactoryPowerflow",
        label: "Solve AC Power Flow (PowerFactory)",
        shortLabel: "Solve AC",
        tooltip: "Solve AC Power Flow (PowerFactory)",
        icon: "pulse",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "solve_powerfactory_powerflow",
      },
      {
        id: "solvePowerfactoryShortCircuit",
        label: "Run Short-Circuit Fault Analysis (IEC 60909)",
        shortLabel: "Run",
        tooltip: "Run Short-Circuit Fault Analysis (IEC 60909)",
        icon: "zap",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "solve_powerfactory_short_circuit",
      },
      {
        id: "transpileDslModelica",
        label: "Transpile DSL to Modelica",
        shortLabel: "Transpile DSL",
        tooltip: "Transpile DSL to Modelica",
        icon: "tools",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "transpile_dsl_modelica",
      },
      {
        id: "runPowerfactoryScript",
        label: "Execute Python powerfactory Script",
        shortLabel: "Execute Python",
        tooltip: "Execute Python powerfactory Script",
        icon: "play",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "run_powerfactory_script",
      },
      {
        id: "projectToModelica",
        label: "Project to OpenIPSL Modelica (.mo)",
        shortLabel: "Project to",
        tooltip: "Project to OpenIPSL Modelica (.mo)",
        icon: "export",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "project_to_modelica",
      },
      {
        id: "lintPowerfactoryCase",
        label: "Lint PowerFactory Grid Model",
        shortLabel: "Lint",
        tooltip: "Lint PowerFactory Grid Model",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 60,
        actionId: "lint_powerfactory_case",
      },
    ],
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
