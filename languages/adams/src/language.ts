// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInAdamsLibrarySync } from "./catalog/library-package-adapter.js";
import { indexAdamsDocument } from "./indexing.js";
import { adamsPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for MSC Adams multibody models (.adm, .cmd, .acf).
 */
export const adamsLanguage = language({
  polyglot: adamsPolyglotConfig,
  name: "adams",
  fileExtensions: [".adm", ".cmd", ".acf"],
  maturity: "experimental",
  word: ($) => $["Identifier"]!,
  extras: ($) => [/[ \t\r\n]+/, "&", $["Comment"]!],
  indexing: {
    indexFile: indexAdamsDocument,
  },
  lsp: {
    fileExtensions: [".adm", ".cmd", ".acf"],
  },
  diagram: {
    placement: {
      persistence: "sidecar",
    },
    mutations: {
      createNode: (_className: string, name: string) => `PART/${name}, MASS = 1.0, IP = 0.1, 0.1, 0.1`,
      createEdge: (source: string, target: string) =>
        `JOINT/${source}_to_${target}, REVOLUTE, I = ${source}, J = ${target}`,
    },
  },
  ui: {
    panels: [
      {
        id: "adamsEditor",
        viewType: "modelscript.adamsEditor",
        title: "MSC Adams Multibody Dynamics Studio",
        shortTitle: "Adams",
        selector: ["*.adm", "*.cmd", "*.acf"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/AdamsPanel.tsx",
        artifactViewTypes: ["adams", "adm"],
      },
    ],
    stencils: [
      { label: "Part", snippet: "PART/99, MASS = 12.5, CM = 9901, IP = 1.2, 1.2, 0.8\n" },
      { label: "Joint", snippet: "JOINT/99, REVOLUTE, I = 101, J = 201\n" },
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
    ],
  },

  rules: {
    Deck: ($) => repeat($["CardStatement"]!),

    CardStatement: ($) =>
      choice(
        $["PartCard"]!,
        $["MarkerCard"]!,
        $["JointCard"]!,
        $["ForceCard"]!,
        $["MotionCard"]!,
        $["SimulateCard"]!,
        $["GenericCard"]!,
        $["EndCard"]!,
      ),

    PartCard: ($) =>
      seq($["PartHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    MarkerCard: ($) =>
      seq($["MarkerHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    JointCard: ($) =>
      seq($["JointHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    ForceCard: ($) =>
      seq($["ForceHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    MotionCard: ($) =>
      seq($["MotionHeader"]!, field("id", choice($["NumberLiteral"]!, $["Identifier"]!)), repeat($["CardArg"]!)),

    SimulateCard: ($) => seq($["SimulateHeader"]!, field("type", $["Identifier"]!), repeat($["CardArg"]!)),

    GenericCard: ($) => seq($["GenericHeader"]!, repeat($["CardArg"]!)),

    EndCard: () => choice("END", "end"),

    CardArg: ($) =>
      choice(
        ",",
        "=",
        "+",
        "-",
        "*",
        "/",
        "^",
        $["ParenExpr"]!,
        "END",
        "end",
        $["Identifier"]!,
        $["NumberLiteral"]!,
        $["StringLiteral"]!,
      ),

    ParenExpr: ($) => seq("(", repeat($["CardArg"]!), ")"),

    PartHeader: () => /(?:PART|part)\//,
    MarkerHeader: () => /(?:MARKER|marker)\//,
    JointHeader: () => /(?:JOINT|joint)\//,
    ForceHeader: () => /(?:SPRINGDAMPER|springdamper|SFORCE|sforce|VFORCE|vforce|GFORCE|gforce|BUSHING|bushing)\//,
    MotionHeader: () => /(?:MOTION|motion)\//,
    SimulateHeader: () => /(?:SIMULATE|simulate)\//,
    GenericHeader: () => /[A-Za-z_][A-Za-z0-9_.:]*\//,

    Identifier: () => /[A-Za-z_][A-Za-z0-9_.:]*/,
    NumberLiteral: () => /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[dD]?/,
    StringLiteral: () => /"[^"\\\r\n]*(?:\\.[^"\\\r\n]*)*"|'[^'\\\r\n]*(?:\\.[^'\\\r\n]*)*'/,
    Comment: () => /(?:!|\$|\/\/)[^\r\n]*/,
  },
});

export default adamsLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInAdamsLibrarySync();
