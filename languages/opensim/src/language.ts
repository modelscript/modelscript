// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Language Definition.
 *
 * Registers OpenSim 3.x / 4.x (.osim) biomechanical musculoskeletal files,
 * semantic linting (M9101–M9110), Hill-type muscle-tendon RK4 simulation,
 * linear-memory DAE lowering, and Modelica / URDF projections.
 */

import { language } from "@modelscript/dsl";
import { lowerOpenSimToDae } from "./dae/index.js";
import { indexOpenSimFile } from "./indexing.js";
import { lintOpenSimDocument } from "./lints/index.js";
import { parseOpenSim } from "./parser/index.js";
import { openSimToModelica, openSimToUrdf } from "./projections/index.js";
import { simulateMuscleDynamics, type OpenSimSimulationOptions } from "./solvers/index.js";

export const openSimLanguage = language({
  name: "opensim",
  fileExtensions: [".osim"],
  maturity: "beta",
  indexing: {
    indexFile: indexOpenSimFile,
  },
  lsp: {
    fileExtensions: [".osim"],
  },
  rules: {
    Root: () => "opensim",
  },

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
