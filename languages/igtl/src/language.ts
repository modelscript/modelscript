// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — Language Definition.
 *
 * Registers OpenIGTLink (.igtl) and PLUS Toolkit (.plus.xml) file extensions,
 * SE(3) surgical navigation linting (M9801–M9810), transform chain & pivot calibration solver,
 * DAE lowering, and ROS URDF / Modelica projections.
 */

import { language } from "@modelscript/dsl";
import { lowerIgtlToDae, solveTransformChainAndPivot } from "./kinematics/index.js";
import { lintIgtlDocument } from "./lints/rules.js";
import { parseIgtl } from "./parser/index.js";
import { igtlToModelica, igtlToUrdf } from "./projections/index.js";

export const igtlLanguage = language({
  name: "igtl",
  fileExtensions: [".igtl.json", ".igtl", ".plus.xml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".igtl.json", ".igtl", ".plus.xml"],
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
