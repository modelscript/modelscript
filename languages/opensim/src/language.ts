// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Language Definition.
 *
 * Registers OpenSim 3.x / 4.x (.osim) biomechanical musculoskeletal files,
 * semantic linting (M9101–M9110), Hill-type muscle-tendon RK4 simulation,
 * linear-memory DAE lowering, and Modelica / URDF projections.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { lowerOpenSimToDae } from "./dae/index.js";
import { indexOpenSimFile } from "./indexing.js";
import { lintOpenSimDocument } from "./lints/index.js";
import { parseOpenSim } from "./parser/index.js";
import { openSimToModelica, openSimToUrdf } from "./projections/index.js";
import { simulateMuscleDynamics, type OpenSimSimulationOptions } from "./solvers/index.js";
import { opensimPolyglotConfig } from "./tgg/index.js";

export const openSimLanguage = language({
  polyglot: opensimPolyglotConfig,
  name: "opensim",
  fileExtensions: [".osim"],
  maturity: "beta",
  indexing: {
    indexFile: indexOpenSimFile,
  },
  lsp: {
    fileExtensions: [".osim"],
  },
  ui: {
    panels: [
      {
        id: "opensimEditor",
        viewType: "modelscript.opensimEditor",
        title: "OpenSim Biomechanics & Musculoskeletal Studio",
        shortTitle: "OpenSim",
        selector: ["*.osim"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/OpenSimPanel.tsx",
        artifactViewTypes: ["opensim", "osim"],
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
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "opensimSimulate",
        label: "Simulate Hill-Type Muscle & Coordinate Dynamics",
        shortLabel: "Simulate",
        tooltip: "Simulate Hill-Type Muscle & Coordinate Dynamics",
        icon: "play",
        views: ["3d", "simulation"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "opensim_simulate",
      },
      {
        id: "opensimToDae",
        label: "Lower OpenSim Model to DAE Arena",
        shortLabel: "Lower OpenSim",
        tooltip: "Lower OpenSim Model to DAE Arena",
        icon: "stack",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "opensim_to_dae",
      },
      {
        id: "opensimToModelica",
        label: "Export OpenSim Model to Modelica 3.x",
        shortLabel: "Export OpenSim",
        tooltip: "Export OpenSim Model to Modelica 3.x",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "opensim_to_modelica",
      },
      {
        id: "opensimToUrdf",
        label: "Export OpenSim Model to ROS / Gazebo URDF",
        shortLabel: "Export OpenSim",
        tooltip: "Export OpenSim Model to ROS / Gazebo URDF",
        icon: "export",
        views: ["3d", "code"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "opensim_to_urdf",
      },
      {
        id: "opensimLint",
        label: "Lint OpenSim Musculoskeletal Document",
        shortLabel: "Lint OpenSim",
        tooltip: "Lint OpenSim Musculoskeletal Document",
        icon: "shield-check",
        views: ["*"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 60,
        actionId: "opensim_lint",
      },
    ],
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,

  actions: [
    {
      id: "opensim_lint",
      title: "Lint OpenSim Musculoskeletal Document",
      description: "Runs biomechanical and Hill-type muscle semantic validation rules (M9101–M9110).",
      category: "verify",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOpenSim(context.documentText ?? "");
        return lintOpenSimDocument(doc);
      },
    },
    {
      id: "opensim_simulate",
      title: "Simulate Hill-Type Muscle & Coordinate Dynamics",
      description:
        "Integrates neural excitation-contraction activation dynamics, Gaussian force-length curves, and generalized coordinate accelerations via RK4.",
      category: "simulate",
      execute: async (context: { documentText?: string | undefined }, params?: OpenSimSimulationOptions) => {
        const doc = parseOpenSim(context.documentText ?? "");
        return simulateMuscleDynamics(doc, params);
      },
    },
    {
      id: "opensim_to_dae",
      title: "Lower OpenSim Model to DAE Arena",
      description:
        "Lowers generalized coordinates, speeds, muscle activations, fiber lengths, and Hill force balances into DAEBuilder.",
      category: "transform",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOpenSim(context.documentText ?? "");
        const arena = lowerOpenSimToDae(doc);
        return {
          modelName: doc.modelName,
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "opensim_to_modelica",
      title: "Export OpenSim Model to Modelica 3.x",
      description:
        "Projects OpenSim rigid bodies, joints, and Hill-type muscles to a Modelica 3.x musculoskeletal model.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOpenSim(context.documentText ?? "");
        return openSimToModelica(doc);
      },
    },
    {
      id: "opensim_to_urdf",
      title: "Export OpenSim Model to ROS / Gazebo URDF",
      description: "Projects OpenSim rigid bodies and kinematic joints to a URDF <robot> XML description.",
      category: "export",
      execute: async (context: { documentText?: string | undefined }) => {
        const doc = parseOpenSim(context.documentText ?? "");
        return openSimToUrdf(doc);
      },
    },
  ],
});

export const opensimLanguage = openSimLanguage;
