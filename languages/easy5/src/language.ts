// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ActionExecutionContext, choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { Easy5ErrorCode } from "./lints/index.js";
import { easy5PolyglotConfig, type SyncOptions } from "./tgg/index.js";

interface Easy5ActionContext extends ActionExecutionContext {
  modelicaText?: string | undefined;
  options?: SyncOptions | undefined;
}

/**
 * DSL language specification for Boeing / MSC Software EASY5 (.ez5, .ezm, .ezd, .eas).
 */
export const easy5Language = language({
  name: "easy5",
  fileExtensions: [".ez5", ".ezm", ".ezd", ".eas"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".ez5", ".ezm", ".ezd", ".eas"],
  },

  errorCodes: Easy5ErrorCode,

  rules: {
    Model: ($) =>
      seq(
        optional($["ModelHeader"]!),
        repeat(
          choice(
            $["ComponentsSection"]!,
            $["ConnectionsSection"]!,
            $["SimulationSection"]!,
            $["LinearSection"]!,
            $["Comment"]!,
          ),
        ),
      ),

    ModelHeader: ($) =>
      choice(
        seq("MODEL", ":", field("name", $["Identifier"]!)),
        seq("TITLE", ":", field("title", $["StringLiteral"]!)),
      ),

    ComponentsSection: ($) =>
      seq(choice("COMPONENTS:", "COMPONENTS"), repeat(choice($["ComponentDeclaration"]!, $["Comment"]!))),

    ComponentDeclaration: ($) =>
      seq(
        field("id", $["Identifier"]!),
        optional(seq("TYPE", "=")),
        field("type", choice($["Identifier"]!, $["QualifiedType"]!)),
        repeat($["Attribute"]!),
      ),

    Attribute: ($) =>
      choice(
        seq("TITLE", "=", $["StringLiteral"]!),
        seq("X", "=", $["NumberLiteral"]!),
        seq("Y", "=", $["NumberLiteral"]!),
        seq("XP", ":", repeat($["ParameterAssignment"]!)),
        seq("S0", ":", repeat($["StateAssignment"]!)),
        seq("PORTS", ":", repeat($["PortDeclaration"]!)),
      ),

    ParameterAssignment: ($) =>
      seq(
        field("name", $["Identifier"]!),
        "=",
        field("value", choice($["NumberLiteral"]!, $["ArrayLiteral"]!, $["StringLiteral"]!)),
      ),

    StateAssignment: ($) => seq(field("name", $["Identifier"]!), "=", field("value", $["NumberLiteral"]!)),

    PortDeclaration: ($) =>
      seq(field("name", $["Identifier"]!), "=", field("kind", choice("input", "output", "bidirectional"))),

    ConnectionsSection: ($) =>
      seq(choice("CONNECTIONS:", "CONNECTIONS"), repeat(choice($["Connection"]!, $["Comment"]!))),

    Connection: ($) =>
      choice(
        seq(
          field("fromComp", $["Identifier"]!),
          ".",
          field("fromPort", $["Identifier"]!),
          choice("->", "-->", "=>"),
          field("toComp", $["Identifier"]!),
          ".",
          field("toPort", $["Identifier"]!),
        ),
        seq(
          "CONNECT",
          field("fromComp", $["Identifier"]!),
          optional("."),
          field("fromPort", $["Identifier"]!),
          "TO",
          field("toComp", $["Identifier"]!),
          optional("."),
          field("toPort", $["Identifier"]!),
        ),
        seq(
          field("toComp", $["Identifier"]!),
          ".",
          field("toPort", $["Identifier"]!),
          "=",
          field("fromComp", $["Identifier"]!),
          ".",
          field("fromPort", $["Identifier"]!),
        ),
      ),

    SimulationSection: ($) =>
      seq(choice("SIMULATION:", "SIMULATION"), repeat(choice($["ConfigAssignment"]!, $["Comment"]!))),

    LinearSection: ($) => seq(choice("LINEAR:", "LINEAR"), repeat(choice($["ConfigAssignment"]!, $["Comment"]!))),

    ConfigAssignment: ($) =>
      seq(
        field("key", $["Identifier"]!),
        "=",
        field("value", choice($["NumberLiteral"]!, $["StringLiteral"]!, $["Identifier"]!)),
      ),

    QualifiedType: ($) => seq($["Identifier"]!, "/", $["Identifier"]!),

    ArrayLiteral: ($) => seq("[", repeat(choice($["NumberLiteral"]!, ",")), "]"),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/,
    StringLiteral: () => /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,
    Comment: () => /(!|#|--).*|\bC\s+.*/,
  },

  actions: [
    {
      id: "easy5_lint",
      title: "Lint EASY5 Model",
      description: "Checks for algebraic loops, unconnected ports, improper transfer functions, limiter bounds.",
      category: "verify",
      execute: async (context: Easy5ActionContext) => {
        const { parseEasy5 } = await import("./parser/easy5-parser.js");
        const { lintEasy5 } = await import("./lints/index.js");
        const text = context.documentText || "";
        const model = parseEasy5(text);
        return lintEasy5(model);
      },
    },
    {
      id: "easy5_to_modelica",
      title: "Project to Modelica 3.x",
      description: "Projects EASY5 continuous control components to Modelica.Blocks continuous and math library.",
      category: "export",
      execute: async (context: Easy5ActionContext) => {
        const { parseEasy5 } = await import("./parser/easy5-parser.js");
        const { easy5ToModelica } = await import("./projections/easy5ToModelica.js");
        const text = context.documentText || "";
        const model = parseEasy5(text);
        return easy5ToModelica(model);
      },
    },
    {
      id: "easy5_to_dae",
      title: "Lower to DAE Arena",
      description: "Lowers continuous dynamics directly to linear-memory DAEBuilder.",
      category: "transform",
      execute: async (context: Easy5ActionContext) => {
        const { parseEasy5 } = await import("./parser/easy5-parser.js");
        const { easy5ToDae } = await import("./dae/easy5-to-dae.js");
        const text = context.documentText || "";
        const model = parseEasy5(text);
        const dae = easy5ToDae(model);
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
    },
    {
      id: "easy5_sync_from_modelica",
      title: "Synchronize from Modelica 3.x",
      description: "Reconciles tuned parameters and topological changes from Modelica back into EASY5 .ez5 deck.",
      category: "transform",
      execute: async (context: Easy5ActionContext) => {
        const { synchronizeModelicaToEasy5 } = await import("./tgg/easy5-sync.js");
        const originalText = context.documentText || "";
        const modifiedModelica = context.modelicaText || "";
        const options = context.options || {};
        return synchronizeModelicaToEasy5(originalText, modifiedModelica, options);
      },
    },
  ],

  polyglot: easy5PolyglotConfig,
});
