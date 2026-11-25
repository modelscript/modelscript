// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ActionExecutionContext, choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInEasy5LibrarySync } from "./catalog/library-package-adapter.js";
import { indexEasy5Document } from "./indexing.js";
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
  indexing: {
    indexFile: indexEasy5Document,
  },
  lsp: {
    fileExtensions: [".ez5", ".ezm", ".ezd", ".eas"],
  },
  ui: {
    panels: [
      {
        id: "easy5Editor",
        viewType: "modelscript.easy5Editor",
        title: "EASY5 Schematic & Linear Control Editor",
        shortTitle: "EASY5",
        selector: ["*.ez5", "*.ezm", "*.ezd", "*.eas"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/Easy5Panel.tsx",
        artifactViewTypes: ["easy5", "ez5"],
      },
    ],
    stencils: [
      { label: "Gain", snippet: 'Block { BlockType Gain Name "Gain_New" Gain "2.0" }\n' },
      { label: "Integrator", snippet: 'Block { BlockType Integrator Name "Integ_New" InitialCondition "0" }\n' },
      { label: "Sum", snippet: 'Block { BlockType Sum Name "Sum_New" Inputs "+-" }\n' },
      { label: "Step", snippet: 'Block { BlockType Step Name "Step_New" After "1.0" }\n' },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "easy5ToModelica",
        label: "Project to Modelica 3.x",
        shortLabel: "Project to",
        tooltip: "Project to Modelica 3.x",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "easy5_to_modelica",
      },
      {
        id: "easy5ToDae",
        label: "Lower to DAE Arena",
        shortLabel: "Lower to",
        tooltip: "Lower to DAE Arena",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "easy5_to_dae",
      },
      {
        id: "easy5SyncFromModelica",
        label: "Synchronize from Modelica 3.x",
        shortLabel: "Synchronize from",
        tooltip: "Synchronize from Modelica 3.x",
        icon: "sync",
        views: ["diagram", "inspector"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "easy5_sync_from_modelica",
      },
      {
        id: "easy5Lint",
        label: "Lint EASY5 Model",
        shortLabel: "Lint EASY5",
        tooltip: "Lint EASY5 Model",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "easy5_lint",
      },
    ],
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

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInEasy5LibrarySync();
