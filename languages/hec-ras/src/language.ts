// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerHecRasToDae } from "./dae/hec-ras-to-dae.js";
import { indexHecRasFile } from "./indexing.js";
import { lintHecRas } from "./lints/rules.js";
import { parseHecRas } from "./parser/hec-ras-parser.js";
import { solveWaterSurfaceProfile } from "./solver/steady-step-solver.js";

export const hecRasLanguage = language({
  name: "hec-ras",
  fileExtensions: [".g01", ".g02", ".rasgeo", ".u01", ".f01", ".prj"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".g01", ".g02", ".rasgeo", ".u01", ".f01", ".prj"],
  },
  indexing: {
    indexFile: indexHecRasFile,
  },
  rules: {
    Root: () => "hec-ras",
  },

  actions: [
    {
      id: "hecras_lint",
      title: "Lint HEC-RAS Deck",
      description:
        "Checks river reach connectivity, station monotonicity, adverse bed slopes, and Manning roughness bounds.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const { geometry, flow } = parseHecRas(text);
        if (!geometry) return [];
        return lintHecRas(geometry, flow);
      },
    },
    {
      id: "hecras_solve_profile",
      title: "Solve Water Surface Profile",
      description:
        "Computes 1D standard-step water surface elevations (WSEL), energy grade line (EGL), velocities, and Froude numbers.",
      category: "simulate",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const { geometry, flow } = parseHecRas(text);
        if (!geometry) return [];

        let discharge = 100.0;
        let frictionSlope = 0.001;
        let knownWsel: number | undefined;

        if (flow && flow.boundaryConditions.length > 0) {
          for (const bc of flow.boundaryConditions) {
            if (bc.type === "Flow Hydrograph" && bc.hydrograph && bc.hydrograph.length > 0) {
              discharge = bc.hydrograph[0]!.flowOrStage;
            }
            if (bc.type === "Normal Depth" && bc.frictionSlope) {
              frictionSlope = bc.frictionSlope;
            }
            if (bc.type === "Known WS" && bc.knownStage !== undefined) {
              knownWsel = bc.knownStage;
            }
          }
        }

        return solveWaterSurfaceProfile(geometry, {
          discharge,
          downstreamWsel: knownWsel,
          frictionSlope,
        });
      },
    },
    {
      id: "hecras_to_dae",
      title: "Lower HEC-RAS to DAE Arena",
      description:
        "Compiles open-channel 1D Saint-Venant hydraulic balance equations directly into ModelScript linear memory.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const { geometry, flow } = parseHecRas(text);
        if (!geometry) return { variableCount: 0, equationCount: 0 };
        const arena = lowerHecRasToDae(geometry, flow);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});
