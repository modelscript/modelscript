// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import { gensysDeckGrammar } from "./grammar/gensys-grammar.js";
import { indexGensysDocument } from "./indexing.js";
import { gensysPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for GENSYS railway vehicle models and track geometry.
 */
export const gensysLanguage = language({
  polyglot: gensysPolyglotConfig,
  name: "gensys",
  fileExtensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel"],
  maturity: "stable",
  indexing: {
    indexFile: indexGensysDocument,
  },
  lsp: {
    fileExtensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel"],
    folding: gensysDeckGrammar.lsp?.folding,
    outline: gensysDeckGrammar.lsp?.outline,
  },
  ui: {
    panels: [
      {
        id: "gensysEditor",
        viewType: "modelscript.gensysEditor",
        title: "GENSYS Railway Vehicle Dynamics Studio",
        shortTitle: "GENSYS",
        selector: ["*.calc", "*.run", "*.sub", "*.geom", "*.trax", "*.wheel"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/GensysPanel.tsx",
        artifactViewTypes: ["gensys", "gensys-rail"],
      },
    ],
    stencils: [
      {
        label: "Mass (mass)",
        snippet: "mass m_body_new  0.0 0.0 -1.2   m=15000  Jx=22000 Jy=450000 Jz=450000\n",
      },
      {
        label: "Spring/Damper (coupl)",
        snippet: "coupl k_susp_new  body_1 body_2  0.0 1.0 -0.5  0.0 1.0 -0.8  k=350e3 c=18e3\n",
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
  word: gensysDeckGrammar.word,
  extras: gensysDeckGrammar.extras,
  conflicts: gensysDeckGrammar.conflicts,
  rules: gensysDeckGrammar.rules,
});

export default gensysLanguage;
