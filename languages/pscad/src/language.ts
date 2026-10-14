// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Language Definition.
 *
 * Provides declarative grammar, XML AST parsing, pre-flight linter,
 * and polyglot cross-language projections for PSCAD v4/v5 projects.
 */

import { language } from "@modelscript/dsl";
import { lintPscx } from "./lints/index.js";
import { extractEmtNetlist } from "./netlist/emt-netlist.js";
import { parsePscx } from "./parser/pscx-parser.js";

export const pscadLanguage = language({
  name: "pscad",
  fileExtensions: [".pscx", ".pswx", ".psmx"],
  lsp: {
    fileExtensions: [".pscx", ".pswx", ".psmx"],
    icons: {
      light: "./assets/pscad/icon-light.png",
      dark: "./assets/pscad/icon-dark.png",
    },
  },
  rules: {
    Root: () => "pscad",
  },

  actions: [
    {
      id: "lint_pscad_project",
      title: "Lint PSCAD Project",
      description: "Performs pre-flight electrical topology and parameter bounds checks.",
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
          name: "pscad_lint",
          displayName: "Lint PSCAD Project",
          modelDescription: "Lints PSCAD project for floating nodes and parameter errors.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string }) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const project = parsePscx(text);
        return lintPscx(project);
      },
    },
    {
      id: "inspect_pscad_schematic",
      title: "Inspect Power System Schematic",
      description: "Opens interactive Single-Line Diagram (SLD) and 3-phase schematic visualizer.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(circuit-board)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "pscad_inspect_schematic",
          displayName: "Inspect PSCAD Schematic",
          modelDescription: "Inspects PSCAD components, buses, and wiring topology.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string }) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        return extractEmtNetlist(project);
      },
    },
    {
      id: "simulate_hybrid_emt",
      title: "Launch Hybrid EMT Simulation",
      description: "Launches high-speed WebAssembly Dommel companion solver with black-box FMU co-simulation.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@2",
        },
        explorerContextMenu: {
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "pscad_simulate_emt",
          displayName: "Simulate Hybrid EMT",
          modelDescription: "Executes fixed-step companion circuit EMT simulation.",
        },
      },
    },
  ],
});
