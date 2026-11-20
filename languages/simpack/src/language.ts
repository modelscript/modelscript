// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { simpackIndexing } from "./indexing.js";
import { simpackPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for SIMPACK multibody models (.spck, .sim, .mbs).
 */
export const simpackLanguage = language({
  polyglot: simpackPolyglotConfig,
  name: "simpack",
  fileExtensions: [".spck", ".sim", ".mbs"],
  maturity: "beta",
  indexing: simpackIndexing,
  lsp: {
    fileExtensions: [".spck", ".sim", ".mbs"],
  },
  ui: {
    panels: [
      {
        id: "simpackEditor",
        viewType: "modelscript.simpackEditor",
        title: "SIMPACK Multibody Dynamics Studio",
        shortTitle: "SIMPACK",
        selector: ["*.spck", "*.sim", "*.mbs"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/SimpackPanel.tsx",
        artifactViewTypes: ["simpack", "spck", "simpack-mbs"],
      },
    ],
    stencils: [
      {
        label: "Body ($B)",
        snippet:
          "body.id            = '$B_NewBody'\nbody.mass          = 1200.0\nbody.inertia       = [450.0, 1800.0, 1850.0]\n",
      },
      {
        label: "Force Element ($F)",
        snippet:
          "force.id           = '$F_PrimarySpring'\nforce.type         = 43\nforce.stiffness    = 1.2e6\nforce.damping      = 1.5e4\n",
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
    ],
  },
  diagram: {
    placement: {
      persistence: "sidecar",
    },
    mutations: {
      createNode: (_className: string, name: string) => `body ${name} ${name} 1.0 0.1 0.1 0.1`,
      createEdge: (source: string, target: string) => `joint ${source}_to_${target} revolute ${source} ${target}`,
    },
  },

  rules: {
    Deck: ($) => repeat(choice($["CardStatement"]!, $["Comment"]!)),

    CardStatement: ($) => choice($["BodyCard"]!, $["MarkerCard"]!, $["JointCard"]!, $["GenericCard"]!),

    BodyCard: ($) =>
      seq(
        choice("body", "$body", "BODY", "$BODY"),
        field("id", $["Identifier"]!),
        field("name", $["Identifier"]!),
        field("mass", $["NumberLiteral"]!),
        repeat($["NumberLiteral"]!),
      ),

    MarkerCard: ($) =>
      seq(
        choice("marker", "$marker", "MARKER", "$MARKER"),
        field("id", $["Identifier"]!),
        field("body", $["Identifier"]!),
        repeat($["NumberLiteral"]!),
      ),

    JointCard: ($) =>
      seq(
        choice("joint", "$joint", "JOINT", "$JOINT"),
        field("id", $["Identifier"]!),
        field("type", $["Identifier"]!),
        field("from", $["Identifier"]!),
        field("to", $["Identifier"]!),
      ),

    GenericCard: ($) =>
      seq($["Identifier"]!, repeat(choice($["NumberLiteral"]!, $["Identifier"]!, $["StringLiteral"]!))),

    Identifier: () => /[A-Za-z_$][A-Za-z0-9_:-]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:\$#.*|#.*|!.*|\/\/.*)/,
  },
});

export default simpackLanguage;
