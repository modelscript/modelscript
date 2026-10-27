// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/opendrive — Language Definition.
 *
 * Registers ASAM OpenDRIVE (.xodr, .xml) file extensions, pre-flight linting,
 * analytical clothoid track sampling, DAE lowering, and GENSYS export.
 */

import { language } from "@modelscript/dsl";
import { lowerOpenDriveToDae } from "./dae/opendrive-to-dae.js";
import { sampleRoadTrack } from "./geometry/clothoid.js";
import { lintOpenDrive } from "./lints/rules.js";
import { parseOpenDrive } from "./parser/index.js";
import { opendriveToGensys } from "./projections/opendrive-to-gensys.js";

export const opendriveLanguage = language({
  name: "opendrive",
  fileExtensions: [".xodr", ".xml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".xodr", ".xml"],
  },
  rules: {
    Root: () => "opendrive",
  },

  actions: [
    {
      id: "opendrive_lint",
      title: "Lint OpenDRIVE Road Network",
      description: "Runs pre-flight tangency continuity, lane link, and clothoid convergence checks.",
      category: "verify",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        return lintOpenDrive(doc);
      },
    },
    {
      id: "opendrive_sample_track",
      title: "Sample 3D Road Trajectory",
      description:
        "Generates high-precision 3D spatial track coordinates via Fresnel clothoids and elevation profiles.",
      category: "simulate",
      execute: async (context: any, params?: any) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        const step = params?.step ?? 1.0;
        const tracks = doc.roads.map((r) => ({
          roadId: r.id,
          name: r.name,
          points: sampleRoadTrack(r, step),
        }));
        return { step, tracks };
      },
    },
    {
      id: "opendrive_to_dae",
      title: "Lower OpenDRIVE to DAE Arena",
      description: "Lowers road tracking dynamics into ModelScript's linear-memory DAEBuilder arena.",
      category: "transform",
      execute: async (context: any) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        const arena = lowerOpenDriveToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "opendrive_to_gensys",
      title: "Export to GENSYS Track (.geo)",
      description: "Translates OpenDRIVE 3D roadway trajectories to GENSYS track geometry format.",
      category: "export",
      execute: async (context: any, params?: any) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        const step = params?.step ?? 1.0;
        return opendriveToGensys(doc, step);
      },
    },
  ],
});
