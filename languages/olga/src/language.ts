// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Language Definition for OLGA Multiphase Flow (.opi).
 *
 * Provides language registration, LSP quick-actions (linter, in-WASM drift-flux simulator,
 * SysML v2 projection, and flow assurance verification), and polyglot TGG rules.
 */

import {
  choice,
  def,
  language,
  repeat,
  seq,
  tggComplement,
  tggEq,
  tggRule,
  type ActionExecutionContext,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { lintOlgaModel } from "./lints/index.js";
import { parseOlga, serializeKeyDeck } from "./parser/index.js";
import { olgaToSysml2 } from "./projections/olga-to-sysml2.js";
import { simulateDriftFlux } from "./solver/drift-flux-dae.js";
import { verifyFlowAssuranceTrajectory } from "./verification/flow-assurance-verifier.js";

export const olgaLanguage = language({
  name: "olga",
  fileExtensions: [".opi", ".olga", ".key", ".genkey", ".inp"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".opi", ".olga", ".key", ".genkey", ".inp"],
    icons: {
      light: "./assets/olga/icon-light.png",
      dark: "./assets/olga/icon-dark.png",
    },
  },

  actions: [
    {
      id: "lint_olga_case",
      title: "Lint OLGA Multiphase Case",
      description: "Checks CFL numerical stability, boundary completeness, and physical pipe bounds.",
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
          name: "olga_lint",
          displayName: "Lint OLGA Case",
          modelDescription: "Lints an OLGA .opi project for CFL violations, invalid geometry, and missing boundaries.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const model = parseOlga(text);
        return lintOlgaModel(model);
      },
    },
    {
      id: "simulate_drift_flux",
      title: "Simulate 1D Drift-Flux (WASM)",
      description:
        "Executes in-WASM transient multiphase simulation solving gas/liquid mass, mixture momentum, and energy.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "olga_simulate_drift_flux",
          displayName: "Simulate 1D Drift-Flux",
          modelDescription: "Runs in-WASM 1D Drift-Flux multiphase simulation on an OLGA case (.opi or .key).",
        },
      },
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; durationSeconds?: number },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseOlga(text);
        return simulateDriftFlux(model, { durationSeconds: params?.durationSeconds });
      },
    },
    {
      id: "project_to_sysml2",
      title: "Project to SysML v2",
      description: "Projects the OLGA pipeline into SysML v2 requirements, parts, and operational state machine.",
      category: "transform",
      ui: {
        editorTitle: {
          icon: "$(file-code)",
          group: "navigation@2",
        },
        languageModelTool: {
          name: "olga_project_sysml2",
          displayName: "Project OLGA to SysML v2",
          modelDescription:
            "Generates SysML v2 requirement contracts and state machine operating procedures from OLGA case.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseOlga(text);
        return olgaToSysml2(model);
      },
    },
    {
      id: "verify_flow_assurance",
      title: "Verify Flow Assurance Limits",
      description: "Simulates the network and verifies hydrate subcooling, slug catcher surge volume, and MAOP limits.",
      category: "verify",
      ui: {
        editorTitle: {
          icon: "$(shield)",
          group: "navigation@3",
        },
        languageModelTool: {
          name: "olga_verify_flow_assurance",
          displayName: "Verify Flow Assurance Constraints",
          modelDescription: "Simulates OLGA case and checks against formal SysML v2 hydrate, surge, and MAOP limits.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseOlga(text);
        const trajectory = simulateDriftFlux(model);
        return verifyFlowAssuranceTrajectory(trajectory);
      },
    },
    {
      id: "export_olga_key_deck",
      title: "Export OLGA Keyword Deck (.genkey)",
      description: "Exports the OLGA model to a standard OLGA keyword deck (.key / .genkey).",
      category: "export",
      ui: {
        editorTitle: {
          icon: "$(output)",
          group: "navigation@4",
        },
        languageModelTool: {
          name: "olga_export_key_deck",
          displayName: "Export OLGA Keyword Deck",
          modelDescription: "Serializes the OLGA pipeline into standard OLGA keyword deck format (.genkey).",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseOlga(text);
        return serializeKeyDeck(model);
      },
    },
  ],

  polyglot: {
    languages: ["sysml2", "modelica"],
    rules: [
      tggRule({
        name: "OlgaFlowpathToSysmlPart",
        sourceLang: "olga",
        targetLang: "sysml2",
        priority: 10,
        source: ($, v) => $.FlowpathElement({ name: v("fpName") }),
        target: ($, v) => $.PartUsage({ declaredName: v("fpName"), declaredType: "FlowlineRiserSystem" }),
        where: (v) => [tggEq(v("fpName"), v("fpName")), tggComplement(["diameter"])],
      }),
      tggRule({
        name: "OlgaValveToSysmlPart",
        sourceLang: "olga",
        targetLang: "sysml2",
        priority: 10,
        source: ($, v) => $.ValveElement({ name: v("vName") }),
        target: ($, v) => $.PartUsage({ declaredName: v("vName"), declaredType: "ChokeValve" }),
        where: (v) => [tggEq(v("vName"), v("vName")), tggComplement(["cd"])],
      }),
      tggRule({
        name: "OlgaNodeToModelicaFluidPort",
        sourceLang: "olga",
        targetLang: "modelica",
        priority: 10,
        source: ($, v) => $.NodeElement({ name: v("nName") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("nName"), typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a" }),
        where: (v) => [tggEq(v("nName"), v("nName")), tggComplement(["pressure"])],
      }),
    ],
  },

  primitives: {
    lineComment: "<!--",
  },

  extras: () => [/[ \t\r\n]+/],

  rules: {
    SourceFile: ($) =>
      def({
        syntax: repeat($["XmlElement"]!),
        symbol: () => ({
          kind: "Class",
          name: "OlgaCase",
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
        },
      }),

    XmlElement: ($) =>
      seq(
        "<",
        /[A-Za-z0-9_]+/,
        repeat(seq(/[A-Za-z0-9_]+/, "=", /"[^"]*"/)),
        choice("/>", seq(">", repeat(choice($["XmlElement"]!, /[^<]+/)), "</", /[A-Za-z0-9_]+/, ">")),
      ),

    FlowpathElement: ($) =>
      seq(
        "<",
        choice("Flowpath", "FLOWPATH"),
        repeat(seq(/[A-Za-z0-9_]+/, "=", /"[^"]*"/)),
        choice("/>", seq(">", repeat(choice($["XmlElement"]!, /[^<]+/)), "</", choice("Flowpath", "FLOWPATH"), ">")),
      ),

    ValveElement: ($) =>
      seq(
        "<",
        choice("Valve", "VALVE"),
        repeat(seq(/[A-Za-z0-9_]+/, "=", /"[^"]*"/)),
        choice("/>", seq(">", repeat(choice($["XmlElement"]!, /[^<]+/)), "</", choice("Valve", "VALVE"), ">")),
      ),

    NodeElement: ($) =>
      seq(
        "<",
        choice("Node", "NODE"),
        repeat(seq(/[A-Za-z0-9_]+/, "=", /"[^"]*"/)),
        choice("/>", seq(">", repeat(choice($["XmlElement"]!, /[^<]+/)), "</", choice("Node", "NODE"), ">")),
      ),
  },
});

export default olgaLanguage;
