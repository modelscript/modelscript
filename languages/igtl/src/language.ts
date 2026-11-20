// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — Language Definition.
 *
 * Registers OpenIGTLink (.igtl) and PLUS Toolkit (.plus.xml) file extensions,
 * SE(3) surgical navigation linting (M9801–M9810), transform chain & pivot calibration solver,
 * DAE lowering, and ROS URDF / Modelica projections.
 */

import { language } from "@modelscript/dsl";
import { canIndexIgtl, indexIgtlFile } from "./indexing.js";
import { lowerIgtlToDae, solveTransformChainAndPivot } from "./kinematics/index.js";
import { lintIgtlDocument } from "./lints/rules.js";
import { parseIgtl } from "./parser/index.js";
import { igtlToModelica, igtlToUrdf } from "./projections/index.js";
import { igtlPolyglotConfig } from "./tgg/index.js";

export const igtlLanguage = language({
  polyglot: igtlPolyglotConfig,
  name: "igtl",
  fileExtensions: [".igtl.json", ".igtl", ".plus.xml"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".igtl.json", ".igtl", ".plus.xml"],
  },
  ui: {
    panels: [
      {
        id: "igtlEditor",
        viewType: "modelscript.igtlEditor",
        title: "OpenIGTLink & Surgical Robotics Studio",
        shortTitle: "OpenIGTLink",
        selector: ["*.igtl", "*.igtl.json", "*.plus.xml"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/IgtlPanel.tsx",
        artifactViewTypes: ["igtl", "openigtlink"],
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
      {
        id: "igtlSolveKinematics",
        label: "Solve SE(3) Transform Chain, Stylus Pivot Calibration & Fitzpatrick TRE",
        shortLabel: "Solve SE",
        tooltip: "Solve SE(3) Transform Chain, Stylus Pivot Calibration & Fitzpatrick TRE",
        icon: "sliders",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "igtl_solve_kinematics",
      },
      {
        id: "igtlToDae",
        label: "Lower OpenIGTLink / PLUS Navigation Model to DAE Arena",
        shortLabel: "Lower",
        tooltip: "Lower OpenIGTLink / PLUS Navigation Model to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "igtl_to_dae",
      },
      {
        id: "igtlToUrdf",
        label: "Export Coordinate Frame Tree to ROS URDF (.urdf)",
        shortLabel: "Export",
        tooltip: "Export Coordinate Frame Tree to ROS URDF (.urdf)",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "igtl_to_urdf",
      },
      {
        id: "igtlToModelica",
        label: "Export Surgical Navigation Setup to Modelica 3.x (.mo)",
        shortLabel: "Export Surgical",
        tooltip: "Export Surgical Navigation Setup to Modelica 3.x (.mo)",
        icon: "export",
        views: ["3d", "code"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "igtl_to_modelica",
      },
      {
        id: "igtlLint",
        label: "Lint OpenIGTLink / PLUS Surgical Navigation Configuration",
        shortLabel: "Lint OpenIGTLink",
        tooltip: "Lint OpenIGTLink / PLUS Surgical Navigation Configuration",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 60,
        actionId: "igtl_lint",
      },
    ],
  },
  indexing: {
    canIndex: canIndexIgtl,
    indexFile: indexIgtlFile,
  },
  rules: {
    Root: () => "igtl",
  },

  actions: [
    {
      id: "igtl_lint",
      title: "Lint OpenIGTLink / PLUS Surgical Navigation Configuration",
      description: "Runs SE(3) rotation orthogonality, coordinate graph, TRE, and server port checks (M9801–M9810).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseIgtl(context.documentText ?? "");
        return lintIgtlDocument(doc);
      },
    },
    {
      id: "igtl_solve_kinematics",
      title: "Solve SE(3) Transform Chain, Stylus Pivot Calibration & Fitzpatrick TRE",
      description:
        "Computes shortest-path SE(3) composition, least-squares pivot offset, and target registration error.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseIgtl(context.documentText ?? "");
        return solveTransformChainAndPivot(doc);
      },
    },
    {
      id: "igtl_to_dae",
      title: "Lower OpenIGTLink / PLUS Navigation Model to DAE Arena",
      description: "Lowers SE(3) translations, acquisition rates, pivot RMS error, and TRE into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseIgtl(context.documentText ?? "");
        const arena = lowerIgtlToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "igtl_to_urdf",
      title: "Export Coordinate Frame Tree to ROS URDF (.urdf)",
      description: "Projects PLUS / OpenIGTLink coordinate transforms to a ROS URDF robot description.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseIgtl(context.documentText ?? "");
        return igtlToUrdf(doc);
      },
    },
    {
      id: "igtl_to_modelica",
      title: "Export Surgical Navigation Setup to Modelica 3.x (.mo)",
      description: "Projects tracking devices, SE(3) transforms, and calibration telemetry to Modelica.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseIgtl(context.documentText ?? "");
        return igtlToModelica(doc);
      },
    },
  ],
});
