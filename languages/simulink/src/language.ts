// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { lowerSimulinkToDae } from "./dae/simulink-to-dae.js";
import { lintSimulinkModel } from "./lints/simulink-linters.js";
import { parseMdl } from "./parser/mdl-parser.js";
import { parseSlx } from "./parser/slx-parser.js";
import { simulinkToModelica } from "./projections/modelica.js";
import { simulinkPolyglotConfig } from "./tgg/simulink-rules.js";
import { synchronizeModelicaToSimulink } from "./tgg/simulink-sync.js";

/**
 * DSL language specification for MATLAB Simulink models (.slx, .mdl).
 */
export const simulinkLanguage = language({
  name: "simulink",
  fileExtensions: [".slx", ".mdl"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".slx", ".mdl"],
  },

  rules: {
    Model: ($: any) => repeat(choice($["BlockStatement"], $["LineStatement"], $["SystemStatement"], $["Comment"])),

    SystemStatement: ($: any) =>
      seq(
        choice("System", "system"),
        "{",
        repeat(choice($["BlockStatement"], $["LineStatement"], $["PropertyAssign"])),
        "}",
      ),

    BlockStatement: ($: any) =>
      seq(
        choice("Block", "block"),
        "{",
        repeat(choice($["PropertyAssign"], $["BlockStatement"], $["LineStatement"])),
        "}",
      ),

    LineStatement: ($: any) =>
      seq(choice("Line", "line"), "{", repeat(choice($["PropertyAssign"], $["BranchStatement"])), "}"),

    BranchStatement: ($: any) => seq(choice("Branch", "branch"), "{", repeat($["PropertyAssign"]), "}"),

    PropertyAssign: ($: any) =>
      seq(
        field("key", $["Identifier"]),
        field("value", choice($["StringLiteral"], $["NumberLiteral"], $["Identifier"])),
      ),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
    NumberLiteral: () => /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    Comment: () => choice(/\/\/[^\n]*/, /#[^\n]*/),
  },

  actions: [
    {
      id: "simulink_lint",
      title: "Lint Simulink Model",
      description: "Runs pre-flight control checks (algebraic loops, unconnected ports, missing initial conditions).",
      category: "verify",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const model = text.startsWith("PK") ? parseSlx(Buffer.from(text, "binary")) : parseMdl(text);
        const diagnostics = lintSimulinkModel(model);
        return { diagnosticsCount: diagnostics.length, diagnostics };
      },
    },
    {
      id: "simulink_to_modelica",
      title: "Project to Modelica 3.x",
      description: "Projects Simulink block diagram to Modelica.Blocks continuous and math library.",
      category: "export",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const model = text.startsWith("PK") ? parseSlx(Buffer.from(text, "binary")) : parseMdl(text);
        return simulinkToModelica(model);
      },
    },
    {
      id: "simulink_to_dae",
      title: "Lower to DAE Arena",
      description: "Lowers continuous control blocks and transfer functions directly to linear-memory DAEBuilder.",
      category: "transform",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const model = text.startsWith("PK") ? parseSlx(Buffer.from(text, "binary")) : parseMdl(text);
        const dae = lowerSimulinkToDae(model);
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
    },
    {
      id: "simulink_sync_from_modelica",
      title: "Synchronize from Modelica 3.x",
      description: "Reconciles tuned parameters and topological changes from Modelica back into Simulink .mdl.",
      category: "transform",
      execute: async (context: any) => {
        const originalText = context.documentText || "";
        const modifiedModelica = context.modelicaText || "";
        const options = context.options || {};
        return synchronizeModelicaToSimulink(originalText, modifiedModelica, options);
      },
    },
  ],

  polyglot: simulinkPolyglotConfig,
});

export default simulinkLanguage;
